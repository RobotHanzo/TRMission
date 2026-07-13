// The destination-ticket chooser (ports the web TicketChooser), rendered as a panel — not a
// backdrop modal — so the board stays visible and pan/zoomable underneath: players preview the
// railways a ticket needs before committing. Because the panel takes over the usual hand and
// missions trays, it carries collapsible peeks at both. Offer cards deal in on the shared
// stagger (with the tunnel-draw tick, like the web); on Keep, kept tickets fly into the
// missions peek and discards drop away before committing.
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import type { CardCounts } from '@trm/proto';
import { TICKET_DEAL_STAGGER_MS } from '@trm/client-core/game/tickets';
import { ticketById } from '../../game/content';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../../features/tutorial/targets';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { soundPlayer } from '../../sound/player';
import { TicketCard } from './TicketCard';
import { PlayerHand } from './PlayerHand';
import { TicketPanel } from './TicketPanel';

const FLIGHT_MS = 500;

/** A slot's confirm-flight: kept cards converge on the missions peek, discards drop away. */
interface Flight {
  dx: number;
  dy: number;
  keep: boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** measureInWindow with a timeout fallback — measurement silently never calling back (jest, a
 *  mid-teardown view) must degrade to "commit instantly", never hang the confirm. */
const measureIn = (v: View | null, timeoutMs = 120): Promise<Rect | null> =>
  new Promise((resolve) => {
    if (!v) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      v.measureInWindow((x, y, width, height) => {
        clearTimeout(timer);
        resolve({ x, y, width, height });
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });

/** One offered ticket: flips in on the deal stagger (web `.ticket-deal-in`), then carries its
 *  confirm-flight transform. Plain RN Animated — low-frequency UI. */
function OfferSlot({
  index,
  reduced,
  flight,
  flightProgress,
  onRef,
  children,
}: PropsWithChildren<{
  index: number;
  reduced: boolean;
  flight: Flight | undefined;
  flightProgress: Animated.Value;
  onRef(v: View | null): void;
}>) {
  const deal = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.timing(deal, {
      toValue: 1,
      duration: 360,
      delay: index * TICKET_DEAL_STAGGER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [deal, index, reduced]);

  // Two phases that never overlap: the deal-in flip on mount, then (style-array override, so the
  // flight replaces the by-then-identity flip transform) the confirm flight.
  const dealStyle = {
    opacity: deal,
    transform: [
      { perspective: 800 },
      { rotateY: deal.interpolate({ inputRange: [0, 1], outputRange: ['80deg', '0deg'] }) },
    ],
  };
  const flightStyle = flight
    ? {
        opacity: flightProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [
          {
            translateX: flightProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, flight.dx],
            }),
          },
          {
            translateY: flightProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, flight.dy],
            }),
          },
          {
            scale: flightProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [1, flight.keep ? 0.25 : 0.85],
            }),
          },
          {
            rotate: flightProgress.interpolate({
              inputRange: [0, 1],
              outputRange: ['0deg', flight.keep ? '0deg' : '7deg'],
            }),
          },
        ],
      }
    : null;

  return (
    <Animated.View ref={onRef} collapsable={false} style={[dealStyle, flightStyle]}>
      {children}
    </Animated.View>
  );
}

interface Props {
  offered: string[];
  minKeep: number;
  /** When true, long route tickets in the offer are locked and cannot be discarded. */
  lockLong?: boolean | undefined;
  /** The player's current train-card hand (peekable while choosing). */
  hand: CardCounts | undefined;
  handCount: number;
  /** The player's already-kept missions (peekable while choosing). */
  keptTicketIds: string[];
  completedIds?: ReadonlySet<string> | undefined;
  /** Tutorial gate: the offer is previewable but committing is disabled until a beat asks. */
  confirmDisabled?: boolean | undefined;
  onConfirm(ids: string[]): void;
}

const INK = '#4b5563';

