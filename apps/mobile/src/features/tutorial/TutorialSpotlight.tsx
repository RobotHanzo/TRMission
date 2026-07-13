// Non-blocking focus scrim: dims the stage and punches a lit, ringed hole around each target.
// pointerEvents="none" so the learner can still tap the highlighted element (web parity). The
// ring pulse uses core RN Animated (no extra deps) and goes static under reduced motion.
import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Path, RoundedRect, Skia, type SkPath } from '@shopify/react-native-skia';
import { scrimPath, SPOT_PAD, SPOT_RADIUS } from './scrim';
import type { FlatRect } from './focus';

/** The even-odd scrim path, built as a native SkPath ONCE per rects change. Handing <Path> a
 *  ready SkPath (instead of the SVG string) skips RNSkia's per-render string re-parse — during a
 *  spotlight glide the rects change every frame, so that parse used to run at frame rate. Falls
 *  back to the (spec-tested) SVG string where the Path API is absent (the jest Skia mock). */
function buildScrimPath(w: number, h: number, holes: FlatRect[]): SkPath | string {
  try {
    const p = Skia.Path.Make();
    p.addRect(Skia.XYWHRect(0, 0, w, h));
    for (const r of holes) {
      p.addRRect(
        Skia.RRectXY(
          Skia.XYWHRect(r.x - SPOT_PAD, r.y - SPOT_PAD, r.w + SPOT_PAD * 2, r.h + SPOT_PAD * 2),
          SPOT_RADIUS,
          SPOT_RADIUS,
        ),
      );
    }
    return p;
  } catch {
    return scrimPath(w, h, holes);
  }
}

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
  const dimPath = useMemo(() => buildScrimPath(width, height, rects), [width, height, rects]);

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
        <Path path={dimPath} color={DIM_COLOR} fillType="evenOdd" />
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
