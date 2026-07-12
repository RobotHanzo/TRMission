# Mobile P2 — Skia Board + Native Game Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REGROUND BEFORE EXECUTING:** this plan was written at spec time (2026-07-06). Before executing, re-verify library versions, file anchors, and the Consumes list against the then-current repo — prior phases will have moved things.

**Goal:** A full online TRMission game playable on phones and tablets: a Skia-canvas Taiwan board (geography → routes → cities → overlays) with pan/pinch/tap, camera-follow, LOD labels with system CJK fonts; the proven three-tier game stage (bottom-dock / two-pane / three-pane) with hand/draw/missions/events/players/comms panels; the claim flow with engine-mirrored payment previews; the snapshot-driven store fed by the existing WS plane; reconnect + offline awareness; the high-value animations and sound cues.

**Architecture:** Everything lands in `apps/mobile` (created by P1). The board is ONE Skia `<Canvas>` whose root `<Group>` carries a Reanimated-derived transform; all geometry comes from the same pure `@trm/map-data` math the web renders from (`buildRouteGeometryFor`, path strings, slots, ties, perp). The camera is modelled **natively in board units** as `{cx, cy, span}` — exactly the wire `CameraView` shape — so camera-follow needs no pixel↔wire conversion at all (the web's `transformToView`/`viewToTransform` existed only to bridge react-zoom-pan-pinch's pixel transform; mobile skips that entirely). Hit-testing is manual: invert the view transform, run pure point-vs-slot-polyline / city-radius tests (unit-tested without a device). ~4.5k LOC of web logic ports nearly as-is (`store/game`, `store/animations`, `game/*` helpers, `theme/colors`, sound model); the DOM view layer is rebuilt as RN components mirroring the web's prop contracts so P3 (offline) and P4 (tutorial) can reuse them unchanged. The server is untouched — snapshots stay authoritative, `redactFor` projections are all the client ever sees.

**Tech Stack:** Expo SDK 56 (RN 0.85, React 19.2, New Architecture, Hermes), `@shopify/react-native-skia` 2.x, `react-native-gesture-handler` 2.x, `react-native-reanimated` 3.x, `@react-native-community/netinfo`, expo-av (or its SDK-56 successor `expo-audio` — see Task 11), zustand (same version as web), jest-expo + `@testing-library/react-native` for components, plain jest for pure math. Pure packages (`@trm/map-data`, `@trm/proto`, `@trm/shared`, `@trm/engine`) are imported as TS source through Metro (P1 proved this).

## Global Constraints

- **Board spike is Task 1 and is a GO/NO-GO gate.** Do not build Tasks 4–12 until the spike passes on a real device. The documented fallback (NO-GO path) is react-native-svg with a single root transform — documented in Task 1, **not planned**.
- Monorepo pins that bind here: Yarn 4 **node-modules linker** (already set; Metro requires it), server stays **swc-not-tsx**, `apps/web` stays **Vite ^5** (don't touch it), the 6th card colour is **PURPLE never PINK**, never `git add -A`/`git add .` (other agents share this worktree).
- **Engine purity untouched:** nothing in this plan imports the engine except the already-pure view helpers being ported (`payments`, `tunnel`, `tickets` mirror engine selectors read-only). No `Date`/`Math.random` goes anywhere near `@trm/engine`.
- **Hidden info:** the mobile client renders ONLY `GameSnapshot` projections off the wire. Never deserialize, reconstruct, or log raw `GameState` client-side.
- **Snapshot is authoritative:** the ported `store/game.ts` keeps the exact stale-`stateVersion` drop semantics. No client-side game truth.
- `apps/mobile` tests run under **jest-expo, never vitest** (`yarn workspace @trm/mobile test <pattern>`); pure ports keep their web test bodies, only swapping the `vitest` import for jest globals.
- **i18n:** zh-Hant primary + en, via the P1-ported `src/i18n/index.ts`. City/ticket names are content, resolved from the active catalog by id — never from i18n tables.
- Layout tiers come from **`useWindowDimensions` at render time, never a static device class** (iPad Stage Manager / Android 16 live-resize both resize windows under a running app). Breakpoints: compact `< 700`dp width → bottom dock; `700–999`dp → two-pane; `≥ 1000`dp → three-pane.
- **P4 depends on this stage's prop surface:** native `GameStage` MUST keep `sandbox`, `frameTarget`, `overlay`, `spotlightCities`, and `actionGate` props (even though P2 always passes them undefined) — the tutorial (P4) and offline (P3) plug in through them, same as web.
- Wire strings/contracts fixed by P0/P1 (never re-derive): ws path `/ws`, ticket via `POST /rooms/:code/ticket`, `x-trm-client: mobile` header on REST issuance, `GameSocket` sends `ClientHello` with `PROTOCOL_VERSION` then `resync`.
- File-copy ports below name the **exact web source file**; READ it at port time (it may have moved since spec time) and keep its comments — they carry the reasoning.

---

### Task 1: Board rendering spike (risk retirement gate) — camera math, hit-testing, full-map render on device

**Files:**

- Create: `apps/mobile/src/board/camera.ts`
- Create: `apps/mobile/src/board/camera.test.ts`
- Create: `apps/mobile/src/board/hitTest.ts`
- Create: `apps/mobile/src/board/hitTest.test.ts`
- Create: `apps/mobile/src/screens/BoardSpikeScreen.tsx`
- Modify: `apps/mobile/package.json` (deps)
- Modify: the P1 navigator (add a dev-only `BoardSpike` route — re-verify the navigator file path, expected `apps/mobile/src/App.tsx` or `src/navigation/index.tsx`)

**Interfaces:**

- Consumes: `@trm/map-data` (`TAIWAN_CONTENT`, `buildRouteGeometryFor`, `TAIWAN_LAND_PATH`, `TAIWAN_BASE_VIEW`, `smoothClosedPath`, `RouteGeometry`), P1's jest-expo config.
- Produces (used by every later board task):
  - `interface Viewport { w: number; h: number }`
  - `interface CameraState { cx: number; cy: number; span: number }` — board units; **identical to the wire `CameraView`/web `ViewDescriptor`**.
  - `pxPerUnit(cam: CameraState, vp: Viewport): number` (= `vp.w / cam.span`)
  - `boardToScreen(p, cam, vp)` / `screenToBoard(p, cam, vp)`
  - `panBy(cam, dxPx, dyPx, vp): CameraState`, `pinchTo(cam, focalPx, scaleFactor, vp, view): CameraState`
  - `clampSpan(span, view): number` with `SPAN_MIN = 8`, `spanMax(view) = 1.25 * view.w`
  - `homeCamera(bounds, vp, padding = 0.9): CameraState`, `boundsOfContent(catalogLike): Bounds`
  - `webScaleEquiv(span, homeSpan)`, `zoomBucket(scaleEquiv)`, `invScale(scaleEquiv)`, `markerScale(scaleEquiv)`
  - `visibleFraction(points, cam, vp): number`
  - `BOT_FOLLOW_SPAN = 34`
  - `hitTest(ptPx, cam, vp, scene): { kind: 'city'; id: string } | { kind: 'route'; id: string } | null`

- [ ] **Step 1: Install the board dependencies**

```bash
yarn workspace @trm/mobile exec npx expo install @shopify/react-native-skia react-native-gesture-handler react-native-reanimated
```

(`expo install` pins the SDK-56-compatible versions. gesture-handler/reanimated may already be present from P1 — `expo install` is idempotent. Verify: `yarn workspace @trm/mobile typecheck` still clean.)

- [ ] **Step 2: Write the failing camera tests**

Create `apps/mobile/src/board/camera.test.ts`:

```ts
import {
  boardToScreen,
  screenToBoard,
  panBy,
  pinchTo,
  clampSpan,
  homeCamera,
  webScaleEquiv,
  zoomBucket,
  invScale,
  markerScale,
  visibleFraction,
  SPAN_MIN,
  spanMax,
} from './camera';

const vp = { w: 400, h: 800 };
const view = { x: -14, y: -8, w: 108, h: 112 }; // Taiwan-ish baseView shape

describe('camera projection', () => {
  const cam = { cx: 50, cy: 50, span: 100 };
  it('round-trips board↔screen', () => {
    const p = boardToScreen({ x: 30, y: 70 }, cam, vp);
    expect(screenToBoard(p, cam, vp)).toEqual({ x: 30, y: 70 });
  });
  it('puts the camera centre at the screen centre', () => {
    expect(boardToScreen({ x: 50, y: 50 }, cam, vp)).toEqual({ x: 200, y: 400 });
  });
  it('pan moves the centre opposite the finger, in board units', () => {
    // 100 span over 400px ⇒ 4 px/unit; dragging +40px right moves cx 10 units LEFT of content.
    expect(panBy(cam, 40, 0, vp).cx).toBeCloseTo(40);
  });
  it('pinch keeps the focal board point stationary on screen', () => {
    const focal = { x: 100, y: 200 };
    const before = screenToBoard(focal, cam, vp);
    const zoomed = pinchTo(cam, focal, 2, vp, view);
    expect(zoomed.span).toBeCloseTo(50);
    const after = boardToScreen(before, zoomed, vp);
    expect(after.x).toBeCloseTo(focal.x, 5);
    expect(after.y).toBeCloseTo(focal.y, 5);
  });
  it('clamps span to [SPAN_MIN, 1.25 × view width]', () => {
    expect(clampSpan(1, view)).toBe(SPAN_MIN);
    expect(clampSpan(1e6, view)).toBe(spanMax(view));
  });
});

describe('home framing (fitTransform semantics: contain with 0.9 padding)', () => {
  it('contains a tall bounds on a tall viewport by height', () => {
    const cam = homeCamera({ x: 10, y: 0, w: 40, h: 90 }, vp);
    // height in board units shown = span * vp.h/vp.w = span*2 ⇒ span ≥ 90/0.9/2 = 50 > 40/0.9
    expect(cam.span).toBeCloseTo(50);
    expect(cam.cx).toBeCloseTo(30);
    expect(cam.cy).toBeCloseTo(45);
  });
});

describe('LOD port (anchored: home framing ≡ web scale 2.4, the local tier)', () => {
  const homeSpan = 50;
  it('home span is local; wider spans step down through the web buckets', () => {
    expect(zoomBucket(webScaleEquiv(homeSpan, homeSpan))).toBe('local'); // 2.4
    expect(zoomBucket(webScaleEquiv(60, homeSpan))).toBe('district'); // 2.0
    expect(zoomBucket(webScaleEquiv(90, homeSpan))).toBe('regional'); // 1.33
    expect(zoomBucket(webScaleEquiv(120, homeSpan))).toBe('far'); // 1.0
  });
  it('inv-scale / marker-scale port the web formulas + clamps', () => {
    const s = webScaleEquiv(homeSpan, homeSpan); // 2.4
    expect(invScale(s)).toBeCloseTo(1 / 2.4);
    expect(markerScale(s)).toBeCloseTo(Math.max(0.34, Math.min(0.82, 1 / Math.sqrt(2.4))));
    expect(invScale(100)).toBe(0.12); // clamp floor
    expect(invScale(0.1)).toBe(1.5); // clamp ceiling
  });
});

describe('visibleFraction', () => {
  it('counts the points inside the viewport', () => {
    const cam = { cx: 50, cy: 50, span: 100 };
    const pts = [
      { x: 50, y: 50 }, // centre → in
      { x: 50, y: 260 }, // far south → out
    ];
    expect(visibleFraction(pts, cam, vp)).toBe(0.5);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `yarn workspace @trm/mobile test camera`
Expected: FAIL — `Cannot find module './camera'`.

- [ ] **Step 4: Implement `apps/mobile/src/board/camera.ts`**

```ts
// The mobile board camera, modelled NATIVELY in board units as {cx, cy, span} — the exact
// shape the wire's CameraView / the web's ViewDescriptor carries (see apps/web/src/game/
// boardView.ts). The web needed transformToView/viewToTransform to bridge react-zoom-pan-
// pinch's pixel transform to that descriptor; here the descriptor IS the camera state, so
// follow-the-actor consumes and broadcasts it with no conversion. Pure — no RN imports —
// so every function unit-tests without a device.

export interface Viewport {
  w: number;
  h: number;
}
export interface CameraState {
  /** Board x/y (0–100 content space) under the viewport centre. */
  cx: number;
  cy: number;
  /** Board units spanned by the viewport WIDTH (the zoom metric; smaller = closer). */
  span: number;
}
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Closest-up zoom: ~3–4 stations across a phone. Mirrors the web's MAX_SCALE=8 head-room. */
export const SPAN_MIN = 8;
/** Widest zoom: a little beyond the full base view (web MIN_SCALE=0.8 ⇒ content at 125%). */
export const spanMax = (view: Bounds): number => 1.25 * view.w;

/** Board units spanned when auto-framing a bot's action POI (ports verbatim from Board.tsx —
 *  it was already screen-independent board units on the web). */
export const BOT_FOLLOW_SPAN = 34;

export const pxPerUnit = (cam: CameraState, vp: Viewport): number => vp.w / cam.span;

export const clampSpan = (span: number, view: Bounds): number =>
  Math.min(spanMax(view), Math.max(SPAN_MIN, span));

export function boardToScreen(
  p: { x: number; y: number },
  cam: CameraState,
  vp: Viewport,
): { x: number; y: number } {
  const s = pxPerUnit(cam, vp);
  return { x: (p.x - cam.cx) * s + vp.w / 2, y: (p.y - cam.cy) * s + vp.h / 2 };
}

export function screenToBoard(
  p: { x: number; y: number },
  cam: CameraState,
  vp: Viewport,
): { x: number; y: number } {
  const s = pxPerUnit(cam, vp);
  return { x: cam.cx + (p.x - vp.w / 2) / s, y: cam.cy + (p.y - vp.h / 2) / s };
}

/** One-finger pan: the content follows the finger, so the centre moves the other way. */
export function panBy(cam: CameraState, dxPx: number, dyPx: number, vp: Viewport): CameraState {
  const s = pxPerUnit(cam, vp);
  return { cx: cam.cx - dxPx / s, cy: cam.cy - dyPx / s, span: cam.span };
}

/** Pinch about a focal point: zoom by `factor`, keeping the board point under the focal
 *  screen point stationary (the standard focal-pinch invariant). */
export function pinchTo(
  cam: CameraState,
  focalPx: { x: number; y: number },
  factor: number,
  vp: Viewport,
  view: Bounds,
): CameraState {
  const anchor = screenToBoard(focalPx, cam, vp);
  const span = clampSpan(cam.span / factor, view);
  const s = vp.w / span;
  return {
    cx: anchor.x - (focalPx.x - vp.w / 2) / s,
    cy: anchor.y - (focalPx.y - vp.h / 2) / s,
    span,
  };
}

/**
 * Home/reset framing: the smallest span that CONTAINS `bounds` with a padding margin —
 * the same contain-and-centre semantics as the web's fitTransform (game/geography.ts),
 * re-expressed in span space. Width constrains directly; height constrains via the
 * viewport aspect (visible board height = span · vp.h / vp.w).
 */
export function homeCamera(bounds: Bounds, vp: Viewport, padding = 0.9): CameraState {
  const span = Math.max(bounds.w / padding, (bounds.h * (vp.w / vp.h)) / padding);
  return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2, span };
}

