// Per-player status rows (ports the web PlayerTrackers): seat colour, roster name, live score,
// hand/ticket/train/station counts, current-turn ring, bot badge. Rows register as flight
// targets (`player-{id}`) for the Task 10 card-flight animations; the turn cue pulses the row's
// seat-colour ring (and scales your own row — web anim-turn-pulse / anim-your-turn) for 2.2s
// when the animation driver announces a handover.
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bot, Building2, Layers, Ticket, Train, Trophy } from 'lucide-react-native';
import type { GameSnapshot } from '@trm/proto';
import { seatColor } from '../../theme/colors';
import { useAnimationsStore } from '../../store/animations';
import { playerLiveTotal } from '../../game/tickets';
import { usePlayerName } from '../../game/playerName';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { registerAnimTarget } from './animTargets';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../../features/tutorial/targets';
import { PlayerActionSheet, canModerate } from './PlayerActionSheet';

const isBot = (id: string): boolean => id.startsWith('bot:');
const STAT_ICON = 12;
const STAT_INK = '#4b5563';

/** Scales the local player's own row 1→1.04→1 while their turn cue runs (web anim-your-turn). */
function TurnCueWrap({
  pulse,
  reduced,
  children,
}: PropsWithChildren<{ pulse: boolean; reduced: boolean }>) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse || reduced) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.04,
          duration: 270,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 630,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
      { iterations: 2 },
    );
    anim.start();
    return () => anim.stop();
  }, [pulse, reduced, scale]);
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

/** The cued row's seat-colour ring, pulsing out 3 times (web anim-turn-pulse's box-shadow). */
function CueRing({ color, reduced }: { color: string; reduced: boolean }) {
  const opacity = useRef(new Animated.Value(reduced ? 0.55 : 0.9)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.loop(
      Animated.timing(opacity, {
        toValue: 0,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
        isInteraction: false,
      }),
      { iterations: 3 },
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, reduced]);
  return (
    <Animated.View pointerEvents="none" style={[styles.cueRing, { borderColor: color, opacity }]} />
  );
}

export function PlayerTrackers({ snapshot }: { snapshot: GameSnapshot }) {
  const { t } = useTranslation();
  const nameOf = usePlayerName();
  const turnCue = useAnimationsStore((s) => s.turnCue);
  const clearTurnCue = useAnimationsStore((s) => s.clearTurnCue);
  const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.trackers);
  const reduced = useReducedMotion();
  const [sheetTarget, setSheetTarget] = useState<{ id: string; name: string } | null>(null);
  const me = snapshot.you?.playerId ?? null;

  useEffect(() => {
    if (!turnCue) return;
    const id = setTimeout(() => clearTurnCue(turnCue.id), 2200);
    return () => clearTimeout(id);
  }, [turnCue, clearTurnCue]);

  return (
    <View {...anchor} style={styles.trackers} accessibilityRole="list">
      {snapshot.players.map((p) => {
        const current = p.id === snapshot.currentPlayerId;
        const isMe = p.id === snapshot.you?.playerId;
        const cued = turnCue?.playerId === p.id;
        return (
          // Keyed per cue id so a fresh handover re-fires the pulse (web's `${p.id}:${cue.id}`).
          <TurnCueWrap
            key={cued ? `${p.id}:${turnCue?.id}` : p.id}
            pulse={cued && turnCue?.isYou === true}
            reduced={reduced}
          >
            <Pressable
              testID={`tracker-${p.id}`}
              ref={(v) => registerAnimTarget(`player-${p.id}`, v)}
              accessibilityState={{ selected: current }}
              onLongPress={() => {
                if (!canModerate(p.id, me)) return;
                setSheetTarget({ id: p.id, name: nameOf({ id: p.id, seat: p.seat }) });
              }}
              style={[
                styles.row,
                current && styles.rowCurrent,
                cued && (turnCue?.isYou ? styles.rowYourTurn : styles.rowCued),
              ]}
            >
              {cued && <CueRing color={seatColor(p.seat)} reduced={reduced} />}
              <View style={[styles.seatDot, { backgroundColor: seatColor(p.seat) }]} />
              {isBot(p.id) && (
                <View testID={`bot-badge-${p.id}`}>
                  <Bot size={13} color={STAT_INK} />
                </View>
              )}
              <Text style={styles.name} numberOfLines={1}>
                {nameOf({ id: p.id, seat: p.seat, isMe })}
              </Text>
              <View style={styles.stats}>
                <Stat
                  icon={<Train size={STAT_ICON} color={STAT_INK} />}
                  label={t('trainCars')}
                  value={p.trainCars}
                />
                <Stat
                  icon={<Trophy size={STAT_ICON} color={STAT_INK} />}
                  label={t('score')}
                  value={playerLiveTotal(snapshot, p.id)}
                />
                <Stat
                  icon={<Layers size={STAT_ICON} color={STAT_INK} />}
                  label={t('cards')}
                  value={p.handCount}
                />
                <Stat
                  icon={<Ticket size={STAT_ICON} color={STAT_INK} />}
                  label={t('tickets')}
                  value={p.ticketCount}
                />
                <Stat
                  icon={<Building2 size={STAT_ICON} color={STAT_INK} />}
                  label={t('stations')}
                  value={p.stationsRemaining}
                />
              </View>
            </Pressable>
          </TurnCueWrap>
        );
      })}
      {sheetTarget && (
        <PlayerActionSheet target={sheetTarget} onClose={() => setSheetTarget(null)} />
      )}
    </View>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label} ${value}`}>
      {icon}
      <Text style={styles.statText}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  trackers: { gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  rowCurrent: { borderColor: '#0f5fa6', backgroundColor: 'rgba(15,95,166,0.08)' },
  rowCued: { backgroundColor: 'rgba(15,95,166,0.16)' },
  rowYourTurn: { backgroundColor: 'rgba(238,107,31,0.18)' },
  cueRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    borderWidth: 2,
  },
  seatDot: { width: 10, height: 10, borderRadius: 5 },
  name: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  statText: { fontSize: 12, fontVariant: ['tabular-nums'], color: STAT_INK },
});
