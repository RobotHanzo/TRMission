// One in-flight card, animated from its source (deck/market slot) to its target (hand/tracker) —
// ports the web AnimationLayer's FlightMover onto Reanimated + the measured anim-target registry.
// A missing target (e.g. the dock tab holding it isn't mounted) or reduced motion finishes the
// flight immediately, exactly like the web's missing-selector fallback.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Train } from 'lucide-react-native';
import { useAnimationsStore, type Flight } from '../../store/animations';
import { useGameStore } from '../../store/game';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { measureAnimTarget } from './animTargets';
import { TrainCarCard } from './TrainCarCard';

// Cards travel at hand-card size (not the tiny deck/slot footprint), so the draw reads clearly.
const CARD_W = 120;
const CARD_H = Math.round((CARD_W * 92) / 132);

export function FlightMover({ flight }: { flight: Flight }) {
  const removeFlight = useAnimationsStore((s) => s.removeFlight);
  const me = useGameStore((s) => s.snapshot?.you?.playerId ?? null);
  const reduced = useReducedMotion();
  const [origin, setOrigin] = useState<{ left: number; top: number } | null>(null);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(1);
  const done = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const finish = (): void => {
      if (done.current) return;
      done.current = true;
      removeFlight(flight.id);
    };
    const srcKey = flight.slot !== null ? `market-slot-${flight.slot}` : 'deck';
    const dstKey = flight.toPlayerId === me ? 'hand' : `player-${flight.toPlayerId}`;
    // `dock` is the compact-layout fallback: on phones the hand/tracker destination lives in a
    // dock tab that may be inactive (unmounted) mid-draw, so its precise target is gone. The dock
    // itself is always mounted, so the card still flies into the tray region — restoring the draw
    // animation the tablet layouts get for free (both panels mounted). Null on wider tiers, where
    // the primary target is always present anyway.
    void Promise.all([
      measureAnimTarget(srcKey),
      measureAnimTarget(dstKey),
      measureAnimTarget('dock'),
    ]).then(([src, dstPrimary, dstFallback]) => {
      if (cancelled) return;
      const dst = dstPrimary ?? dstFallback;
      if (!src || !dst || reduced) {
        finish();
        return;
      }
      const srcCx = src.x + src.w / 2;
      const srcCy = src.y + src.h / 2;
      // Fixed card size centred on the source; the card appears to grow out of the deck/slot.
      setOrigin({ left: srcCx - CARD_W / 2, top: srcCy - CARD_H / 2 });
      const dx = dst.x + dst.w / 2 - srcCx;
      const dy = dst.y + dst.h / 2 - srcCy;
      const move = { duration: 600, easing: Easing.bezier(0.4, 0, 0.2, 1) };
      tx.value = withTiming(dx, move);
      ty.value = withTiming(dy, move);
      scale.value = withTiming(1, move);
      opacity.value = withTiming(0.1, { duration: 600, easing: Easing.ease }, () =>
        runOnJS(finish)(),
      );
    });
    const failsafe = setTimeout(finish, 1000);
    return () => {
      cancelled = true;
      clearTimeout(failsafe);
    };
  }, [flight, me, reduced, removeFlight, tx, ty, scale, opacity]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!origin) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.card, { left: origin.left, top: origin.top }, anim]}
    >
      {flight.color ? (
        // Your own draw shows the real train-car card…
        <TrainCarCard color={flight.color} showGlyph showCount={false} size={CARD_W} />
      ) : (
        // …an opponent's (or a blind) draw shows a branded card-back.
        <View style={styles.cover}>
          <Train color="#fff" size={26} />
          <Text style={styles.coverName}>台鐵任務</Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', width: CARD_W, height: CARD_H },
  cover: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#0f5fa6',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  coverName: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 2 },
});
