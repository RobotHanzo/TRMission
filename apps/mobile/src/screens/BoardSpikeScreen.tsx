// SPIKE (P2 Task 1): renders the full Taiwan board in one Skia canvas with pan/pinch/tap.
// Purpose is risk retirement, not reuse — Tasks 4/5 replace this with MapSceneSkia/BoardView.
import { Canvas, Circle, Group, Path, Rect, Skia } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import {
  TAIWAN_CONTENT,
  TAIWAN_BASE_VIEW,
  TAIWAN_LAND_PATH,
  buildRouteGeometryFor,
  ROUTE_COLOR_HEX,
} from '@trm/map-data';
import { boundsOfContent, clampSpan, homeCamera } from '../board/camera';
import { buildHitScene, hitTest } from '../board/hitTest';

export function BoardSpikeScreen(): React.JSX.Element {
  const { width: w, height: h } = useWindowDimensions();
  const vp = { w, h };
  const { geometry } = useMemo(
    () => buildRouteGeometryFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes),
    [],
  );
  const scene = useMemo(
    () => buildHitScene(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes, geometry),
    [geometry],
  );
  const land = useMemo(() => Skia.Path.MakeFromSVGString(TAIWAN_LAND_PATH)!, []);
  const home = useMemo(() => homeCamera(boundsOfContent(TAIWAN_CONTENT), vp), [w, h]);

  const cx = useSharedValue(home.cx);
  const cy = useSharedValue(home.cy);
  const span = useSharedValue(home.span);
  const pinchStartSpan = useSharedValue(home.span);
  const [hitLabel, setHitLabel] = useState('tap a route or city');

  const onTap = (x: number, y: number): void => {
    const cam = { cx: cx.value, cy: cy.value, span: span.value };
    const hit = hitTest({ x, y }, cam, vp, scene);
    setHitLabel(hit ? `${hit.kind}: ${hit.id}` : 'miss');
  };

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onChange((e) => {
      const s = w / span.value;
      cx.value -= e.changeX / s;
      cy.value -= e.changeY / s;
    });
  const pinch = Gesture.Pinch()
    .onStart(() => {
      pinchStartSpan.value = span.value;
    })
    .onChange((e) => {
      // Focal anchoring: board point under the focal stays put (camera.pinchTo, inlined
      // as a worklet — same math, shared-value form).
      const s0 = w / span.value;
      const bx = cx.value + (e.focalX - w / 2) / s0;
      const by = cy.value + (e.focalY - h / 2) / s0;
      const next = clampSpan(pinchStartSpan.value / e.scale, TAIWAN_BASE_VIEW);
      const s1 = w / next;
      span.value = next;
      cx.value = bx - (e.focalX - w / 2) / s1;
      cy.value = by - (e.focalY - h / 2) / s1;
    });
  const tap = Gesture.Tap().onEnd((e, ok) => {
    if (ok) runOnJS(onTap)(e.x, e.y);
  });
  const gesture = Gesture.Race(Gesture.Simultaneous(pan, pinch), tap);

  const transform = useDerivedValue(() => {
    const s = w / span.value;
    return [
      { translateX: w / 2 - cx.value * s },
      { translateY: h / 2 - cy.value * s },
      { scale: s },
    ];
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#0d1b26' }}>
      <GestureDetector gesture={gesture}>
        <Canvas style={{ flex: 1 }}>
          <Group transform={transform}>
            <Path path={land} color="#e8e0cd" />
            {[...geometry.entries()].map(([id, g]) => {
              const r = TAIWAN_CONTENT.routes.find((x) => (x.id as string) === id)!;
              const bed = Skia.Path.MakeFromSVGString(g.path)!;
              const fill = ROUTE_COLOR_HEX[r.color as keyof typeof ROUTE_COLOR_HEX];
              return (
                <Group key={id} transform={[{ translateX: g.perp.x }, { translateY: g.perp.y }]}>
                  <Path path={bed} style="stroke" strokeWidth={1.6} color="#f5efdf" />
                  {g.slots.map((s, i) => (
                    <Group
                      key={i}
                      transform={[
                        { translateX: s.x },
                        { translateY: s.y },
                        { rotate: (s.angle * Math.PI) / 180 },
                      ]}
                    >
                      <Rect x={-s.len / 2} y={-0.55} width={s.len} height={1.1} color={fill} />
                    </Group>
                  ))}
                </Group>
              );
            })}
            {TAIWAN_CONTENT.cities.map((c) => (
              <Circle key={c.id as string} cx={c.x} cy={c.y} r={0.9} color="#22303c" />
            ))}
          </Group>
        </Canvas>
      </GestureDetector>
      <Text style={{ position: 'absolute', top: 60, left: 16, color: 'white' }}>{hitLabel}</Text>
    </View>
  );
}
