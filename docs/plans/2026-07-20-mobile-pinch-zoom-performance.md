# Fix laggy mobile pinch-zoom on the Skia board

## Context

The mobile board (`apps/mobile/src/board/`) already has substantial, deliberate Skia performance
engineering: the static scene (geography/routes/cities/labels) is recorded once into a cached
`SkPicture` (`useStaticMapPicture.ts`), and while the camera **pans** the board shows a
pre-rasterized GPU texture snapshot of that picture instead of replaying it live
(`useStaticMapImage`/`MapSceneSkia`'s `vectorGuard`) — this was "device-proven" specifically to
avoid the several-hundred-draw-call-per-frame cost of live vector replay during a gesture.

**Zoom was explicitly carved out of that optimization.** `MapSceneSkia.tsx`'s `vectorGuard` only
ducks the vectors (shows the cheap texture) `while motionSV && !zoomingSV` — the instant a pinch
changes the span, the code deliberately shows the full live vector picture every single frame for
the rest of the gesture, so the user always sees pixel-crisp routes/labels while zooming. That's
the lag: every frame of an active pinch redraws every route, every dashed line (the graticule grid
+ ferry dashes, both using `DashPathEffect`, which is recomputed at *replay* time, not baked in),
and every visible city label as **two** stacked Skia `Paragraph`s (fill + stroke halo) — on a real
Android GPU, at up to 120Hz, that's the reported jank.

Confirmed with the user: this is observed on a **physical Android device**. Confirmed direction:
extend the same raster-texture trick that already works for panning to zooming too, rather than a
ground-up rewrite — this mirrors what `apps/web` and the `react-native-web` harness already do for
*both* pan and zoom (`BoardCanvas.web.tsx` moves a static canvas via a free CSS transform and only
repaints at settle); native only ever extended that trick to panning.

**Hard constraint discovered during investigation:** `cam.settled` and `cam.zoomingSV`
(`useBoardCamera.ts`) are *also* consumed as-is by `BoardCanvas.web.tsx`, which has its own
independently-tuned, documented ("three hard-won invariants") strategy that relies on `settled`
meaning "camera actually at rest" and `zoomingSV` meaning "exclude zoom from mid-pan repaint
checks." Neither may be repurposed or have their update cadence changed — a new, additive field is
required for native's mid-gesture raster refresh instead of touching `settled`/`zoomingSV`.

## Approach

Reuse the **existing** mid-gesture LOD-requantize cadence (`MID_GESTURE_LOD_RATIO = 1.12` in
`useBoardCamera.ts`, already throttling track-weight/label-tier updates during a pinch) to *also*
refresh the raster snapshot at each of those same checkpoints, and let `MapSceneSkia`'s vector-duck
apply during zoom too, not just pan. No new ratio constant needed — the throttling infrastructure
already exists and already fires at exactly the right cadence; it just isn't feeding the raster
system today. Between checkpoints the existing camera transform simply scales the last-rendered
texture (mip-mapped linear sampling already guards against shimmer), the same way panning already
works today. At true settle, a fresh full-resolution raster renders exactly as it does now.

The `useStaticMapImage` raster effect already self-throttles via its `cancelled`-flag pattern (a
new `spec` cancels a still-pending previous render before it fires), so a fast full-range pinch
won't queue up dozens of real offscreen-render passes — most intermediate checkpoints during a fast
swipe will be superseded before they ever run; only the ones the JS thread actually keeps up with
produce a real raster. This is not something to hand-tune further up front.

## Changes

**`apps/mobile/src/board/useBoardCamera.ts`**
- Add `snapshotCam: CameraState` to the `BoardCamera` interface/return — the camera checkpoint the
  raster snapshot should be rendered for. Updated at the same points `lod` already is:
  - In the `useAnimatedReaction` span watcher's mid-gesture branch (where it currently does
    `runOnJS(recomputeLod)(sp)` after crossing `MID_GESTURE_LOD_RATIO`), add a sibling
    `runOnJS(recomputeSnapshotCam)(cx.value, cy.value, sp)` call.
  - In `endMotion()` and `snapTo()`, set `snapshotCam` alongside the existing `setSettled(...)`
    call (same values — settle behavior is unchanged, just now also mirrored into the new field).
  - New `recomputeSnapshotCam` callback mirrors `recomputeLod`'s shape: dedupe via the same
    "did it actually change" comparison `setSettled` already uses, to avoid pointless re-renders.
- Do **not** touch `settled` or `zoomingSV` — both keep their exact current values/cadence/meaning
  for `BoardCanvas.web.tsx`.
- Update the file's header comment (currently describes only the pan/raster split) to mention the
  new mid-gesture zoom-raster refresh.

**`apps/mobile/src/board/BoardView.tsx`**
- `raster` (~line 400): derive from `cam.snapshotCam` instead of `cam.settled`.
- Update the adjacent comment ("re-derived at every camera settle") to reflect that it now also
  updates at mid-gesture LOD checkpoints during zoom.

**`apps/mobile/src/board/MapSceneSkia.tsx`**
- `vectorGuard` (~line 332-336): drop the `&& !(zoomingSV?.value ?? false)` exclusion so the
  snapshot ducks the vectors during **any** motion (pan or zoom) once a snapshot exists.
- The `zoomingSV` prop becomes unused inside this file. Since `cam.zoomingSV` itself must stay
  (for `BoardCanvas.web.tsx`), remove just the now-dead plumbing: the `zoomingSV` prop from
  `MapSceneSkiaProps`, its pass-through in `BoardView.tsx` (`zoomingSV={cam.zoomingSV}`), and
  simplify the corresponding case in `MapSceneSkia.test.tsx`'s "UI-thread motion/zoom guard" test
  to just `motionSV`.
- Update the surrounding doc comments (the `motionSV`/`zoomingSV` prop docs, and the "Vector
  visibility, decided per frame..." block) to describe the new behavior instead of the old
  pan-only one.

**`apps/mobile/CLAUDE.md`**
- Update the "Motion rendering is split by gesture kind" paragraph (currently: *"pinch-zoom
  renders live vectors that follow the gesture in real time instead of magnifying a
  fixed-resolution texture"*) to describe the new behavior: the raster snapshot now also covers
  zoom, refreshed at the existing LOD-requantize checkpoints, with live vectors only when no
  snapshot exists yet or the camera is genuinely at rest.

## Explicitly out of scope (per user's chosen minimal direction)

Baking `DashPathEffect` usages (graticule grid, ferry-line dashes) into precomputed path geometry,
and trimming the duplicate label stroke-halo `Paragraph` pass during motion — both remain valid
follow-up wins if on-device testing shows the raster-extension alone isn't sufficient, but are not
part of this change.

## Verification

- `yarn workspace @trm/mobile typecheck`
- `yarn workspace @trm/mobile lint`
- `yarn workspace @trm/mobile test` — in particular `MapSceneSkia.test.tsx` and `camera.test.ts`
  should still pass (the latter is untouched pure-function coverage; the former just needs the
  `zoomingSV` prop removed from its guard test).
- **Primary verification is on-device** (this repo's own stated acceptance bar): pinch-zoom in/out
  repeatedly on the physical Android device, both on a fresh board and mid-game with claimed
  routes/glow overlays active, and confirm smoothness. Also spot-check that a pinch still snaps to
  fully crisp labels/track-weight once released, and that a fast full-range pinch doesn't show
  noticeably worse blur than before mid-gesture.
- Optional secondary smoke: `yarn workspace @trm/mobile web` + Playwright — `BoardCanvas.web.tsx`
  is untouched so behavior there should be identical, but worth a quick look since `MapSceneSkia`
  is shared.
