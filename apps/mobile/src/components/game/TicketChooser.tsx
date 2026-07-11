// The destination-ticket chooser (ports the web TicketChooser), rendered as a panel — not a
// backdrop modal — so the board stays visible and pan/zoomable underneath: players preview the
// railways a ticket needs before committing. Because the panel takes over the usual hand and
// missions trays, it carries collapsible peeks at both. (The web's fly-to-missions confirm
// animation + deal sounds land with Tasks 10/11; confirm commits immediately here.)
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import type { CardCounts } from '@trm/proto';
import { ticketById } from '../../game/content';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../../features/tutorial/targets';
import { TicketCard } from './TicketCard';
import { PlayerHand } from './PlayerHand';
import { TicketPanel } from './TicketPanel';

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
  const locked = lockLong
    ? new Set(offered.filter((id) => ticketById.get(id)?.deck === 'LONG'))
    : new Set<string>();
  const [kept, setKept] = useState<Set<string>>(() => new Set(offered)); // default: keep all
  const [showHand, setShowHand] = useState(false);
  const [showTickets, setShowTickets] = useState(false);

  const toggle = (id: string): void => {
    if (locked.has(id)) return;
    setKept((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const disabled = kept.size < minKeep || confirmDisabled === true;

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
        {offered.map((id) => (
          <TicketCard
            key={id}
            ticketId={id}
            selected={kept.has(id)}
            onToggle={toggle}
            disabled={locked.has(id)}
          />
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
        onPress={() => onConfirm([...kept])}
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
