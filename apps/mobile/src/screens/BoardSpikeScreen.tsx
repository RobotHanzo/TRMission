// Dev board screen (behind the __DEV__ Home button): the full Taiwan board rendered through the
// SHARED MapSceneSkia (paper roadbeds, car slots, tunnel ties, ferry pips, cities, labels) driven by
// the reusable useBoardCamera hook (pan / pinch / double-tap-zoom + quantized LOD). This is the P2
// device gate's visual target — the same rendering the online/offline BoardView will use, minus the
// snapshot/game-state wiring. Tap a route/city to see the hit-test result.
import { Canvas, Group } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  TAIWAN_CONTENT,
  TAIWAN_BASE_VIEW,
  MAP_PALETTE_LIGHT,
  buildRouteGeometryFor,
  computeHubsFor,
} from '@trm/map-data';
import { boundsOfContent, homeCamera, pinchTo, type CameraState } from '../board/camera';
import { buildHitScene, hitTest } from '../board/hitTest';
import { useBoardCamera } from '../board/useBoardCamera';
import { MapSceneSkia } from '../board/MapSceneSkia';
import { cityTier } from '../game/lod';

const P = MAP_PALETTE_LIGHT;

export function BoardSpikeScreen(): React.JSX.Element {
  const { width: w, height: h } = useWindowDimensions();
  const vp = { w, h };
  const { geometry } = useMemo(
    () => buildRouteGeometryFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes),
    [],
  );
  const hubs = useMemo(() => computeHubsFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes), []);
  const scene = useMemo(
    () => buildHitScene(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes, geometry),
    [geometry],
  );
  const home = useMemo(() => homeCamera(boundsOfContent(TAIWAN_CONTENT), vp), [w, h]);
  const [hitLabel, setHitLabel] = useState('tap a route or city');

  const onTap = (screen: { x: number; y: number }, cam: CameraState): void => {
    const hit = hitTest(screen, cam, vp, scene);
    setHitLabel(hit ? `${hit.kind}: ${hit.id}` : 'miss');
  };

  const cam = useBoardCamera(vp, TAIWAN_BASE_VIEW, home, { onTap });

  const centerZoom = (factor: number): void =>
    cam.animateTo(
      pinchTo(cam.currentCamera(), { x: w / 2, y: h / 2 }, factor, vp, TAIWAN_BASE_VIEW),
      180,
    );
  const reset = (): void => cam.animateTo(homeCamera(boundsOfContent(TAIWAN_CONTENT), vp), 220);

  return (
    <View style={[styles.fill, { backgroundColor: P.sea }]}>
      <GestureDetector gesture={cam.gesture}>
        <Canvas style={styles.fill}>
          <Group transform={cam.transform}>
            <MapSceneSkia
              cities={TAIWAN_CONTENT.cities}
              routes={TAIWAN_CONTENT.routes}
              geometry={geometry}
              hubs={hubs}
              geography={null}
              view={TAIWAN_BASE_VIEW}
              cityLabel={(c) => c.id}
              cityTier={cityTier}
              bucket={cam.lod.bucket}
              inv={cam.lod.inv}
              marker={cam.lod.marker}
            />
          </Group>
        </Canvas>
      </GestureDetector>

      <View style={styles.controls}>
        <Ctl label="+" onPress={() => centerZoom(1.4)} />
        <Ctl label="−" onPress={() => centerZoom(1 / 1.4)} />
        <Ctl label="⤢" onPress={reset} />
      </View>
      <Text style={styles.hit}>{hitLabel}</Text>
    </View>
  );
}

function Ctl({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ctl, pressed && styles.ctlPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.ctlText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  controls: { position: 'absolute', right: 16, bottom: 44, gap: 10 },
  ctl: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: P.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: P.coast,
  },
  ctlPressed: { backgroundColor: P.relief },
  ctlText: { fontSize: 22, color: P.ink, lineHeight: 26 },
  hit: {
    position: 'absolute',
    top: 60,
    left: 16,
    color: P.ink,
    backgroundColor: 'rgba(255,253,248,0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