/**
 * What to frame at home: a custom map's land-ring bbox, else the non-island city bbox
 * padded — the pure stand-in for the web's DOM-measured `path.land` rect (frameHome).
 */
export function boundsOfContent(content: {
  cities: readonly { x: number; y: number; isIsland?: boolean | undefined }[];
  geography?: { land: readonly (readonly (readonly [number, number])[])[] } | null | undefined;
}): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  if (content.geography && content.geography.land.length > 0) {
    for (const ring of content.geography.land)
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  const pad = 4;
  for (const c of content.cities) {
    if (c.isIsland) continue;
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

// ── LOD port ─────────────────────────────────────────────────────────────────
// The web's zoomBucket/inv-scale/marker-scale (game/lod.ts + Board.tsx ZoomTracker) are
// functions of the rzpp scale. Mobile has no rzpp scale, so we anchor: the HOME framing
// is defined to sit at web-scale 2.4 — the 'local' tier the Board seeds data-zoom with —
// and every other span maps proportionally. One calibration constant, unit-tested.
export const HOME_SCALE_EQUIV = 2.4;

export const webScaleEquiv = (span: number, homeSpan: number): number =>
  HOME_SCALE_EQUIV * (homeSpan / span);

export type ZoomBucket = 'far' | 'regional' | 'district' | 'local';
/** Ports game/lod.ts zoomBucket verbatim (same thresholds on the equivalent scale). */
export const zoomBucket = (scale: number): ZoomBucket =>
  scale < 1.25 ? 'far' : scale < 1.7 ? 'regional' : scale < 2.4 ? 'district' : 'local';

/** Ports Board.tsx ZoomTracker's --inv-scale: labels/track weight counter-scale. */
export const invScale = (scale: number): number => Math.max(0.12, Math.min(1.5, 1 / scale));
/** Ports --marker-scale: station markers grow ≈√zoom, clamped. */
export const markerScale = (scale: number): number =>
  Math.max(0.34, Math.min(0.82, 1 / Math.sqrt(scale)));

/** Fraction of board-space points inside the viewport (ports boardView.ts visibleFraction
 *  through the analytic projection — gates the claim glow, Task 5). */
export function visibleFraction(
  points: readonly { x: number; y: number }[],
  cam: CameraState,
  vp: Viewport,
): number {
  if (points.length === 0) return 0;
  let inside = 0;
  for (const p of points) {
    const q = boardToScreen(p, cam, vp);
    if (q.x >= 0 && q.x <= vp.w && q.y >= 0 && q.y <= vp.h) inside++;
  }
  return inside / points.length;
}
```

Run: `yarn workspace @trm/mobile test camera` — Expected: PASS.

- [ ] **Step 5: Write the failing hit-test tests**

Create `apps/mobile/src/board/hitTest.test.ts`:

```ts
import { TAIWAN_CONTENT, buildRouteGeometryFor } from '@trm/map-data';
import { boardToScreen, homeCamera, boundsOfContent } from './camera';
import { buildHitScene, hitTest } from './hitTest';

const { geometry } = buildRouteGeometryFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes);
const scene = buildHitScene(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes, geometry);
const vp = { w: 400, h: 800 };
const cam = homeCamera(boundsOfContent(TAIWAN_CONTENT), vp);

const cityPx = (id: string) => {
  const c = TAIWAN_CONTENT.cities.find((x) => (x.id as string) === id)!;
  return boardToScreen({ x: c.x, y: c.y }, cam, vp);
};

describe('hitTest', () => {
  it('a tap on a city marker returns that city (cities beat routes)', () => {
    expect(hitTest(cityPx('taipei'), cam, vp, scene)).toEqual({ kind: 'city', id: 'taipei' });
  });
  it('a tap on a route mid-slot returns that route', () => {
    const anyRoute = TAIWAN_CONTENT.routes[0]!;
    const g = geometry.get(anyRoute.id as string)!;
    const slot = g.slots[Math.floor(g.slots.length / 2)]!;
    const px = boardToScreen({ x: slot.x + g.perp.x, y: slot.y + g.perp.y }, cam, vp);
    expect(hitTest(px, cam, vp, scene)).toEqual({ kind: 'route', id: anyRoute.id });
  });
  it('every route is tappable at its middle slot at home zoom (no dead routes)', () => {
    for (const r of TAIWAN_CONTENT.routes) {
      const g = geometry.get(r.id as string)!;
      const slot = g.slots[Math.floor(g.slots.length / 2)]!;
      const px = boardToScreen({ x: slot.x + g.perp.x, y: slot.y + g.perp.y }, cam, vp);
      const hit = hitTest(px, cam, vp, scene);
      // A tap dead-centre on one of a double pair may land on the twin — both are answers
      // the UI can work with; what may NOT happen is null or a city.
      expect(hit?.kind).toBe('route');
    }
  });
  it('double-route siblings resolve to the nearer twin', () => {
    const pair = TAIWAN_CONTENT.routes.filter((r) => r.doubleGroup === 'A');
    expect(pair.length).toBe(2); // re-verify group id against routes.ts if this fails
    const [r1] = pair;
    const g1 = geometry.get(r1!.id as string)!;
    const slot = g1.slots[0]!;
    // Bias the tap toward r1's own perp side.
    const px = boardToScreen({ x: slot.x + g1.perp.x * 1.2, y: slot.y + g1.perp.y * 1.2 }, cam, vp);
    expect(hitTest(px, cam, vp, scene)).toEqual({ kind: 'route', id: r1!.id });
  });
  it('open sea is a miss', () => {
    expect(hitTest({ x: 4, y: 4 }, cam, vp, scene)).toBeNull();
  });
});
```

Run: `yarn workspace @trm/mobile test hitTest` — Expected: FAIL — `Cannot find module './hitTest'`.

- [ ] **Step 6: Implement `apps/mobile/src/board/hitTest.ts`**

```ts
// Manual hit-testing for the Skia board (Skia has no per-element onPress): invert the view
// transform, then run point-vs-polyline distance tests against each route's slot chain and
// point-vs-radius tests against city markers. Pure functions — the whole file unit-tests
// without a device. Tolerances are finger-sized in SCREEN px, converted to board units
// through the live camera, with board-unit floors so extreme zoom-out stays tappable.
import type { RouteGeometry } from '@trm/map-data';
import { screenToBoard, pxPerUnit, type CameraState, type Viewport } from './camera';

/** Finger slop in screen px (Material touch-target ≈ 44–48px; slop is the half-width). */
const TAP_SLOP_PX = 22;
/** Board-unit floors, so hit areas never collapse below the drawn footprint. */
const ROUTE_MIN_TOL = 1.1; // ≈ roadbed half-width + margin
const CITY_MIN_TOL = 1.7; // ≈ marker radius + margin

export interface HitScene {
  cities: readonly { id: string; x: number; y: number }[];
  /** Per route: the polyline through [cityA, ...slot centres..., cityB], pre-offset by perp. */
  routes: readonly { id: string; pts: readonly { x: number; y: number }[] }[];
}

/** Precompute the per-route polylines once per catalog (geometry is immutable per content). */
export function buildHitScene(
  cities: readonly { id: string; x: number; y: number }[],
  routes: readonly { id: string; a: string; b: string }[],
  geometry: ReadonlyMap<string, RouteGeometry>,
): HitScene {
  const cityById = new Map(cities.map((c) => [c.id as string, c]));
  const outRoutes = routes.flatMap((r) => {
    const g = geometry.get(r.id as string);
    const a = cityById.get(r.a as string);
    const b = cityById.get(r.b as string);
    if (!g || !a || !b) return [];
    // The renderer nudges double siblings by perp (counter-scaled); at tap zooms the
    // nudge ≈ its board value, so baking raw perp in keeps the twins separable.
    const off = g.perp;
    const pts = [
      { x: a.x + off.x, y: a.y + off.y },
      ...g.slots.map((s) => ({ x: s.x + off.x, y: s.y + off.y })),
      { x: b.x + off.x, y: b.y + off.y },
    ];
    return [{ id: r.id as string, pts }];
  });
  return { cities: cities.map((c) => ({ id: c.id as string, x: c.x, y: c.y })), routes: outRoutes };
}

const distToSegment = (
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
};

export type Hit = { kind: 'city'; id: string } | { kind: 'route'; id: string } | null;

export function hitTest(
  ptPx: { x: number; y: number },
  cam: CameraState,
  vp: Viewport,
  scene: HitScene,
): Hit {
  const p = screenToBoard(ptPx, cam, vp);
  const s = pxPerUnit(cam, vp);
  const cityTol = Math.max(CITY_MIN_TOL, TAP_SLOP_PX / s);
  const routeTol = Math.max(ROUTE_MIN_TOL, TAP_SLOP_PX / s);

  // Cities first — stations are the smaller target and sit ON routes at junctions.
  let bestCity: { id: string; d: number } | null = null;
  for (const c of scene.cities) {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d <= cityTol && (!bestCity || d < bestCity.d)) bestCity = { id: c.id, d };
  }
  if (bestCity) return { kind: 'city', id: bestCity.id };

  let bestRoute: { id: string; d: number } | null = null;
  for (const r of scene.routes) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const d = distToSegment(p, r.pts[i]!, r.pts[i + 1]!);
      if (d <= routeTol && (!bestRoute || d < bestRoute.d)) bestRoute = { id: r.id, d };
    }
  }
  return bestRoute ? { kind: 'route', id: bestRoute.id } : null;
}
```

Run: `yarn workspace @trm/mobile test hitTest` — Expected: PASS. (If the double-pair test's group id `'A'` doesn't exist, read `packages/map-data/src/routes.ts` for a real `doubleGroup` value and fix the test, not the implementation.)

- [ ] **Step 7: Build the spike screen (full Taiwan, pan/pinch, tap)**

Create `apps/mobile/src/screens/BoardSpikeScreen.tsx`. This is throwaway-quality by design (Task 4/5 build the real components), but it must render the REAL full map:

```tsx
// SPIKE (P2 Task 1): renders the full Taiwan board in one Skia canvas with pan/pinch/tap.
// Purpose is risk retirement, not reuse — Tasks 4/5 replace this with MapSceneSkia/BoardView.
import { useMemo, useState } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { Canvas, Group, Path, Rect, Circle, Skia } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, useDerivedValue, runOnJS } from 'react-native-reanimated';
import {
  TAIWAN_CONTENT,
  TAIWAN_BASE_VIEW,
  TAIWAN_LAND_PATH,
  buildRouteGeometryFor,
  ROUTE_COLOR_HEX,
} from '@trm/map-data';
import { homeCamera, boundsOfContent, clampSpan, SPAN_MIN } from '../board/camera';
import { buildHitScene, hitTest } from '../board/hitTest';

