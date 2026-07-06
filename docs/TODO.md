# TODO — deferred work tracker

> **Finished items shall be removed from this file** (not checked off — delete the line).
> This file tracks work deliberately reserved for later, mobile-first but not limited to it.
> Larger items should get their own spec/plan under `docs/superpowers/` when picked up.

## Mobile — deferred from v1

(See [superpowers/specs/2026-07-06-mobile-app-design.md](superpowers/specs/2026-07-06-mobile-app-design.md) for the v1 scope these were cut from.)

- **Replay viewer on mobile (v1.1)** — reuse the native GameStage sandbox pattern once it
  exists; fetch `/history/:id/replay`, run the engine locally, project per-seat (same as web
  `features/replay`).
- **Native builder rebuild (v2)** — replace the builder WebView with a Skia/RN staged editor
  **only if mobile authoring shows real usage**; revisit with usage data, don't build on spec.
- **Spectating on mobile** — link-only spectating exists on web; port the entry points.
- **Pass-and-play (local multiplayer on one device)** — feasible via the offline
  LocalGameSession, but hidden-information handoff UX (pass screen between turns) needs design.
- **Offline support for custom maps** — v1 offline games use bundled official maps only;
  add a content-hash cache so downloaded custom maps work offline.
- **Maestro E2E smoke flows** — stretch goal from the v1 test strategy (login → lobby →
  claim-a-route happy path on device).
- **Self-hosted Mac runner** — swap for GitHub-hosted macOS minutes in `mobile-ios.yml`
  when Mac hardware is available; workflow is a drop-in change.
- **Public web account-deletion page** — Google Play's Data-safety form requires an HTTPS
  URL usable without the app; the server endpoint exists (`DELETE /auth/me`), the web page
  does not. Needed before store listing (P6).

## Cross-platform (surfaced by the mobile research, benefits web too)

- **Turn timers / AFK handling** — a backgrounded mobile player (or closed laptop) stalls
  the whole table today; needs turn timer + bot-takeover/skip design. Flagged as a top risk
  in the mobile spec; deserves its own spec.
- **Web landscape-phone layout gap** — `PHONE_QUERY` is width-only (`max-width:700px`), so
  landscape phones (~740–900px wide, ~360px tall) fall into the stacked-scroll tier instead
  of the dock; board pan gestures then compete with page scroll
  (`apps/web/src/hooks/useMediaQuery.ts`).
- **Pinch-zoom style-recalc jank** — `ZoomTracker` writes `--inv-scale`/`--marker-scale`
  CSS vars per transform frame, forcing style recalc across the ~600-element SVG on every
  pinch frame; noticeable on low-end Android (`apps/web/src/components/Board.tsx:72-85`).
- **Safe-area insets on web** — only `safe-area-inset-bottom` is consumed today; header and
  map controls need top/side insets to render correctly on notched devices in standalone /
  PWA contexts.
