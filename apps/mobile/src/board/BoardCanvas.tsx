// The board's canvas host — NATIVE implementation. The camera's Reanimated transform drives the
// Skia <Group> directly: gestures mutate shared values on the UI thread and RNSkia replays the
// (picture-cached) scene without any React involvement, which the P2 device gate proved fast.
// The react-native-web harness resolves BoardCanvas.web.tsx instead, where per-frame canvas
// redraws are the exact thing that must NOT happen (no UI thread, CanvasKit wasm) — the web host
// keeps the canvas at the settled camera and moves it with a composited CSS transform, like the
// web client's board. Keep this contract in sync across both files.
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Group } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import type { Viewport } from './camera';
import type { BoardCamera } from './useBoardCamera';

export interface BoardCanvasProps {
  cam: BoardCamera;
  /** The board viewport in dp (the web host sizes/positions its overdrawn canvas from it). */
  vp: Viewport;
  /** The MapSceneSkia subtree — the host owns the Canvas and the camera transform around it. */
  children: ReactNode;
}

export function BoardCanvas({ cam, children }: BoardCanvasProps): React.JSX.Element {
  return (
    <GestureDetector gesture={cam.gesture}>
      <Canvas style={styles.fill}>
        <Group transform={cam.transform}>{children}</Group>
      </Canvas>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