export function TicketChooser({
  offered,
  minKeep,
  lockLong,
  hand,
  handCount,
  keptTicketIds,
  completedIds,
  confirmDisabled,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.ticketChooser);
  const reduced = useReducedMotion();
  const locked = lockLong
    ? new Set(offered.filter((id) => ticketById.get(id)?.deck === 'LONG'))
    : new Set<string>();
  const [kept, setKept] = useState<Set<string>>(() => new Set(offered)); // default: keep all
  const [showHand, setShowHand] = useState(false);
  const [showTickets, setShowTickets] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [flights, setFlights] = useState<Map<string, Flight>>(new Map());
  const flightProgress = useRef(new Animated.Value(0)).current;
  const slotRefs = useRef(new Map<string, View>()).current;
  const keptToggleRef = useRef<View>(null);

  // A deal-out tick per offered ticket, synced to the deal-in flip — the same cue as a tunnel
  // reveal. Keyed by the offer CONTENTS (not array identity): during simultaneous setup
  // selection opponents' snapshots re-create `offered` with the same ids, and re-running on
  // those would clear the in-flight stagger timers. One immediate tick under reduced motion.
  const offerKey = offered.join('|');
  useEffect(() => {
    if (offerKey === '') return;
    if (reduced) {
      soundPlayer.play('tunnelDraw');
      return;
    }
    const count = offerKey.split('|').length;
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => soundPlayer.play('tunnelDraw'), i * TICKET_DEAL_STAGGER_MS),
    );
    return () => timers.forEach((id) => clearTimeout(id));
  }, [offerKey, reduced]);

  const toggle = (id: string): void => {
    if (locked.has(id) || confirming) return;
    setKept((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // On Keep, kept tickets fly into the missions peek toggle and discards drop away, then we
  // commit (instant under reduced motion or when measurement is unavailable). Targets are
  // measured live so the flight lands where they are.
  const confirm = (): void => {
    if (confirming || confirmDisabled === true) return;
    const ids = [...kept];
    if (reduced) {
      onConfirm(ids);
      return;
    }
    void (async () => {
      const target = await measureIn(keptToggleRef.current);
      if (!target) {
        onConfirm(ids);
        return;
      }
      const next = new Map<string, Flight>();
      await Promise.all(
        offered.map(async (id) => {
          if (!kept.has(id)) {
            next.set(id, { dx: 0, dy: 140, keep: false });
            return;
          }
          const r = await measureIn(slotRefs.get(id) ?? null);
          if (!r) return;
          next.set(id, {
            dx: target.x + target.width / 2 - (r.x + r.width / 2),
            dy: target.y + target.height / 2 - (r.y + r.height / 2),
            keep: true,
          });
        }),
      );
      setFlights(next);
      setConfirming(true);
      Animated.timing(flightProgress, {
        toValue: 1,
        duration: FLIGHT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
      setTimeout(() => onConfirm(ids), FLIGHT_MS + 40);
    })();
  };

  const disabled = kept.size < minKeep || confirming || confirmDisabled === true;

  return (
    <View {...anchor} style={styles.chooser} accessibilityLabel={t('chooseTickets')}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('chooseTickets')}</Text>
        <Text style={styles.count}>{kept.size}</Text>
      </View>
      <Text style={styles.hint}>
        {t('keepAtLeast', { n: minKeep })} · {t('ticketPreviewHint')}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.offer}
      >
        {offered.map((id, i) => (
          <OfferSlot
            key={id}
            index={i}
            reduced={reduced}
            flight={confirming ? flights.get(id) : undefined}
            flightProgress={flightProgress}
            onRef={(v) => {
              if (v) slotRefs.set(id, v);
              else slotRefs.delete(id);
            }}
          >
            <TicketCard
              ticketId={id}
              selected={kept.has(id)}
              onToggle={toggle}
              disabled={locked.has(id)}
            />
          </OfferSlot>
        ))}
      </ScrollView>

      <Pressable
        style={({ pressed }) => [
          styles.confirm,
          disabled && styles.confirmDisabled,
          pressed && !disabled && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={confirm}
      >
        <Text style={styles.confirmText}>
          {t('keep')} ({kept.size})
        </Text>
      </Pressable>

      {/* Peek at the player's own cards/tickets — hidden because the chooser replaced the rail. */}
      <Pressable
        style={styles.peekToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: showHand }}
        onPress={() => setShowHand((v) => !v)}
      >
        {showHand ? <ChevronDown size={15} color={INK} /> : <ChevronRight size={15} color={INK} />}
        <Text style={styles.peekLabel}>{t('cards')}</Text>
        <Text style={styles.count}>{handCount}</Text>
      </Pressable>
      {showHand && <PlayerHand hand={hand} />}

      <Pressable
        ref={keptToggleRef}
        collapsable={false}
        style={styles.peekToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: showTickets }}
        onPress={() => setShowTickets((v) => !v)}
      >
        {showTickets ? (
          <ChevronDown size={15} color={INK} />
        ) : (
          <ChevronRight size={15} color={INK} />
        )}
        <Text style={styles.peekLabel}>{t('tickets')}</Text>
        <Text style={styles.count}>{keptTicketIds.length}</Text>
      </Pressable>
      {showTickets && <TicketPanel ticketIds={keptTicketIds} completedIds={completedIds} />}
    </View>
  );
}

const styles = StyleSheet.create({
  chooser: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700' },
  count: {
    minWidth: 20,
    textAlign: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.08)',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  hint: { fontSize: 12, opacity: 0.6 },
  offer: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  confirm: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: '#0f5fa6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDisabled: { opacity: 0.45 },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.8 },
  peekToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 4,
  },
  peekLabel: { fontSize: 13, fontWeight: '600', flex: 1 },
});
