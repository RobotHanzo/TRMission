// Celebration confetti — the RN counterpart of the web's canvas-confetti moments (endgame
// scoreboard, ticket fanfare, tutorial finale all reuse THIS one component). While `active`,
// paired explosions launch from both bottom corners on the shared cadence, built on
// react-native-confetti-cannon's explode-then-fall physics (gravity + tumble, the same feel
// canvas-confetti has — a hand-rolled Animated version couldn't quite match it). No-op under
// reduced motion.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import { CONFETTI_COLORS, CONFETTI_INTERVAL_MS } from '@trm/client-core/theme/colors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const PARTICLES_PER_SIDE = 24;
// Backstop: a slow device can't accumulate unbounded live bursts.
const MAX_LIVE_BURSTS = 3;

/** One paired burst: two cannons exploding inward from the bottom corners, at the same ~65%
 *  height the web version's confetti() origins use. */
function Burst({ onDone }: { onDone(): void }) {
  const { width, height } = useWindowDimensions();
  const y = height * 0.65;
  const colors = [...CONFETTI_COLORS];
  return (
    <>
      <ConfettiCannon
        count={PARTICLES_PER_SIDE}
        origin={{ x: -20, y }}
        colors={colors}
        fadeOut
        onAnimationEnd={onDone}
      />
      <ConfettiCannon count={PARTICLES_PER_SIDE} origin={{ x: width + 20, y }} colors={colors} fadeOut />
    </>
  );
}

/** Fires continuous confetti bursts from both sides while `active` (web `useConfetti`). */
export function Confetti({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const [bursts, setBursts] = useState<number[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (!active || reduced) {
      setBursts([]);
      return;
    }
    const fire = (): void =>
      setBursts((b) => (b.length >= MAX_LIVE_BURSTS ? b : [...b, nextId.current++]));
    fire();
    const id = setInterval(fire, CONFETTI_INTERVAL_MS);
    return () => clearInterval(id);
  }, [active, reduced]);

  if (bursts.length === 0) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="confetti">
      {bursts.map((id) => (
        <Burst key={id} onDone={() => setBursts((b) => b.filter((x) => x !== id))} />
      ))}
    </View>
  );
}
