// The ONLY file that touches P2's camera contract. BoardView PUSHES a source here while mounted
// (same registration pattern as the animTargets flight registry), so everything else consumes
// ReadBoardCamera and a P2 camera refactor touches exactly one tutorial file. The source returns
// the live span camera {cx, cy, span} (read on the JS thread via currentCamera()) plus the board
// viewport; this file maps it to the affine the rect math consumes.
import type { CameraState, Viewport } from '../../board/camera';
import type { BoardCameraSample } from './boardRects';

export type { BoardCameraSample };

/** Read the current camera; null when no board is mounted (spotlight then resolves no rects). */
export type ReadBoardCamera = () => BoardCameraSample | null;

/** What the mounted board publishes: its live camera + viewport, read synchronously. */
export type BoardCameraSource = () => { camera: CameraState; vp: Viewport };

let source: BoardCameraSource | null = null;

/** BoardView registers its reader on mount; the returned cleanup unregisters (mount-scoped, so
 *  a stale unmount never clobbers a newer board's registration). */
export function registerBoardCameraSource(s: BoardCameraSource): () => void {
  source = s;
  return () => {
    if (source === s) source = null;
  };
}

/** Span camera → screen affine: s = vp.w/span px per board unit, translate = viewport centre −
 *  camera centre·s. The Skia scene draws raw 0–100 board units, so the board→content projection
 *  is the identity (k=1, e=f=0) — unlike the web's SVG, there is no content-pixel frame. */
export function sampleFromCamera(camera: CameraState, vp: Viewport): BoardCameraSample {
  const s = vp.w / camera.span;
  return {
    transform: {
      positionX: vp.w / 2 - camera.cx * s,
      positionY: vp.h / 2 - camera.cy * s,
      scale: s,
    },
    proj: { k: 1, e: 0, f: 0 },
  };
}

const readBoardCamera: ReadBoardCamera = () => {
  if (!source) return null;
  const { camera, vp } = source();
  return sampleFromCamera(camera, vp);
};

/** Default reader wired to the registered board. A stable module-level function on purpose:
 *  useSpotlightRects lists it in effect deps and polls during its tracking window, so it must
 *  not subscribe or change identity. */
export function useBoardCameraReader(): ReadBoardCamera {
  return readBoardCamera;
}
