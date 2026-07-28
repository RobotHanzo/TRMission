# Board rendering (`apps/mobile/src/board/` — P2)

Skia board + camera for the mobile client. App-wide context: `apps/mobile/CLAUDE.md`.
The stage that hosts this board (prop contract, layout tiers, drivers) is documented in
`../screens/CLAUDE.md`.

- **Span-based camera** (`camera.ts` + `useBoardCamera.ts`): the camera IS the wire descriptor
  `{cx, cy, span}` (board units; span = visible board-width) — identical to the protobuf
  `CameraView`, so the myTurn camera broadcast and opponent camera-follow need zero projection
  math. Reanimated shared values drive a single Skia `<Group transform>`; gestures (pan/pinch,
  gesture-handler) mutate `cx/cy/span` on the UI thread. Home/reset framing is
  `homeCamera(homeBounds(...))` — client-core's padded mainland-stop box, shared with the web
  board's `frameHome`, deliberately NOT the land (a crop can carry far more of it than the
  railways ever reach; issue #71). The zoom-out clamp and the raster scene still use `baseView`.
- **Throttled LOD, not per-frame styles**: continuous zoom moves the GPU transform every frame;
  the React tree re-renders only when the LOD re-quantizes (`cam.lod.{bucket,inv,marker}`) —
  at every settle, plus a threshold-throttled handful of times WHILE a zoom is in flight
  (`MID_GESTURE_LOD_RATIO` in `useBoardCamera.ts`), so track weights / markers / label tiers
  follow a pinch near-continuously. `HOME_SCALE_EQUIV = 2.4` anchors the span→scale-equivalent
  mapping. Never write JS-side styles per frame (the web's known jank source).
- **The Canvas host is platform-split** (`BoardCanvas.tsx` / `.web.tsx`): native drives the
  Skia `<Group>` transform from the camera's shared values (UI thread, per-frame, device-proven);
  web must NOT redraw per frame — see "Board gestures on web" below. Both implement the same
  `BoardCanvasProps` contract; keep them in sync.
- **Motion rendering blits a raster snapshot for BOTH pan and zoom** (`useStaticMapPicture.ts` +
  `MapSceneSkia`'s `motionSV` guard): while any gesture is in flight the cached vector Picture
  ducks off-screen (a per-frame `translateX` quick-reject — no React) and the board draws the
  rasterized snapshot instead, one textured quad per frame, avoiding the full vector redraw
  (every route, every dashed line, every label's stroke-halo Paragraph) that made native
  pinch-zoom disproportionately laggy versus web/RNW (whose `BoardCanvas.web.tsx` gets an
  equivalent cheap-texture-during-zoom effect for free from the browser's CSS-transform
  compositor). The snapshot is rendered ONCE per gesture, at the last settle (`cam.settled`,
  `useStaticMapImage`), and then simply scaled/translated by the live GPU transform for the
  _entire_ pan or pinch — it deliberately does NOT re-rasterize mid-gesture. A mid-gesture
  refresh (keyed to the `MID_GESTURE_LOD_RATIO` checkpoints) was tried and reverted:
  `useStaticMapImage`'s offscreen pass records the whole static Picture into a surface up to
  4096px² and reads it back to CPU (`makeNonTextureImage`), which is expensive enough by design
  ("taken while the user is idle", per its own header comment) that firing it several times
  during one pinch stalled the JS thread worse than the live-vector redraw it replaced. The
  texture can go soft at the far end of a large zoom instead; the crisp vector Picture takes
  back over the instant the gesture is genuinely at rest, or before any snapshot has ever been
  produced. `cam.zoomingSV` keeps its original settle-only semantics unchanged —
  `BoardCanvas.web.tsx` depends on it as-is for its own separate mid-pan-repaint strategy.
- **Manual hit-testing** (`hitTest.ts`, pure + unit-tested): Skia children aren't touch targets;
  a tap projects screen→board through the current camera and hit-tests routes (segment distance)
  and cities (radius) against the shared geometry. **Every board-unit quantity in it is derived
  per tap from the camera through the SAME counter-scales the renderer uses** (`invScale` for the
  track hit width and the double-pair `perp` nudge, `markerScale` for the station radius and the
  station-wins-ties margin) — which is why `hitTest` needs `homeSpan`, the anchor `webScaleEquiv`
  maps a span onto the web's zoom scale. This is the web board's model (`game.css` strokes its
  invisible `.hit` target at `--m-hit-w * --inv-scale`), plus a finger-slop floor in screen px.
  Constants baked at one zoom are what made zooming in NOT improve aim (issue #68): at `SPAN_MIN`
  the twin tracks are drawn ±0.16 board units off the chord, so a raw baked `perp` left their hit
  lines 8× too far out and a tap on either visible track hit neither — falling through to a
  station whose 1.7-board-unit floor was 4× its own drawn marker.
- **One map scene** (`MapSceneSkia.tsx`): geography → routes → cities → labels → sweep overlays,
  purely presentational (mirrors web `MapScene.tsx`); every board surface renders through it.
  `BoardView` owns the Canvas, camera, glow/sweep timers, camera sync/follow, and the framers.
- **react-native-svg fallback stance**: the P2 Task 1 device spike returned **GO** for Skia.
  The documented NO-GO fallback (react-native-svg under a single root transform) is
  _documented, not planned_ — see the P2 plan (Task 1) before ever revisiting renderers; do
  not silently switch.

## On the react-native-web harness

(Harness overview: `apps/mobile/CLAUDE.md` → "Web harness".)

- **Board gestures on web**: there is no UI thread in a browser — a Reanimated-driven Skia
  transform would force a full CanvasKit-wasm redraw per gesture frame. `BoardCanvas.web.tsx`
  instead paints the canvas at the settled camera and moves it with a composited CSS transform
  (`react-zoom-pan-pinch`-style, like the web client); a wheel listener feeds `cam.wheelZoom`
  (focal-anchored; RNGH covers mouse drag + double-click). Its header documents three
  load-bearing invariants — full-scene COVERAGE within a GPU budget (+ a mid-pan repaint
  watcher), the frame-ATOMIC baseline swap (kills the wrong-zoom flash at settle), and
  device-PIXEL-GRID snapping of resting translations (a fractional CSS translate resamples the
  raster into blur). The settled-raster snapshot is skipped on web (`BoardView`'s
  `USE_GESTURE_RASTER`), and replaced static Pictures are disposed two frames late
  (`useStaticMapPicture.disposePicture`) because CanvasKit's draw loop is decoupled from React
  commits — an immediate dispose throws `BindingError: Cannot pass deleted object`.
- **Board label fonts on web** (`webFonts.ts`): CanvasKit cannot see system fonts, and RNSkia's
  web `ParagraphBuilder.Make` THROWS without a font provider — so city labels only exist once
  the Noto Sans TC faces (copied to `public/fonts/` by `scripts/setup-web.js`) are fetched and
  registered. The provider is a RECORD dep of the static map Picture (a one-shot offscreen
  render would otherwise never re-record when fonts land), and `Skia.ParagraphBuilder.Make`
  must be called as a METHOD — the web factory reads `this.CanvasKit`, so an unbound alias
  throws (native happens to tolerate it). Loader breadcrumb: `window.__trmFonts`.
