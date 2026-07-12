// Path shim so the tutorial core stays byte-identical to apps/web (its types.ts imports
// `BoardFrameTarget` from '../../game/boardView'). Mobile models the camera natively in board
// units (see board/camera.ts), so only the screen-independent pieces of the web's boardView
// exist here: the frame-target model (re-exported from its P2 home) and the two affine shapes
// the tutorial's spotlight projection consumes. On mobile the Skia scene draws directly in
// board units, so the projection is the identity ({k: 1, e: 0, f: 0}) — the camera bridge
// (features/tutorial/cameraBridge.ts) is the only producer.
export type { BoardFrameTarget } from '../board/frameTarget';

/** The board pan/zoom as a pixel affine (web rzpp shape; derived from {cx,cy,span} on mobile). */
export interface BoardTransform {
  /** Horizontal pan in screen pixels. */
  positionX: number;
  /** Vertical pan in screen pixels. */
  positionY: number;
  /** Zoom multiplier (screen pixels per scene unit). */
  scale: number;
}

/** The board→scene-unit affine: a scene unit is `k·board + (e,f)`. Identity on mobile. */
export interface BoardProjection {
  k: number;
  e: number;
  f: number;
}
