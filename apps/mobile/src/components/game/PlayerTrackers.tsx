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
import { seatColor, teamColor } from '../../theme/colors';
import { useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';
import { useAnimationsStore } from '../../store/animations';
import { playerLiveTotal } from '../../game/tickets';
import { usePlayerName } from '../../game/playerName';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { registerAnimTarget } from './animTargets';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../../features/tutorial/targets';
import { PlayerActionSheet, canModerate } from './PlayerActionSheet';

const isBot = (id: string): boolean => id.startsWith('bot:');
const STAT_ICON = 12;

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
  const { tokens } = useTheme();
  const statInk = tokens.inkSoft;
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
                { borderColor: tokens.line, backgroundColor: rgba(tokens.ink, 0.03) },
                current && {
                  borderColor: tokens.ember,
                  backgroundColor: rgba(tokens.ember, 0.08),
                },
                cued &&
                  (turnCue?.isYou
                    ? { backgroundColor: rgba(tokens.ember, 0.18) }
                    : { backgroundColor: rgba(tokens.blue, 0.16) }),
              ]}
            >
              {cued && <CueRing color={seatColor(p.seat)} reduced={reduced} />}
              <View style={[styles.seatDot, { backgroundColor: seatColor(p.seat) }]} />
              {p.team >= 0 && (
                <View style={[styles.teamBadge, { backgroundColor: teamColor(p.team) }]}>
                  <Text style={styles.teamBadgeText}>{t('teamName', { n: p.team + 1 })}</Text>
                </View>
              )}
              {isBot(p.id) && (
                <View testID={`bot-badge-${p.id}`}>
                  <Bot size={13} color={statInk} />
                </View>
              )}
              <Text style={[styles.name, { color: tokens.ink }]} numberOfLines={1}>
                {nameOf({ id: p.id, seat: p.seat, isMe })}
              </Text>
              <View style={styles.stats}>
                <Stat
                  icon={<Train size={STAT_ICON} color={statInk} />}
                  label={t('trainCars')}
                  value={p.trainCars}
                  ink={statInk}
                />
                <Stat
                  icon={<Trophy size={STAT_ICON} color={statInk} />}
                  label={t('score')}
                  value={playerLiveTotal(snapshot, p.id)}
                  ink={statInk}
                />
                <Stat
                  icon={<Layers size={STAT_ICON} color={statInk} />}
                  label={t('cards')}
                  value={p.handCount}
                  ink={statInk}
                />
                <Stat
                  icon={<Ticket size={STAT_ICON} color={statInk} />}
                  label={t('tickets')}
                  value={p.ticketCount}
                  ink={statInk}
                />
                <Stat
                  icon={<Building2 size={STAT_ICON} color={statInk} />}
                  label={t('stations')}
                  value={p.stationsRemaining}
                  ink={statInk}
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

function Stat({
  icon,
  label,
  value,
  ink,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  ink: string;
}) {
  return (
    <View style={styles.stat} accessibilityLabel={`${label} ${value}`}>
      {icon}
      <Text style={[styles.statText, { color: ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  trackers: { gap: 5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
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
  teamBadge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999 },
  teamBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  name: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  statText: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
