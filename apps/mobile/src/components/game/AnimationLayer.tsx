// Absolute-fill overlay above the board + HUD (ports the web AnimationLayer, minus the portal —
// GameStage mounts it last so it stacks on top): travelling cards, score floats, opponents'
// ticket cues, the fanfare, the endgame warning, the event banner and the notification chips.
// Positions come from the measured anim-target registry instead of DOM rects.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useAnimationsStore, type Float, type TicketCue } from '../../store/animations';
import { useGameStore } from '../../store/game';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { seatColor } from '../../theme/colors';
import { measureAnimTarget } from './animTargets';
import { FlightMover } from './FlightMover';
import { TicketCard } from './TicketCard';
import { TicketFanfare } from './TicketFanfare';
import { EndgameWarning } from './EndgameWarning';
import { EventBanner } from './EventBanner';
import { NotificationStack } from './NotificationStack';

/** A floating "+N" rising from a player's tracker when they score. */
function FloatMover({ float }: { float: Float }) {
  const removeFloat = useAnimationsStore((s) => s.removeFloat);
  const seat = useGameStore(
    (s) => s.snapshot?.players.find((p) => p.id === float.playerId)?.seat ?? 0,
  );
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rise = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    void measureAnimTarget(`player-${float.playerId}`).then((r) => {
      if (cancelled) return;
      if (!r) {
        removeFloat(float.id);
        return;
      }
      setPos({ left: r.x + r.w - 30, top: r.y + 2 });
      opacity.value = withTiming(1, { duration: 120 });
      rise.value = withTiming(-26, { duration: 1300, easing: Easing.out(Easing.ease) });
      opacity.value = withDelay(700, withTiming(0, { duration: 600 }));
    });
    const fallback = setTimeout(() => removeFloat(float.id), 1300);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, [float, removeFloat, rise, opacity]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: rise.value }],
    opacity: opacity.value,
  }));

  if (!pos) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.float, pos, anim]}>
      <Text style={[styles.floatText, { color: seatColor(seat) }]}>+{float.amount}</Text>
    </Animated.View>
  );
}

/** An opponent's completion: a small revealed ticket card near their tracker (no screen takeover). */
function TicketCueView({ cue }: { cue: TicketCue }) {
  const { t } = useTranslation();
  const removeTicketCue = useAnimationsStore((s) => s.removeTicketCue);
  const { width: windowW } = useWindowDimensions();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const opacity = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    void measureAnimTarget(`player-${cue.playerId}`).then((r) => {
      if (cancelled) return;
      if (!r) {
        removeTicketCue(cue.id);
        return;
      }
      setPos({ left: Math.min(r.x, windowW - 180), top: r.y + r.h + 6 });
      opacity.value = withTiming(1, { duration: 200 });
      opacity.value = withDelay(2300, withTiming(0, { duration: 400 }));
    });
    const fallback = setTimeout(() => removeTicketCue(cue.id), 2800);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, [cue, removeTicketCue, windowW, opacity]);

  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!pos) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ticketCue, pos, { borderColor: seatColor(cue.seat) }, anim]}
    >
      <Text style={styles.ticketCueLabel}>{t('completedTicket')}</Text>
      <TicketCard ticketId={cue.ticketId} />
    </Animated.View>
  );
}

/** Full-screen overlay: travelling cards, score floats, opponent cues, banners and the fanfare. */
export function AnimationLayer() {
  const flights = useAnimationsStore((s) => s.flights);
  const floats = useAnimationsStore((s) => s.floats);
  const ticketCues = useAnimationsStore((s) => s.ticketCues);
  const fanfare = useAnimationsStore((s) => s.fanfare);
  const dismissFanfare = useAnimationsStore((s) => s.dismissFanfare);
  const endgameCue = useAnimationsStore((s) => s.endgameCue);
  const dismissEndgameWarning = useAnimationsStore((s) => s.dismissEndgameWarning);
  const eventBanner = useAnimationsStore((s) => s.eventBanner);
  const dismissEventBanner = useAnimationsStore((s) => s.dismissEventBanner);
  const reduced = useReducedMotion();
  return (
    <View style={styles.layer} pointerEvents="box-none">
      {flights.map((f) => (
        <FlightMover key={f.id} flight={f} />
      ))}
      {floats.map((f) => (
        <FloatMover key={f.id} float={f} />
      ))}
      {ticketCues.map((c) => (
        <TicketCueView key={c.id} cue={c} />
      ))}
      {fanfare && (
        <TicketFanfare
          key={fanfare.id}
          fanfare={fanfare}
          reducedMotion={reduced}
          onDone={dismissFanfare}
        />
      )}
      {endgameCue && (
        <EndgameWarning
          key={endgameCue.id}
          cue={endgameCue}
          reducedMotion={reduced}
          onDone={dismissEndgameWarning}
        />
      )}
      {eventBanner && (
        <EventBanner
          key={eventBanner.id}
          cue={eventBanner}
          reducedMotion={reduced}
          onDone={dismissEventBanner}
        />
      )}
      <NotificationStack />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  float: { position: 'absolute' },
  floatText: {
    fontSize: 18,
    fontWeight: '800',
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowRadius: 4,
  },
  ticketCue: {
    position: 'absolute',
    width: 170,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: '#fffdf8',
    padding: 8,
    gap: 4,
    alignItems: 'center',
    elevation: 4,
  },
  ticketCueLabel: { fontSize: 11, fontWeight: '700', opacity: 0.7 },
});