export function BoardSpikeScreen() {
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

  const onTap = (x: number, y: number) => {
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
              const fill =
                r.color === 'GRAY'
                  ? ROUTE_COLOR_HEX.GRAY
                  : ROUTE_COLOR_HEX[r.color as keyof typeof ROUTE_COLOR_HEX];
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
```

Register the screen behind a dev-only route in the P1 navigator (re-verify the file; add `BoardSpike` to the stack, reachable from a dev button on Home when `__DEV__`).

- [ ] **Step 8: Device gate (GO/NO-GO) — run on hardware and record the verdict**

Run: `yarn workspace @trm/mobile exec npx expo run:android` (P1's Android dev loop; use a physical mid-range device if available, else the emulator + a TestFlight/dev build on any available iPhone later).

Acceptance checklist (record results in the commit message body):

1. Full map (68 routes ≈ 250 car slots + geography + 39 cities) renders correctly (curves, double-pair separation, ferry/tunnel routes present).
2. Sustained pan and pinch stay visually smooth (target ≥ 50fps on the perf monitor — `adb shell dumpsys gfxinfo` or the RN perf overlay; no gesture-locked stutter).
3. 20/20 taps on routes in the dense Taipei corridor at home zoom resolve to the intended route or its double twin; city taps beat route taps at junctions.
4. Zooming to SPAN_MIN and out to spanMax stays stable (no precision artifacts).

**GO** → proceed. **NO-GO** (unfixable perf wall) → STOP; the documented fallback is react-native-svg rendering of the same geometry under one root transform (no per-frame CSS-var writes — the web's known jank source), and this plan must be re-baselined before continuing. Do not silently switch renderers.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/board/camera.ts apps/mobile/src/board/camera.test.ts apps/mobile/src/board/hitTest.ts apps/mobile/src/board/hitTest.test.ts apps/mobile/src/screens/BoardSpikeScreen.tsx apps/mobile/package.json yarn.lock
# plus the navigator file you touched
git commit -m "feat(mobile): board spike — Skia full-map render + camera/hit-test math (device gate: GO)"
```

---

### Task 2: Port the pure game-view logic, theme, and content catalog

**Files:**

- Create (ported): `apps/mobile/src/theme/colors.ts` ← `apps/web/src/theme/colors.ts`
- Create (ported): `apps/mobile/src/game/content.ts` ← `apps/web/src/game/content.ts`
- Create (ported): `apps/mobile/src/game/catalog.ts` ← `apps/web/src/game/catalog.ts`
- Create (ported): `apps/mobile/src/game/routeGeometry.ts` ← `apps/web/src/game/routeGeometry.ts`
- Create (ported): `apps/mobile/src/game/contentCache.ts` ← `apps/web/src/game/contentCache.ts`
- Create (ported): `apps/mobile/src/game/useActiveContent.ts` ← `apps/web/src/game/useActiveContent.ts`
- Create (ported): `apps/mobile/src/game/{lod,view,cards,payments,tunnel,tickets,events,chatErrors,chatPresets,logModel,playerName}.ts` ← same names under `apps/web/src/game/`
- Create (ported tests): `apps/mobile/src/game/{payments,tickets,events,lod,logModel}.test.ts` ← web test files of the same names

**Interfaces:**

- Consumes: `@trm/map-data`, `@trm/shared`, `@trm/proto` (TS source through Metro — P1 shims already installed), P1's `src/net/rest.ts` (`api.mapContent(hash)` — **verify P1 ported this method**; if absent, add it exactly as `apps/web/src/net/rest.ts:365` does), P1's locale type.
- Produces: the same module surface the web has — `CITIES/ROUTES/TICKETS/cityById/routeById/ticketById/cityName/ticketLabel`, `setActiveContent/resetToDefaultContent/ACTIVE_BASE_VIEW/ACTIVE_GEOGRAPHY`, `ROUTE_GEOMETRY/HUB_CITIES/rebuildRouteGeometry`, `resolveContent`, `useActiveContent(hash)`, `handFromCounts/enumerateRoutePayments/enumerateStationPayments/routeShortfall/stationShortfall/handAfterPayment/paymentToProto`, `enumerateTunnelExtra`, `completedByPlayer/pathForTicket`, `closedRouteIds/reopenBonusRouteIds/skyLanternRouteIds/hotspotLevels/skyLanternSurcharge/freeStationAvailable/eventRejectionHintKey`, `ownershipMap/isMyTurn/turnStatus/seatByPlayer`, `CARD_COLOR_TOKENS/GRAY_TOKEN/LIVERY_COLORS/SEAT_COLORS/seatColor` (+ colour-blind `glyph`s), `cityTier/zoomBucket`.

- [ ] **Step 1: Copy the web tests first (they are the failing tests)**

Copy `apps/web/src/game/payments.test.ts`, `tickets.test.ts`, `events.test.ts`, `lod.test.ts`, `logModel.test.ts` to `apps/mobile/src/game/`, changing only:

- delete `import { describe, it, expect } from 'vitest';` (jest-expo provides globals),
- fix relative import paths if any differ.

Run: `yarn workspace @trm/mobile test src/game`
Expected: FAIL — modules under test don't exist yet.

- [ ] **Step 2: Port the modules**

Copy each listed web file. These are DOM-free and port with ONLY these deltas:

- `theme/colors.ts`: verbatim (it imports only `@trm/shared` + `@trm/map-data`). **PURPLE stays PURPLE.**
- `game/content.ts`: `import type { Locale } from '../store/ui'` → P1's locale source (re-verify; expected `../i18n` or `../store/prefs`). Everything else verbatim, including the live-binding `let` exports.
- `game/catalog.ts`, `game/routeGeometry.ts`: verbatim, except `catalog.ts` imports `BASE_VIEW`/`View` — mobile has no `game/geography.ts`; inline instead:
  ```ts
  import { TAIWAN_BASE_VIEW } from '@trm/map-data';
  export type View = { x: number; y: number; w: number; h: number };
  const BASE_VIEW: View = TAIWAN_BASE_VIEW;
  ```
- `game/contentCache.ts`: `import { api, type MapContentDto } from '../net/rest'` — P1 path (verify).
- `game/useActiveContent.ts`: verbatim (React hooks work in RN).
- `game/lod.ts`: verbatim, **but delete its `zoomBucket`** and re-export the one from `../board/camera` (single source; the camera version is the calibrated port):
  ```ts
  export { zoomBucket, type ZoomBucket } from '../board/camera';
  ```
- `game/{view,cards,payments,tunnel,tickets,events,chatErrors,chatPresets,logModel,playerName}.ts`: verbatim modulo import paths.

- [ ] **Step 3: Run tests**

Run: `yarn workspace @trm/mobile test src/game`
Expected: PASS.
Run: `yarn workspace @trm/mobile typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/theme apps/mobile/src/game
git commit -m "feat(mobile): port game-view helpers, theme tokens, and the content catalog from web"
```

---

### Task 3: Port the stores and the socket→store bridge

**Files:**

- Create (ported): `apps/mobile/src/store/game.ts` ← `apps/web/src/store/game.ts`
- Create (ported): `apps/mobile/src/store/animations.ts` ← `apps/web/src/store/animations.ts`
- Create (ported): `apps/mobile/src/store/log.ts` ← `apps/web/src/store/log.ts`
- Create (ported): `apps/mobile/src/store/chat.ts` ← `apps/web/src/store/chat.ts`
- Create (ported): `apps/mobile/src/store/roster.ts` ← `apps/web/src/store/roster.ts`
- Create: `apps/mobile/src/store/ui.ts` (mobile-shaped display prefs)
- Create (ported): `apps/mobile/src/net/commands.ts` ← `apps/web/src/net/commands.ts`
- Create (ported): `apps/mobile/src/net/connection.ts` ← `apps/web/src/net/connection.ts`
- Create (ported): `apps/mobile/src/game/animationModel.ts` ← `apps/web/src/game/animationModel.ts` (+ its test)
- Create (ported tests): `apps/mobile/src/store/{game,animations}.test.ts` ← web tests

**Interfaces:**

- Consumes: P1's `src/net/socket.ts` (`GameSocket`, `SocketStatus`, `PaymentInit`, `CameraViewInit`, `ChatContent` — the web-class port; **verify its export names match `apps/web/src/net/socket.ts`**, and that P1 parameterized the ws URL off the server origin config instead of `location`).
- Produces: `useGame/createGameStore/GameStoreProvider/useGameStore/useGameStoreApi` (P3/P4 sandbox isolation depends on the provider pattern), `useAnimations/createAnimationsStore/AnimationsStoreProvider/useAnimationsStore`, `useLog`, `useChat`, `useRoster`, `useUi` (`locale`, `colorBlind`, `followActing`, `soundEnabled`, `soundVolume` + setters, persisted), `connectGame(ticket)/getSocket()/disconnectGame()`, `GameCommands`, `intentsFromEvents/AnimIntent`.

- [ ] **Step 1: Copy web tests** for `store/game` and `store/animations` (same vitest→jest-globals delta as Task 2), plus `game/animationModel.test.ts`.

Run: `yarn workspace @trm/mobile test src/store`
Expected: FAIL — modules missing.

- [ ] **Step 2: Port the stores**

`store/game.ts`, `store/animations.ts`, `store/log.ts`, `store/chat.ts`, `store/roster.ts`, `net/commands.ts`, `net/connection.ts`, `game/animationModel.ts`: copy verbatim with these deltas only:

- `store/game.ts`: `import type { ViewDescriptor } from '../game/boardView'` → `import type { CameraState as ViewDescriptor } from '../board/camera'` (same `{cx, cy, span}` shape).
- `store/animations.ts`: `import type { BoardFrameTarget } from '../game/boardView'` → define/import from `../board/frameTarget.ts` — create that tiny file now, porting the `BoardFrameTarget` interface + `frameDurationMs` verbatim from `apps/web/src/game/boardView.ts:17-28`.
- `net/connection.ts`: socket import path → P1's socket module.

Create `apps/mobile/src/store/ui.ts` — the game-relevant slice of the web's `store/ui.ts` (no URL routing; navigation is React Navigation's job). Persist via zustand `persist` + AsyncStorage (`yarn workspace @trm/mobile exec npx expo install @react-native-async-storage/async-storage` if P1 didn't already):

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Locale = 'zh-Hant' | 'en';

interface UiState {
  locale: Locale;
  colorBlind: boolean;
  /** "Follow the acting player" camera toggle (ports web store/ui.ts followActing). */
  followActing: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  setLocale(l: Locale): void;
  setColorBlind(v: boolean): void;
  setFollowActing(v: boolean): void;
  setSoundEnabled(v: boolean): void;
  setSoundVolume(v: number): void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      locale: 'zh-Hant',
      colorBlind: false,
      followActing: true,
      soundEnabled: true,
      soundVolume: 0.6,
      setLocale: (locale) => set({ locale }),
      setColorBlind: (colorBlind) => set({ colorBlind }),
      setFollowActing: (followActing) => set({ followActing }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setSoundVolume: (v) => set({ soundVolume: Math.max(0, Math.min(1, v)) }),
    }),
    { name: 'trm-ui', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
```

If P1 already created a prefs/settings store, MERGE these fields into it instead of creating a second store — re-verify before writing.

- [ ] **Step 3: Run tests**

Run: `yarn workspace @trm/mobile test src/store src/game/animationModel`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/store apps/mobile/src/net/commands.ts apps/mobile/src/net/connection.ts apps/mobile/src/game/animationModel.ts apps/mobile/src/game/animationModel.test.ts apps/mobile/src/board/frameTarget.ts
git commit -m "feat(mobile): port game/animation/log/chat/roster stores and the socket bridge"
```

---

### Task 4: MapSceneSkia — geography, routes, cities, overlays, labels

**Files:**

- Create: `apps/mobile/src/board/scenePaths.ts` (+ `scenePaths.test.ts`)
- Create: `apps/mobile/src/board/MapSceneSkia.tsx`
- Create: `apps/mobile/src/board/GeographyLayer.tsx`
- Create: `apps/mobile/src/board/RouteLayer.tsx`
- Create: `apps/mobile/src/board/CityLayer.tsx`
- Create: `apps/mobile/src/board/LabelLayer.tsx`
- Modify: `apps/mobile/jest.config.js` / `jest.setup.js` (Skia + reanimated + gesture-handler jest mocks)

**Interfaces:**

- Consumes: Task 1 camera exports, Task 2 catalog/theme, `@trm/map-data` (`RouteGeometry`, `mapCssVars` NOT used — mobile resolves the `--m-*` dimension tokens directly, see Step 3), Skia (`Skia.Path.MakeFromSVGString`, Paragraph API).
- Produces: `MapSceneSkia` — a Skia `<Group>` subtree (NOT its own Canvas; the Board owns the Canvas) mirroring the web `MapScene` prop contract, minus DOM-specific hooks:

```ts
export interface MapSceneSkiaProps {
  cities: readonly SceneCity[]; // same shape as web MapScene.tsx SceneCity
  routes: readonly SceneRoute[]; // same shape as web SceneRoute
  geometry: ReadonlyMap<string, RouteGeometry>;
  hubs: ReadonlySet<string>;
  geography: MapGeography | null; // null → hand-authored Taiwan coast
  owned?: ReadonlyMap<string, RouteOwnership>;
  stations?: ReadonlyMap<string, number>;
  glowingRoutes?: ReadonlyMap<string, number>;
  glowingStations?: ReadonlyMap<string, number>;
  highlightCities?: ReadonlySet<string>;
  colorBlind?: boolean;
  cityLabel?: (city: SceneCity) => string;
  cityTier?: (cityId: string) => string;
  /** Random-events dressing (Board passes these; ports the web's routeClass/overlay hooks): */
  closedRoutes?: ReadonlySet<string>;
  skyRoutes?: ReadonlySet<string>;
  reopenRoutes?: ReadonlySet<string>;
  hotspots?: ReadonlyMap<string, number>;
  charterCities?: ReadonlySet<string>;
  /** LOD inputs (quantized React state from the Board — see Task 5): */
  bucket: ZoomBucket;
  inv: number; // counter-scale for labels/track weight/perp nudge
  marker: number; // marker growth clamp
  /** Sweep overlays (ticket completion / longest-trail reveal), drawn above cities: */
  sweeps?: readonly { id: number; seat: number; path: string[] }[];
  routeReveal?: { seat: number; path: string[] } | null;
}
```

- [ ] **Step 1: Configure jest for Skia/reanimated/gesture-handler components**

In `apps/mobile/jest.setup.js` (create or extend P1's):

```js
// Official library mocks so component logic tests run in Node without native Skia/GL.
jest.mock('@shopify/react-native-skia', () =>
  require('@shopify/react-native-skia/lib/commonjs/mock'),
);
require('react-native-gesture-handler/jestSetup');
require('react-native-reanimated').setUpTests();
```

**Verify against the installed versions** (`yarn workspace @trm/mobile jest --listTests` boots without native errors); the Skia mock's exact require path has moved between minor versions — if the above 404s, check `node_modules/@shopify/react-native-skia/package.json` `exports` for the `mock` entry and use that path. Wire `setupFiles`/`setupFilesAfterEach` per jest-expo docs if P1 hasn't.

- [ ] **Step 2: Write the failing scenePaths tests**

`apps/mobile/src/board/scenePaths.test.ts`:

```ts
import { TAIWAN_CONTENT, buildRouteGeometryFor } from '@trm/map-data';
import { buildRouteRenderModel, ferryLocoBlock } from './scenePaths';

const { geometry } = buildRouteGeometryFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes);

describe('buildRouteRenderModel', () => {
  const model = buildRouteRenderModel(TAIWAN_CONTENT.routes, geometry);
  it('produces one entry per route with a parsed bed path', () => {
    expect(model.length).toBe(TAIWAN_CONTENT.routes.length);
    for (const m of model) expect(m.bed).toBeTruthy(); // SkPath (mock object in jest)
  });
  it('tunnel routes carry ties; ferries carry pips; plain routes carry slots only', () => {
    const tunnel = model.find((m) => m.isTunnel)!;
    expect(tunnel.ties.length).toBeGreaterThan(0);
    const ferry = model.find((m) => m.ferryLocos > 0)!;
    expect(ferry.isFerry).toBe(true);
  });
});

describe('ferryLocoBlock (ports RouteShape.tsx locoStart math)', () => {
  it('centres the loco block in the pip chain', () => {
    expect(ferryLocoBlock(4, 2)).toEqual({ start: 1, end: 3 }); // pips 1,2 of 0..3
    expect(ferryLocoBlock(3, 1)).toEqual({ start: 1, end: 2 });
    expect(ferryLocoBlock(3, 0)).toEqual({ start: 0, end: 0 });
  });
});
```

Run: `yarn workspace @trm/mobile test scenePaths` — Expected: FAIL.

- [ ] **Step 3: Implement `scenePaths.ts` + the four layer components + `MapSceneSkia.tsx`**

`scenePaths.ts` — pure-ish precomputation (Skia path parsing is the only non-pure bit; it goes through the jest mock in tests):

```ts
import { Skia, type SkPath } from '@shopify/react-native-skia';
import type { RouteGeometry, Slot } from '@trm/map-data';
import type { SceneRoute } from './MapSceneSkia';

export interface RouteRenderModel {
  id: string;
  bed: SkPath;
  slots: readonly Slot[];
  ties: readonly Slot[];
  perp: { x: number; y: number };
  mid: { x: number; y: number };
  color: string; // route colour key (GRAY/RED/…)
  length: number;
  isTunnel: boolean;
  isFerry: boolean;
  ferryLocos: number;
}

export function buildRouteRenderModel(
  routes: readonly SceneRoute[],
  geometry: ReadonlyMap<string, RouteGeometry>,
): RouteRenderModel[] {
  const out: RouteRenderModel[] = [];
  for (const r of routes) {
    const g = geometry.get(r.id);
    if (!g) continue;
    const bed = Skia.Path.MakeFromSVGString(g.path);
    if (!bed) continue;
    out.push({
      id: r.id,
      bed,
      slots: g.slots,
      ties: g.ties ?? [],
      perp: g.perp,
      mid: g.mid,
      color: r.color,
      length: r.length,
      isTunnel: !!r.isTunnel,
      isFerry: (r.ferryLocos ?? 0) > 0,
      ferryLocos: r.ferryLocos ?? 0,
    });
  }
  return out;
}

/** Ports RouteShape.tsx: the ferryLocos pips are a centred block of the chain. */
export function ferryLocoBlock(length: number, locos: number): { start: number; end: number } {
  const start = Math.max(0, Math.floor((length - locos) / 2));
  return { start, end: start + locos };
}
```

Dimension tokens: the web resolves `--m-*` CSS vars from `mapCssVars()`. Mobile reads the SAME source values directly — import `MAP_DIMS` from `@trm/map-data` (re-verify the export name in `packages/map-data/src/render-tokens.ts`; it holds car thickness, bed width, marker radii, label sizes as board-unit numbers) and use them as constants in the layers. **Never hardcode a dimension literal that exists in `MAP_DIMS`** — that's the anti-drift rule the web enforces through CSS vars.

Layer components (all pure props → Skia elements; no stores):

- `GeographyLayer` — ports `Geography.tsx`: sea rect (`view` padded ±40), graticule lines, `TAIWAN_LAND_PATH` land + `TAIWAN_CENTRAL_RANGE_PATH` relief when `geography === null`; else one `smoothClosedPath(ring)` → `Skia.Path.MakeFromSVGString` per land ring (memoized on `geography`). Colours from `MAP_PALETTE_LIGHT`/`MAP_INKS` (`@trm/map-data` render tokens). Compass/islands port as simple circles/paths.
- `RouteLayer` — ports `RouteShape.tsx`/`MapScene.tsx` route branch exactly: per route, `<Group transform={[{translateX: m.perp.x * inv}, {translateY: m.perp.y * inv}]}>` (the counter-scaled double-pair nudge — `inv` is the quantized prop, matching the web's `calc(px * var(--inv-scale))`); inside: tunnel-bg wide stroke → bed stroke → ties (rotated rects at `angle + 45°`) or ferry line + pips (rainbow loco pips use a Skia `LinearGradient` over `LIVERY_COLORS`) or car slots (rotated rounded rects). Fill selection ports MapScene's: owner seat colour / locked grey `#9aa0a6` / route colour via `CARD_COLOR_TOKENS`/`GRAY_TOKEN`. Glow: when `glowingRoutes.has(id)`, draw the bed stroke again wider with the seat colour at low alpha (the CSS bloom's Skia equivalent). Colour-blind: when `colorBlind && !owned.get(id)`, a circle chip + glyph text at `m.mid` (glyph from `CARD_COLOR_TOKENS[color].glyph`). Event dressing ports Board.tsx's `renderRouteOverlay`: closed → desaturate (draw slots at 40% alpha) + 🌀 badge at mid; reopen (+ unowned) → `+2` chip; sky → tint the bed stroke.
- `CityLayer` — ports MapScene's city branch: hub → rect, else circle, sized by `MAP_DIMS` × `marker`; station overlay (seat colour) when `stations.has(id)`; just-built ring when `glowingStations.has(id)`; ticket-target halo when `highlightCities.has(id)`; hotspot `+N` badge / charter chip from the events props.
- `LabelLayer` — Skia **Paragraph API** with the system font collection so zh-Hant glyphs shape correctly (PingFang on iOS / Noto Sans TC on Android):
  ```ts
  const fonts = Skia.FontMgr.System();
  // Paragraph per city label, cached by (text, sizeBucket):
  const para = Skia.ParagraphBuilder.Make(
    { textStyle: { color: Skia.Color(ink), fontSize } },
    fonts,
  )
    .addText(label)
    .build();
  ```
  **Verify the Paragraph API surface against the installed react-native-skia 2.x** (`ParagraphBuilder.Make(style, fontCollection)` vs `TypefaceFontProvider` — the API stabilized across 1.x/2.x; adapt the builder call, keep the contract: system-font CJK paragraphs positioned at `(c.x, c.y + labelOffset)`, `fontSize = MAP_DIMS.labelSize * inv` board units). Visibility gates port the `[data-zoom]` CSS: a label renders iff `tierVisible(cityTier(c.id), bucket)` where `far`→major only, `regional`→+secondary, `district`→+tertiary, `local`→all; islands always show (ports the CSS island exception).
- `MapSceneSkia.tsx` — composes the four layers + sweep overlays (each sweep path drawn as a stroked `Path` in the seat colour using Skia path `start`/`end` trim props — the animation values arrive in Task 10; static full-trim here).

Component test (logic-level, with the Skia mock): render `MapSceneSkia` via `@testing-library/react-native` with Taiwan content at `bucket='far'` and assert the label model only contains MAJOR_CITIES labels — export the pure helper `tierVisible(tier, bucket)` from `LabelLayer` and unit-test it directly:

```ts
import { tierVisible } from './LabelLayer';
describe('tierVisible', () => {
  it('ports the [data-zoom] ladder', () => {
    expect(tierVisible('major', 'far')).toBe(true);
    expect(tierVisible('secondary', 'far')).toBe(false);
    expect(tierVisible('secondary', 'regional')).toBe(true);
    expect(tierVisible('tertiary', 'district')).toBe(true);
    expect(tierVisible('minor', 'district')).toBe(false);
    expect(tierVisible('minor', 'local')).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `yarn workspace @trm/mobile test src/board` → PASS. `yarn workspace @trm/mobile typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/board apps/mobile/jest.setup.js apps/mobile/jest.config.js
git commit -m "feat(mobile): MapSceneSkia — geography/route/city/label layers from shared geometry"
```

---

### Task 5: BoardView — gestures, camera follow, glow gate, spotlight framers, controls

**Files:**

- Create: `apps/mobile/src/board/useBoardCamera.ts`
- Create: `apps/mobile/src/board/BoardView.tsx`
- Create: `apps/mobile/src/board/followModel.ts` (+ `followModel.test.ts`)
- Create: `apps/mobile/src/board/BoardControls.tsx`

**Interfaces:**

- Consumes: Tasks 1–4, `useUi.followActing`, `useGameStore` (`actingCamera`, `recentEvents`), `getSocket()` (`cameraUpdate`), `useAnimationsStore` (`glowingRoutes`, `routeReveal`, `eventSpotlight`), `frameDurationMs`.
- Produces:
  - `useBoardCamera(vp, view, home)` → `{ cx, cy, span (SharedValues), transform (DerivedValue for the Skia Group), bucket, inv, marker (quantized React state), gesture (composed GestureType), animateTo(cam, ms), snapTo(cam), currentCamera(): CameraState }`
  - `BoardView` — the native `Board.tsx`:
    ```ts
    export interface BoardViewProps {
      snapshot: GameSnapshot;
      locale: Locale;
      colorBlind: boolean;
      canAct: boolean;
      onPickRoute(routeId: string): void;
      onPickCity(cityId: string): void;
      highlightCities?: ReadonlySet<string> | undefined;
      sandbox?: boolean | undefined; // P3/P4: suppress camera broadcast + follow
      frameTarget?: BoardFrameTarget | null; // P4 tutorial auto-pan
    }
    ```
  - `latestActionPoi(events, playerId)` in `followModel.ts` (ported verbatim from `Board.tsx:154-172`, minus DOM).

- [ ] **Step 1: Write the failing followModel tests**

`followModel.test.ts` — port the behaviour pins from `Board.tsx` as pure tests:

```ts
import { create } from '@bufbuild/protobuf';
import { GameEventSchema } from '@trm/proto';
import { latestActionPoi, shouldDisengageFollow } from './followModel';
import { ROUTE_GEOMETRY } from '../game/routeGeometry';

const routeId = [...ROUTE_GEOMETRY.keys()][0]!;

describe('latestActionPoi', () => {
  it('returns the geometry midpoint of the acting player’s newest claim, skipping others', () => {
    const events = [
      create(GameEventSchema, {
        event: { case: 'routeClaimed', value: { playerId: 'bot:1', routeId } },
      }),
      create(GameEventSchema, {
        event: { case: 'routeClaimed', value: { playerId: 'p2', routeId } },
      }),
    ];
    const poi = latestActionPoi(events, 'bot:1');
    expect(poi?.key).toContain(routeId);
    expect(poi?.x).toBeCloseTo(ROUTE_GEOMETRY.get(routeId)!.mid.x);
  });
});

describe('shouldDisengageFollow (ports Board.tsx disengageFollow)', () => {
  it('a gesture during MY turn keeps follow armed', () => {
    expect(shouldDisengageFollow(true, true)).toBe(false);
  });
  it('a gesture during another turn disengages', () => {
    expect(shouldDisengageFollow(true, false)).toBe(true);
  });
  it('no-op when follow is already off', () => {
    expect(shouldDisengageFollow(false, false)).toBe(false);
  });
});
```

Run: `yarn workspace @trm/mobile test followModel` — Expected: FAIL.

- [ ] **Step 2: Implement `followModel.ts`**

Port `latestActionPoi` from `apps/web/src/components/Board.tsx` verbatim (it reads `ROUTE_GEOMETRY`/`cityById` — both ported in Task 2), plus:

```ts
/** Ports Board.tsx disengageFollow's decision: a manual gesture takes the camera back —
 *  UNLESS it's my own turn (my camera IS the broadcast source; follow stays armed). */
export const shouldDisengageFollow = (followActing: boolean, myTurn: boolean): boolean =>
  followActing && !myTurn;
```

Run: `yarn workspace @trm/mobile test followModel` — Expected: PASS.

- [ ] **Step 3: Implement `useBoardCamera.ts`**

Promote the spike's gesture/transform code into the hook, adding:

- shared values `cx/cy/span` seeded from `home`; `transform` derived value (spike Step 7 shape);
- **quantized LOD state**: a `useAnimatedReaction` watching `span` computes `webScaleEquiv` → `{bucket, inv, marker}`; `runOnJS(setLod)` fires only when the bucket changes OR `inv` moves by >5% — the discrete re-render replaces the web's per-frame CSS-var writes (and dodges the very jank noted in docs/TODO.md for the web);
- `animateTo({cx, cy, span}, ms)`: `withTiming` on each shared value (easing `Easing.out(Easing.cubic)` ≈ the web's `easeOut`), `snapTo` = direct assignment;
- gesture side-effects: pan/pinch `onStart` → `runOnJS(onGesture)()` where the Board passes `onGesture = () => { if (shouldDisengageFollow(useUi.getState().followActing, isMyTurnNow())) useUi.getState().setFollowActing(false); }` (ports Board.tsx's `onPanningStart/onWheelStart/onPinchStart` wiring; programmatic `animateTo` never triggers it — gestures only, same guarantee);
- double-tap: `Gesture.Tap().numberOfTaps(2)` → `animateTo(pinchTo(current, tapPoint, 1.6, vp, view), 200)` (ports `doubleClick={{ mode: 'zoomIn', step: 0.6 }}` intent), composed via `Gesture.Exclusive(doubleTap, tap)` inside the race.

- [ ] **Step 4: Implement `BoardView.tsx` + `BoardControls.tsx`**

`BoardView` ports `Board.tsx`'s orchestration onto the hook (read the web file section by section while porting; every constant ports unchanged: `GLOW_MS = 1300`, `GLOW_WAIT_MS = 2600`, `GLOW_VISIBLE_FRACTION = 0.5`, `BOT_FOLLOW_SPAN = 34`):

1. Derivations from snapshot — `ownershipMap`, `stationCities`, `closedRouteIds`/`reopenBonusRouteIds`/`skyLanternRouteIds`/`hotspotLevels`/charter set: copy `Board.tsx:513-533` verbatim (pure `useMemo`s).
2. **CameraSync port** (`Board.tsx:181-265`), skipped when `sandbox`:
   - my-turn broadcast: `setInterval` 80ms reading `currentCamera()` and calling `getSocket()?.cameraUpdate(view)` with the same 0.05 change-threshold — **no projection math**: the camera state IS the descriptor;
   - follow human: on `actingCamera` change (and `followActing && !myTurn && !currentIsBot && actingCamera.playerId === current`) → `animateTo(actingCamera.view, 150)`;
   - follow bot: on `recentEvents` change → `latestActionPoi`; new key → `animateTo({cx: poi.x, cy: poi.y, span: BOT_FOLLOW_SPAN}, 600)`.
3. **RouteGlowGate port** (`Board.tsx:275-324` + the armed/started/timer plumbing at 539-601): armed = `useAnimationsStore(s => s.glowingRoutes)`; a `useAnimatedReaction` on the camera + an effect on `armed` both call `evaluate()`, which promotes a route to `started` when `visibleFraction(g.slots, currentCamera(), vp) >= 0.5`; started routes glow `GLOW_MS` then clear local + store; armed routes never half-visible within `GLOW_WAIT_MS` are dropped unseen. Timer bookkeeping ports 1:1 (`setTimeout` works identically in RN).
4. **SpotlightFramer/RevealFramer port** (`Board.tsx:331-413`): effects on `frameTarget ?? eventSpotlight` and on `routeReveal` computing the city bbox → `span = min(100, max(22, max(dx, dy) + 16))` → `animateTo(…, frameDurationMs(target, reducedMotion))`; reduced motion from RN's `AccessibilityInfo.isReduceMotionEnabled()` (a small `useReducedMotion` hook — create `apps/mobile/src/hooks/useReducedMotion.ts`).
5. `BoardControls`: follow toggle (Eye/EyeOff — use `lucide-react-native`, install via `yarn workspace @trm/mobile add lucide-react-native`), zoom ±(`animateTo(pinchTo(current, centre, 1.4…))`), reset (`animateTo(homeCamera(boundsOfContent(active), vp), 200)`). No fullscreen button (mobile is fullscreen). Buttons disengage follow via the same `shouldDisengageFollow` path.
6. Compose: `GestureDetector` → `Canvas` → `Group(transform)` → `MapSceneSkia` with all derived props + `bucket/inv/marker` from the hook; tap handler runs `hitTest` and routes to `onPickCity`/`onPickRoute` **only when `canAct`** and (for routes) `!closedRoutes.has(id) && !owned.has(id)` — ports MapScene's `claimable` gate + Board's `claimFilter`.

- [ ] **Step 5: Validate**

Run: `yarn workspace @trm/mobile test src/board` → PASS; `yarn workspace @trm/mobile typecheck` → clean.
Device smoke (Android dev build): open the spike route swapped to render `BoardView` with `TRM_DEV_GAME`'s snapshot if available, else keep the spike screen for manual checks — pan/pinch/tap + reset + follow toggle behave.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/board apps/mobile/src/hooks/useReducedMotion.ts apps/mobile/package.json yarn.lock
git commit -m "feat(mobile): BoardView — gestures, camera follow, glow gate, framers, controls"
```

---

### Task 6: Game screen shell — WS connect, AppState reconnect, NetInfo offline banner

**Files:**

- Create: `apps/mobile/src/screens/GameScreen.tsx`
- Create: `apps/mobile/src/net/useGameConnection.ts` (+ `useGameConnection.test.ts`)
- Create: `apps/mobile/src/components/OfflineBanner.tsx`
- Modify: P1 navigator (register `Game` route; Room's start flow navigates here with `{ roomCode }`)

**Interfaces:**

- Consumes: P1 `api.getTicket(code)` (web rest.ts:323 — verify P1 ported it), P1 `GameSocket`, Task 3 `connectGame/disconnectGame/getSocket`, `useGame` store, `@react-native-community/netinfo`, RN `AppState`.
- Produces: `GameScreen` (route `Game`, params `{ roomCode: string }`), `useGameConnection(roomCode)` → `{ status, sessionReplaced, retry() }`, `useActiveContent` gating (loading veil until `'ready'`).

- [ ] **Step 1: Failing hook test** — `useGameConnection.test.ts` with a mocked `connectGame`/`api`:

```ts
jest.mock('./connection', () => ({
  connectGame: jest.fn(),
  disconnectGame: jest.fn(),
  getSocket: jest.fn(() => null),
}));
jest.mock('./rest', () => ({
  api: { getTicket: jest.fn(async () => ({ ticket: 'T1' })) },
}));
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { api } from './rest';
import { connectGame } from './connection';
import { useGameConnection } from './useGameConnection';

describe('useGameConnection', () => {
  it('fetches a ticket and connects on mount', async () => {
    renderHook(() => useGameConnection('ABCD'));
    await waitFor(() => expect(connectGame).toHaveBeenCalledWith('T1'));
    expect(api.getTicket).toHaveBeenCalledWith('ABCD');
  });
  it('re-mints the ticket and reconnects when the app foregrounds', async () => {
    renderHook(() => useGameConnection('ABCD'));
    await waitFor(() => expect(connectGame).toHaveBeenCalledTimes(1));
    act(() => {
      // jest-expo mocks AppState; drive the listener directly.
      AppState.currentState = 'background';
      (AppState as any).emitCurrentChange?.('background');
      AppState.currentState = 'active';
      (AppState as any).emitCurrentChange?.('active');
    });
    await waitFor(() => expect(connectGame).toHaveBeenCalledTimes(2));
  });
});
```

(Re-verify how the current jest-expo/RN version exposes AppState event emission in tests — `AppState.emit` vs an `addEventListener` capture; adapt the _test_, keep the contract: background→active ⇒ fresh ticket + reconnect.)

Run: `yarn workspace @trm/mobile test useGameConnection` — Expected: FAIL.

- [ ] **Step 2: Implement `useGameConnection.ts`**

```ts
// Owns the mobile socket lifecycle: mount → REST ticket → connectGame; background = expect
// the OS to kill the socket; foreground = re-mint the 45s ws ticket and reconnect (the
// existing resync machinery replays the snapshot). Ports the web GameScreen connect effect
// plus the spec §8 AppState posture.
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './rest';
import { connectGame, disconnectGame } from './connection';
import { useGame } from '../store/game';

export function useGameConnection(roomCode: string): {
  status: ReturnType<typeof useGame.getState>['status'];
  sessionReplaced: boolean;
  retry: () => void;
} {
  const status = useGame((s) => s.status);
  const sessionReplaced = useGame((s) => s.sessionReplaced);
  const [attempt, setAttempt] = useState(0);
  const connecting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const connect = async () => {
      if (connecting.current) return;
      connecting.current = true;
      try {
        const { ticket } = await api.getTicket(roomCode);
        if (!cancelled) connectGame(ticket);
      } catch {
        // REST failure (offline / room gone): surface via socket status staying 'closed';
        // the OfflineBanner + retry() cover it.
      } finally {
        connecting.current = false;
      }
    };
    void connect();

    const sub = AppState.addEventListener('change', (state) => {
      // Foregrounding after a background kill: the old ticket may be expired (45s TTL) and
      // the socket dead — always re-mint + reconnect; the store drops stale snapshots.
      if (state === 'active' && !useGame.getState().sessionReplaced) void connect();
    });
    return () => {
      cancelled = true;
      sub.remove();
      disconnectGame();
    };
  }, [roomCode, attempt]);

  return { status, sessionReplaced, retry: () => setAttempt((a) => a + 1) };
}
```

- [ ] **Step 3: `OfflineBanner.tsx` + `GameScreen.tsx`**

`OfflineBanner`: `yarn workspace @trm/mobile exec npx expo install @react-native-community/netinfo`; subscribe `NetInfo.addEventListener`; render a slim branded banner (i18n keys `offlineBanner` zh-Hant `目前離線` / en `You're offline` — add to i18n if missing) when `isConnected === false` OR socket status is `reconnecting`.

`GameScreen` ports the web `GameScreen.tsx` shell minus routing: `useGameConnection(roomCode)`; roster fetch via `api.getRoom(roomCode)` → `useRoster` (+ the GAME_OVER 2s rematch poll, ported from web `GameScreen.tsx:62-92`); `useActiveContent(snapshot?.contentHash)` loading veil; `sessionReplaced` → alert dialog with leave; renders `<GameStage …/>` (Task 9) — until Task 9 lands, render `BoardView` full-screen behind a placeholder HUD so this task is independently verifiable on device.

- [ ] **Step 4: Validate + commit**

Run: `yarn workspace @trm/mobile test useGameConnection` → PASS; `yarn workspace @trm/mobile typecheck && yarn workspace @trm/mobile lint` → clean.
Device smoke: start a room from the P1 lobby against a local server (`TRM_BOT_DELAY_MS` default), reach the board, background/foreground the app → reconnect + resync observed; airplane mode → banner.

```bash
git add apps/mobile/src/screens/GameScreen.tsx apps/mobile/src/net/useGameConnection.ts apps/mobile/src/net/useGameConnection.test.ts apps/mobile/src/components/OfflineBanner.tsx apps/mobile/package.json yarn.lock
# plus the navigator file
git commit -m "feat(mobile): game screen shell — ticket connect, AppState reconnect, offline banner"
```

---

### Task 7: HUD panels — hand, market, trackers, missions, events

**Files:**

- Create: `apps/mobile/src/components/game/PlayerHand.tsx`
- Create: `apps/mobile/src/components/game/CardMarket.tsx`
- Create: `apps/mobile/src/components/game/PlayerTrackers.tsx`
- Create: `apps/mobile/src/components/game/TicketPanel.tsx` + `TicketCard.tsx`
- Create: `apps/mobile/src/components/game/EventsPanel.tsx`
- Create: `apps/mobile/src/components/game/CardSwatch.tsx` + `TrainCarCard.tsx`
- Create: `apps/mobile/src/components/game/__tests__/panels.test.tsx`

**Interfaces:**

- Consumes: web components of the same names (READ each before porting — the render logic, ordering, and a11y semantics port; DOM/CSS becomes RN `View`/`Text`/`Pressable` + `StyleSheet`), Task 2 helpers, Task 3 stores, `CARD_COLOR_TOKENS`/`LOCOMOTIVE_GRADIENT` (RN: `expo-linear-gradient` — `npx expo install expo-linear-gradient`), i18n.
- Produces: prop-compatible RN ports:
  - `PlayerHand({ hand })` — 9 colour counts as chips, colour-blind glyphs when `useUi.colorBlind`, `LOCOMOTIVE` chip with the livery gradient;
  - `CardMarket({ snapshot, canDraw, onDrawFaceUp(slot), onDrawBlind })` — 5 face-up slots + deck + counts; slots expose `ref`s registered in the flight-target registry (Task 10) under keys `market-slot-{i}` / `deck`;
  - `PlayerTrackers({ snapshot })` — per player: seat colour, name via `playerName.ts` + roster, hand/ticket/train counts, score, stations remaining, current-turn ring, bot badge on `bot:` ids; registers flight targets `player-{id}`;
  - `TicketPanel({ ticketIds, completedIds })`, `TicketCard({ ticketId })` — names from catalog by id (content, not i18n);
  - `EventsPanel()` — ports the web panel: current/forecast random events from `snapshot.randomEvents`, tapping an affected-routes row calls `useAnimationsStore.setEventSpotlight({ kind: 'route', ids })` (drives the Task 5 framer). Renders null when the game has no random events.
- **Flight-target registry** (needed here so Task 10 can measure): create `apps/mobile/src/components/game/animTargets.ts`:

  ```ts
  import type { View } from 'react-native';
  const targets = new Map<string, View | null>();
  export const registerAnimTarget = (key: string, ref: View | null): void => {
    ref ? targets.set(key, ref) : targets.delete(key);
  };
  export const measureAnimTarget = (
    key: string,
  ): Promise<{ x: number; y: number; w: number; h: number } | null> =>
    new Promise((resolve) => {
      const v = targets.get(key);
      if (!v) return resolve(null);
      v.measureInWindow((x, y, w, h) => resolve({ x, y, w, h }));
    });
  ```

- [ ] **Step 1: Failing tests** — `panels.test.tsx` with `@testing-library/react-native`: render `PlayerHand` with a hand of `{RED: 3, LOCOMOTIVE: 1, …0}` → texts `3`/`1` present, glyph text `▲` appears only when `useUi` colorBlind is set; render `CardMarket` with a 5-card snapshot fixture (`create(GameSnapshotSchema, {...})` from `@trm/proto`) and `canDraw` → pressing slot 2 fires `onDrawFaceUp(2)`; `canDraw=false` → press is a no-op; `PlayerTrackers` shows a bot badge for `bot:x` and the current player ring.

Run: `yarn workspace @trm/mobile test panels` — Expected: FAIL.

- [ ] **Step 2: Implement** the six components, porting each web component's logic/order/labels 1:1 (states like `marketFlips`/`coveredMarketSlots` read from `useAnimationsStore` exactly as the web `CardMarket.tsx` does — read it first). Styling: RN `StyleSheet` with tokens from `theme/colors.ts`; keep every affordance ≥44dp touch target.

- [ ] **Step 3: Run tests** → PASS; typecheck/lint clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/game apps/mobile/package.json yarn.lock
git commit -m "feat(mobile): HUD panels — hand, market, trackers, missions, events"
```

---

### Task 8: Claim flow — payment/tunnel modals, ticket chooser, scoreboard

**Files:**

- Create: `apps/mobile/src/game/useClaimFlow.ts` (+ `useClaimFlow.test.ts`)
- Create: `apps/mobile/src/components/game/PaymentModal.tsx`
- Create: `apps/mobile/src/components/game/TunnelModal.tsx`
- Create: `apps/mobile/src/components/game/TicketChooser.tsx`
- Create: `apps/mobile/src/components/game/ScoreBoard.tsx`

**Interfaces:**

- Consumes: `enumerateRoutePayments/enumerateStationPayments/routeShortfall/stationShortfall/handAfterPayment/paymentToProto`, `enumerateTunnelExtra`, `skyLanternSurcharge/freeStationAvailable`, `GameCommands`, `useAnimationsStore.pushNotification`.
- Produces: `useClaimFlow(snapshot, commands)` → `{ claim, pickRoute(id), pickCity(id), confirmPayment(p), cancelClaim(), tunnelExtras, tunnelMine, onTunnelCommit(p), onTunnelAbort() }` — the extracted, testable form of `GameStage.tsx:108-254`'s claim/tunnel state (web keeps it inline; mobile extracts it so the logic is device-independent and P3/P4 reuse it). Modal components mirror the web components' props verbatim.

- [ ] **Step 1: Failing hook tests** — `useClaimFlow.test.ts` using `renderHook` + proto fixtures: with a hand affording a 2-RED route, `pickRoute` sets `claim.payments` non-empty; with an empty hand it pushes the `insufficientCards` notification and leaves `claim` null; `confirmPayment` on a tunnel route stashes `tunnelBase` and calls `commands.claimRoute` with the proto payment; `tunnelExtras` enumerates against `handAfterPayment(hand, tunnelBase)`; station pick with 0 remaining pushes `noStationsLeft`. (Port the exact expectations from the web behaviours in `GameStage.tsx:179-254` — including the sky-lantern `extra` and gala free-station mirrors.)

Run: `yarn workspace @trm/mobile test useClaimFlow` — Expected: FAIL.

- [ ] **Step 2: Implement `useClaimFlow.ts`** by extracting `GameStage.tsx`'s `pickRoute/pickCity/confirmPayment/tunnelBase/tunnelExtras` code verbatim into the hook (the bodies are already pure store/helper calls; only `t()` for notification text stays injected via `useTranslation`).

- [ ] **Step 3: Implement the modals** as RN `Modal`-based ports of the web components (read each): `PaymentModal` (list of payment options as pressable rows: N colour chips + M loco chips, cancel), `TunnelModal` (revealed cards, surcharge options, commit/abort; spectator read-only variant), `TicketChooser` (offered tickets with keep-checkboxes, `minKeep` enforcement, `lockLong` for setup, hand/kept peek toggles), `ScoreBoard` (final standings, per-ticket breakdown, longest-trail reveal button → `useAnimationsStore.setRouteReveal`, rematch vote row when `members` provided, leave button).

- [ ] **Step 4: Run** `yarn workspace @trm/mobile test useClaimFlow` → PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game/useClaimFlow.ts apps/mobile/src/game/useClaimFlow.test.ts apps/mobile/src/components/game/PaymentModal.tsx apps/mobile/src/components/game/TunnelModal.tsx apps/mobile/src/components/game/TicketChooser.tsx apps/mobile/src/components/game/ScoreBoard.tsx
git commit -m "feat(mobile): claim flow — payment/tunnel modals, ticket chooser, scoreboard"
```

---

### Task 9: GameStage — adaptive tiers (dock / two-pane / three-pane), comms

**Files:**

- Create: `apps/mobile/src/screens/GameStage.tsx`
- Create: `apps/mobile/src/screens/stageLayout.ts` (+ `stageLayout.test.ts`)
- Create: `apps/mobile/src/components/game/CommsPanel.tsx` (+ `LogPanel.tsx`, `ChatPanel.tsx`)
- Modify: `apps/mobile/src/screens/GameScreen.tsx` (swap the placeholder for `GameStage`)

**Interfaces:**

- Consumes: everything from Tasks 5–8, `useWindowDimensions`, web `GameStage.tsx` (the binding structural reference), web `CommsPanel/ChatPanel/LogPanel` (chat presets via `chatPresets.ts`; spectator chat disabled).
- Produces:
  - `stageTier(widthDp): 'compact' | 'two-pane' | 'three-pane'` — `< 700` / `700–999` / `≥ 1000`.
  - `GameStage` with the **web-compatible prop surface** (P3/P4 contract):
    ```ts
    export interface GameStageProps {
      snapshot: GameSnapshot;
      commands: GameCommands | null;
      onLeave: () => void;
      isHost?: boolean | undefined;
      rematchMembers?: RoomMember[] | undefined;
      onVoteRematch?: ((wantsRematch: boolean) => void) | undefined;
      onPlayAgain?: (() => void) | undefined;
      overlay?: ReactNode; // P4 tutorial coachmarks
      spotlightCities?: string[] | undefined; // P4
      sandbox?: boolean | undefined; // P3/P4
      frameTarget?: BoardFrameTarget | null | undefined; // P4
      actionGate?: ActionGate | null | undefined; // P4 — port the gateFlags helper + type
    }
    ```
  - Dock tab semantics ported from web `GameStage.tsx:376-430`: tabs `hand | draw | missions | events? | players | comms` (events tab only when `snapshot.randomEvents` exists), counts on hand/missions tabs, one panel visible at a time, **the ticket chooser takes over the whole dock** (`needKeep`), and the tutorial-gate effect (an `await` DRAW\_\* beat forces the `draw` tab — port it now; it's dead until P4 passes a gate).

- [ ] **Step 1: Failing layout tests** — `stageLayout.test.ts`:

```ts
import { stageTier, dockTabs } from './stageLayout';
describe('stageTier', () => {
  it('maps widths to the spec tiers', () => {
    expect(stageTier(360)).toBe('compact');
    expect(stageTier(699)).toBe('compact');
    expect(stageTier(700)).toBe('two-pane');
    expect(stageTier(999)).toBe('two-pane');
    expect(stageTier(1000)).toBe('three-pane');
  });
});
describe('dockTabs', () => {
  it('omits the events tab when the game has no random events', () => {
    expect(dockTabs(false).map((t) => t.key)).toEqual([
      'hand',
      'draw',
      'missions',
      'players',
      'comms',
    ]);
    expect(dockTabs(true).map((t) => t.key)).toContain('events');
  });
});
```

Run: `yarn workspace @trm/mobile test stageLayout` — Expected: FAIL.

- [ ] **Step 2: Implement `stageLayout.ts`** (the two pure functions above; `dockTabs(hasEvents)` returns `{key, labelKey, countSource}` descriptors) and **`GameStage.tsx`**:

Structure (mirror web `GameStage.tsx` top-to-bottom; port `useAnimationDriver()`/`useSoundDriver()` mounts in Task 10/11 — leave TODO-free stubs OUT until then, mount them in those tasks):

- derive `me/isSpectator/myPub/hand/phase/myTurn/canAct/canDraw/allow` exactly as web lines 159-176 (port `gateFlags` + `ActionGate` type from `apps/web/src/features/tutorial/types.ts` into `apps/mobile/src/game/actionGate.ts` — it's a pure type + function);
- `useClaimFlow` for board taps; `needKeep`/`ticketEndpoints`/`highlightCities` port from web lines 227-260;
- rejection handling ports web lines 140-157 (auto-clear on version change, 3s timeout, `pushNotification` on non-chat rejections);
- **compact**: full-bleed `BoardView` + bottom dock (`SafeAreaView` bottom inset; dock height ≈ 45% of window, board keeps gestures above it); chooser takeover;
- **two-pane**: board flex-1 + right rail (`width: 360`) containing Events/Trackers/Market/Hand/Missions stacked scroll + the rail↔comms tab pair (ports the web `wide=false` desktop branch);
- **three-pane**: board + rail + dedicated comms column (`width: 320`) (ports web `wide=true`);
- spectator banner, `PaymentModal`/`TunnelModal`/`ScoreBoard` overlays, then `{overlay}` last (P4 slot).

`CommsPanel/ChatPanel/LogPanel`: port from web components — chat input + preset-message chips (`chatPresets.ts`), log rendered from `useLog` via `logModel.ts`, `chatDisabled` for spectators. `KeyboardAvoidingView` around the chat input.

- [ ] **Step 3: Wire into `GameScreen`** (replace the Task 6 placeholder; pass roster-derived `isHost/rematchMembers/onVoteRematch/onPlayAgain` exactly as web `GameScreen` does).

- [ ] **Step 4: Validate**

`yarn workspace @trm/mobile test stageLayout` → PASS; full app device smoke on a phone (dock) AND a tablet/emulator ≥1000dp (three-pane): play a full bot game to GAME_OVER — claim (payment modal), tunnel, ticket draw/keep, station build, chat, scoreboard, rematch.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/GameStage.tsx apps/mobile/src/screens/stageLayout.ts apps/mobile/src/screens/stageLayout.test.ts apps/mobile/src/components/game/CommsPanel.tsx apps/mobile/src/components/game/ChatPanel.tsx apps/mobile/src/components/game/LogPanel.tsx apps/mobile/src/game/actionGate.ts apps/mobile/src/screens/GameScreen.tsx
git commit -m "feat(mobile): GameStage — dock/two-pane/three-pane tiers, comms, full game loop"
```

---

### Task 10: Animations — driver, card flights, floats, cues, sweeps, banners

**Files:**

- Create (ported): `apps/mobile/src/hooks/useAnimationDriver.ts` ← `apps/web/src/hooks/useAnimationDriver.ts`
- Create: `apps/mobile/src/components/game/AnimationLayer.tsx`
- Create: `apps/mobile/src/components/game/{FlightMover,NotificationStack,EndgameWarning,EventBanner,TicketFanfare}.tsx`
- Modify: `apps/mobile/src/screens/GameStage.tsx` (mount driver + layer)
- Modify: `apps/mobile/src/board/MapSceneSkia.tsx` (animated sweep trim)

**Interfaces:**

- Consumes: Task 3 `useAnimations` store + `intentsFromEvents` (ported unchanged — the intent vocabulary is the seam), Task 7 `measureAnimTarget`, Reanimated.
- Produces: `AnimationLayer` (absolute-fill overlay inside GameStage), animated sweeps in the board.
- **Scope (binding):** high-value set = card flights (deck/slot → hand/tracker), route-claim glow (already in Task 5), station ring, score floats, ticket-completion sweep (Skia path trim), opponent ticket cues, endgame warning, event banner, notification chips, and a SIMPLIFIED own-ticket fanfare (modal card + spring-in; no confetti). Deferred (do NOT build): market 3D flip (crossfade instead — `marketFlips` consumed as an opacity pulse), FlyingCard art parity, fanfare particles.

- [ ] **Step 1: Port `useAnimationDriver.ts`** — verbatim (it's store-to-store logic; only import paths change). Copy the web test if one exists (`ls apps/web/src/hooks/` at port time); else add a jest test: push a batch with `routeClaimed` → `useAnimations.getState().glowingRoutes` gains the route (drive `useGame` + `lastBatch` directly through store setters, render the hook under a test component).

Run: `yarn workspace @trm/mobile test useAnimationDriver` — write first, expect FAIL, then port → PASS.

- [ ] **Step 2: `AnimationLayer` + movers**

- `FlightMover`: on mount, `await measureAnimTarget(src)`/`(dst)` where `src = flight.slot !== null ? \`market-slot-${flight.slot}\` : 'deck'`, `dst = flight.toPlayerId === me ? 'hand' : \`player-${flight.toPlayerId}\``; missing target or reduce-motion → finish immediately (ports web fallback); else animate an absolutely-positioned card (120×~84, colour face via `CardSwatch`or cover) with Reanimated`withTiming`translate+scale over 600ms,`runOnJS(removeFlight)`on completion + a 1s failsafe timeout (ports`AnimationLayer.tsx:31-78`).
- `FloatMover`/`TicketCueView`: measure `player-{id}`, absolute-position the `+N`/mini ticket card, fade/rise via Reanimated, self-remove on end (timings port: 1300ms / 2800ms).
- `NotificationStack`: top-inset stack of chips from `useAnimationsStore.notifications`, resolving `announced`/`bonus` copy at render via i18n (port the web component's key mapping) — self-expire 4s.
- `EndgameWarning`/`EventBanner`: full-width banner ports (tap to dismiss, auto-dismiss; reduced-motion snaps).
- `TicketFanfare` (simplified): centered modal with the `TicketCard`, spring scale-in, tap to dismiss → `dismissFanfare` (queue semantics come from the store, already ported).
- Sweeps: in `MapSceneSkia`, each sweep segment renders as `<Path path={bed} style="stroke" … start={0} end={progress}/>` where `progress` is a Reanimated shared value driven `withDelay(i * 320, withTiming(1, { duration: 900 }))` — mirrors the web's `--delay: i*0.32s` stagger; `routeReveal` same with 120ms stagger, persistent until cleared. Sweep removal timers port from `Board.tsx:610-616`.

- [ ] **Step 3: Mount in GameStage** (`useAnimationDriver()` at top; `<AnimationLayer/>` after the modals) and pass `sweeps`/`routeReveal` into `BoardView` → `MapSceneSkia`.

- [ ] **Step 4: Validate** — jest suite green (`yarn workspace @trm/mobile test`); device smoke: draw cards (flights fly to hand and to opponents' trackers), complete a ticket (sweep + fanfare), trigger endgame (warning banner), random-event start (banner).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/useAnimationDriver.ts apps/mobile/src/components/game/AnimationLayer.tsx apps/mobile/src/components/game/FlightMover.tsx apps/mobile/src/components/game/NotificationStack.tsx apps/mobile/src/components/game/EndgameWarning.tsx apps/mobile/src/components/game/EventBanner.tsx apps/mobile/src/components/game/TicketFanfare.tsx apps/mobile/src/screens/GameStage.tsx apps/mobile/src/board/MapSceneSkia.tsx
git commit -m "feat(mobile): animation layer — card flights, sweeps, floats, banners"
```

---

### Task 11: Sounds — expo-av player port + sound driver

**Files:**

- Create: `apps/mobile/src/sound/cues.ts` (ported), `apps/mobile/src/sound/player.ts` (rebuilt on expo-av), `apps/mobile/src/sound/soundModel.ts` (ported ← `apps/web/src/sound/soundModel.ts`, + its test)
- Create (ported): `apps/mobile/src/hooks/useSoundDriver.ts` ← `apps/web/src/hooks/useSoundDriver.ts`
- Create: `apps/mobile/assets/sounds/*.mp3` (copied from `apps/web/public/sounds/`)
- Modify: `apps/mobile/src/screens/GameStage.tsx` (mount `useSoundDriver(sandbox)`)

**Interfaces:**

- Consumes: web `sound/{cues,player,soundModel}.ts` + `hooks/useSoundDriver.ts`, `useUi.soundEnabled/soundVolume`.
- Produces: the SAME `SoundPlayer` interface the web exports — this is the binding contract; only the factory internals differ:

  ```ts
  export interface SoundPlayer {
    preload(): Promise<void>;
    unlock(): void; // no-op on native (no autoplay policy)
    play(cue: Cue, gainScale?: number): void;
    setEnabled(on: boolean): void;
    setVolume(v: number): void;
  }
  ```

- [ ] **Step 1: Verify the audio module.** Run `yarn workspace @trm/mobile exec npx expo install expo-av`. **If SDK 56 has removed/deprecated expo-av** (its successor is `expo-audio`), install `expo-audio` instead and implement the same factory against `createAudioPlayer`/`AudioPlayer` — the `SoundPlayer` interface above is the contract either way; record which module was used in the commit message.

- [ ] **Step 2: Port `cues.ts`** — verbatim except `src` becomes a `require()` asset map:

```ts
export const CUE_ASSETS: Record<Cue, number> = {
  cardDraw: require('../../assets/sounds/card-draw.mp3'),
  yourTurn: require('../../assets/sounds/your-turn.mp3'),
  tunnelDraw: require('../../assets/sounds/tunnel-draw.mp3'),
  tunnelSuccess: require('../../assets/sounds/tunnel-success.mp3'),
  tunnelPayment: require('../../assets/sounds/tunnel-payment.mp3'),
  missionComplete: require('../../assets/sounds/mission-complete.mp3'),
  gameOverWin: require('../../assets/sounds/game-over-win.mp3'),
  gameOverNormal: require('../../assets/sounds/game-over-normal.mp3'),
  stationBuilt: require('../../assets/sounds/station-built.mp3'),
  railwayBuilt: require('../../assets/sounds/railway-built.mp3'),
  eventStart: require('../../assets/sounds/event-start.mp3'),
  chatMessage: require('../../assets/sounds/chat-message.mp3'),
};
```

Copy the 12 mp3s: `cp apps/web/public/sounds/*.mp3 apps/mobile/assets/sounds/` (verify the file list against web `cues.ts` — 12 cues).

- [ ] **Step 3: Failing player test** — port `apps/web/src/sound/player.test.ts`'s throttle/enable/volume assertions against a mocked audio module (jest-mock `expo-av`); the gain/throttle table (`CUES[cue].gain/throttleMs`) and `OPPONENT_GAIN = 0.5` port verbatim and are what the tests pin.

Run: `yarn workspace @trm/mobile test src/sound` — Expected: FAIL.

- [ ] **Step 4: Implement `player.ts`** — same shape as the web factory (enabled/volume/lastPlayed throttle maps), with `preload()` creating one `Audio.Sound` (or `AudioPlayer`) per cue from `CUE_ASSETS` (+ `Audio.setAudioModeAsync({ playsInSilentModeIOS: false, interruptionModeIOS: 'mixWithOthers' })` — game SFX must not duck the user's music); `play()` = replayAsync from 0 at `def.gain * gainScale * volume`. `unlock()` no-op. Port `soundModel.ts` + `useSoundDriver.ts` verbatim (driver deltas: the `window.addEventListener('pointerdown')` unlock block is deleted — native needs no gesture unlock; prefs subscribe stays on `useUi`).

- [ ] **Step 5: Run** `yarn workspace @trm/mobile test src/sound` → PASS; mount `useSoundDriver(sandbox)` in GameStage; device smoke: draws click, your-turn chime, game-over horn; toggling sound off silences.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/sound apps/mobile/src/hooks/useSoundDriver.ts apps/mobile/assets/sounds apps/mobile/src/screens/GameStage.tsx apps/mobile/package.json yarn.lock
git commit -m "feat(mobile): sound cues — expo-av player port + event/snapshot sound driver"
```

---

### Task 12: Full regression, tablet pass, docs

**Files:**

- Modify: `apps/mobile/CLAUDE.md` (create if P1 didn't; board + stage architecture section)
- Delete: `apps/mobile/src/screens/BoardSpikeScreen.tsx` + its navigator route (superseded by BoardView)

- [ ] **Step 1: Full gates**

Run: `yarn typecheck` → clean. `yarn lint` → clean. `yarn test` → all workspaces PASS (server/web/packages untouched — verify `git status` shows no accidental edits outside `apps/mobile`). `yarn workspace @trm/mobile test` → PASS.

- [ ] **Step 2: Device matrix smoke** (record in commit body): small Android phone (compact dock), Android tablet or resizable emulator ≥1000dp (three-pane; rotate mid-game — layout re-tiers live), and if hardware allows an iPhone via the P1 CI dev-build lane. Full bot game to completion on each; background/foreground reconnect; airplane-mode banner.

- [ ] **Step 3: Document** in `apps/mobile/CLAUDE.md`: the span-based camera model (`{cx,cy,span}` ≡ wire CameraView; `HOME_SCALE_EQUIV=2.4` LOD anchor), the manual hit-testing seam (`board/hitTest.ts` — pure, unit-tested), the quantized-LOD re-render strategy (no per-frame JS-side style writes), the GameStage prop contract preserved for P3/P4 (`sandbox`/`frameTarget`/`overlay`/`actionGate`), the jest mocks (Skia/reanimated/gesture-handler), and the react-native-svg fallback stance (documented, not planned; spike verdict reference).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/CLAUDE.md
git rm apps/mobile/src/screens/BoardSpikeScreen.tsx
# plus the navigator file edit
git commit -m "docs(mobile): board/stage architecture notes; retire the P2 spike screen"
```
