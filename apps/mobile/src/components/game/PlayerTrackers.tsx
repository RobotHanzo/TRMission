// Per-player status rows (ports the web PlayerTrackers). Issue #14: a row carries only the two
// numbers read at a glance — live score and remaining train cars — over a baseline that IS the
// rolling-stock gauge (it depletes in the seat colour, and goes ember once the supply is low, so
// "who is about to end this game" reads without arithmetic). Everything else the row used to
// cram in opens in the PlayerCard sheet when the row is tapped.
//
// Rows register as flight targets (`player-{id}`) for the Task 10 card-flight animations; the
// turn cue pulses the row's seat-colour ring (and scales your own row — web anim-turn-pulse /
// anim-your-turn) for 2.2s when the animation driver announces a handover.
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Train } from 'lucide-react-native';
import type { GameSnapshot } from '@trm/proto';
import { isLowOnTrains, trainSupplyFraction } from '@trm/client-core/game/playerCard';
import { seatColor, teamColor } from '../../theme/colors';
import { useTheme } from '../../theme/useTheme';
import { rgba } from '../../theme/shade';
import { useAnimationsStore } from '../../store/animations';
import { playerLiveTotal } from '../../game/tickets';
import { usePlayerAvatar, usePlayerName } from '../../game/playerName';
import { ACTIVE_RULES } from '../../game/content';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { registerAnimTarget } from './animTargets';
import { TUTORIAL_ANCHORS, useTutorialAnchor } from '../../features/tutorial/targets';
import { PlayerActionSheet, canModerate } from './PlayerActionSheet';
import { SeatAvatar } from './SeatAvatar';

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

export function PlayerTrackers({
  snapshot,
  onInspect,
  inspectedId,
}: {
  snapshot: GameSnapshot;
  /** Opens the player card sheet. Omitted where trackers render read-only. */
  onInspect?: ((playerId: string) => void) | undefined;
  inspectedId?: string | null | undefined;
}) {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const statInk = tokens.inkSoft;
  const nameOf = usePlayerName();
  const avatarOf = usePlayerAvatar();
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
        const name = nameOf({ id: p.id, seat: p.seat, isMe });
        const low = isLowOnTrains(p.trainCars);
        const pct = trainSupplyFraction(p.trainCars, ACTIVE_RULES.trainCarsStart);
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
              accessibilityState={{ selected: current, expanded: inspectedId === p.id }}
              accessibilityLabel={onInspect ? t('inspectPlayer', { name }) : undefined}
              onPress={onInspect ? () => onInspect(p.id) : undefined}
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
                inspectedId === p.id && { borderColor: tokens.blue },
                cued &&
                  (turnCue?.isYou
                    ? { backgroundColor: rgba(tokens.ember, 0.18) }
                    : { backgroundColor: rgba(tokens.blue, 0.16) }),
              ]}
            >
              {cued && <CueRing color={seatColor(p.seat)} reduced={reduced} />}
              {/* The avatar IS the bot badge now — a bot renders the Bot glyph inside its ring. */}
              <View testID={isBot(p.id) ? `bot-badge-${p.id}` : undefined}>
                <SeatAvatar
                  avatar={avatarOf({ id: p.id, seat: p.seat, displayName: name })}
                  seat={p.seat}
                />
              </View>
              {p.team >= 0 && (
                <View style={[styles.teamBadge, { backgroundColor: teamColor(p.team) }]}>
                  <Text style={styles.teamBadgeText}>{t('teamName', { n: p.team + 1 })}</Text>
                </View>
              )}
              <Text style={[styles.name, { color: tokens.ink }]} numberOfLines={1}>
                {name}
              </Text>
              <View style={styles.cars} accessibilityLabel={`${t('trainCars')} ${p.trainCars}`}>
                <Train size={STAT_ICON} color={low ? tokens.ember : statInk} />
                <Text
                  style={[
                    styles.carsText,
                    { color: low ? tokens.ember : statInk },
                    low && styles.carsLow,
                  ]}
                >
                  {p.trainCars}
                </Text>
              </View>
              <Text
                style={[styles.score, { color: tokens.ink }]}
                accessibilityLabel={`${t('score')} ${playerLiveTotal(snapshot, p.id)}`}
              >
                {playerLiveTotal(snapshot, p.id)}
              </Text>
              {/* The row's baseline is the rolling-stock gauge (web .tracker-gauge). */}
              <View style={[styles.gauge, { backgroundColor: rgba(tokens.ink, 0.08) }]}>
                <View
                  style={[
                    styles.gaugeFill,
                    {
                      width: `${pct * 100}%`,
                      backgroundColor: low ? tokens.ember : seatColor(p.seat),
                    },
                  ]}
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

const styles = StyleSheet.create({
  trackers: { gap: 5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 7,
    paddingBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
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
  teamBadge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999 },
  teamBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  name: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  cars: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  carsText: { fontSize: 12, fontVariant: ['tabular-nums'] },
  carsLow: { fontWeight: '700' },
  score: {
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 30,
    textAlign: 'right',
  },
  gauge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  gaugeFill: { height: '100%' },
});
