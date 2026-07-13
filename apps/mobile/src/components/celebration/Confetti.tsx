// Celebration confetti — the RN counterpart of the web's canvas-confetti moments (endgame
// scoreboard, ticket fanfare, tutorial finale all reuse THIS one component). While `active`,
// paired bursts launch from both screen edges on the shared cadence. Plain RN Animated
// (low-frequency UI): one driver Value per burst, per-particle interpolations, native driver,
// `isInteraction: false` so the repeating bursts never wedge InteractionManager. No-op under
// reduced motion.
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import { CONFETTI_COLORS, CONFETTI_INTERVAL_MS } from '@trm/client-core/theme/colors';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const PARTICLES_PER_SIDE = 12;
const BURST_MS = 1600;
// Backstop: a slow device can't accumulate unbounded live bursts.
const MAX_LIVE_BURSTS = 3;

interface Particle {
  /** Horizontal reach over the burst lifetime (px, signed toward screen centre). */
  vx: number;
  /** Ballistic arc: rise to `peak` (negative px) then settle at `fall` (positive px). */
  peak: number;
  fall: number;
  size: number;
  color: string;
  /** Total rotation over the lifetime (deg, signed). */
  spin: number;
}

const makeParticles = (side: 'left' | 'right', w: number, h: number): Particle[] =>
  Array.from({ length: PARTICLES_PER_SIDE }, () => {
    const dir = side === 'left' ? 1 : -1;
    return {
      vx: dir * (0.2 + Math.random() * 0.5) * w,
      peak: -(0.15 + Math.random() * 0.32) * h,
      fall: (0.2 + Math.random() * 0.3) * h,
      size: 6 + Math.random() * 6,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ?? '#e8732c',
      spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
    };
  });

/** One paired side-burst (both edges at ~65% height, mirroring the web's origin). */
function Burst({ onDone }: { onDone(): void }) {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const sides = useRef<[Particle[], Particle[]]>([
    makeParticles('left', width, height),
    makeParticles('right', width, height),
  ]).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: BURST_MS,
      useNativeDriver: true,
      isInteraction: false,
    });
    anim.start(({ finished }) => {
      if (finished) onDoneRef.current();
    });
    return () => anim.stop();
  }, [progress]);

  return (
    <>
      {sides.map((particles, s) =>
        particles.map((p, i) => (
          <Animated.View
            key={`${s}-${i}`}
            style={{
              position: 'absolute',
              top: height * 0.65,
              left: s === 0 ? -12 : width + 12 - p.size,
              width: p.size,
              height: p.size * 0.55,
              borderRadius: 1,
              backgroundColor: p.color,
              opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
              transform: [
                {
                  translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.vx] }),
                },
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 0.4, 1],
                    outputRange: [0, p.peak, p.fall],
                  }),
                },
                {
                  rotate: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', `${p.spin}deg`],
                  }),
                },
              ],
            }}
          />
        )),
      )}
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
