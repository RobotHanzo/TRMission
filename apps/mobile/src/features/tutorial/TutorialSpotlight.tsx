// Non-blocking focus scrim: dims the stage and punches a lit, ringed hole around each target.
// pointerEvents="none" so the learner can still tap the highlighted element (web parity). The
// ring pulse uses core RN Animated (no extra deps) and goes static under reduced motion.
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Path, RoundedRect } from '@shopify/react-native-skia';
import { scrimPath, SPOT_PAD, SPOT_RADIUS } from './scrim';
import type { FlatRect } from './focus';

const DIM_COLOR = 'rgba(10, 14, 22, 0.55)';
const RING_COLOR = 'rgba(126, 190, 255, 0.9)';

export function TutorialSpotlight({
  rects,
  reducedMotion,
  dimAll = false,
}: {
  rects: FlatRect[];
  reducedMotion: boolean;
  /** Dim the whole stage when there are no cutouts. TRUE only when the beat intends no specific
   *  target; a named-but-unresolved target renders NOTHING (never hide the taught element). */
  dimAll?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const pulse = useRef(new Animated.Value(1)).current;
  const hasHoles = rects.length > 0;

  useEffect(() => {
    if (reducedMotion || !hasHoles) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, hasHoles, pulse]);

  if (!hasHoles && !dimAll) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="tut-spotlight">
      <Canvas style={{ width, height }}>
        <Path path={scrimPath(width, height, rects)} color={DIM_COLOR} fillType="evenOdd" />
      </Canvas>
      {hasHoles && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: reducedMotion ? 1 : pulse }]}>
          <Canvas style={{ width, height }}>
            {rects.map((r, i) => (
              <RoundedRect
                key={i}
                x={r.x - SPOT_PAD}
                y={r.y - SPOT_PAD}
                width={r.w + SPOT_PAD * 2}
                height={r.h + SPOT_PAD * 2}
                r={SPOT_RADIUS}
                color={RING_COLOR}
                style="stroke"
                strokeWidth={2}
              />
            ))}
          </Canvas>
        </Animated.View>
      )}
    </View>
  );
}
