# In-game components (`apps/mobile/src/components/game/`)

App-wide context: `apps/mobile/CLAUDE.md`. Stage/layout contract: `../../screens/CLAUDE.md`.

- **`AnimationLayer.tsx`** renders the animation store's card flights / sweeps / floats / banners
  against the measured `animTargets` registry; the store→store driver (`useAnimationDriver`)
  mounts once in GameStage.
- **`ChatPanel.tsx` / `PlayerActionSheet.tsx`** carry the moderation surface (blocked-author
  filtering, report/block long-press) — see `../../store/CLAUDE.md`.
- **`PlayerCard.tsx`** is a bottom sheet, so it owns the display's edges (issue #65): every row is
  padded past `useSafeAreaInsets()` — bottom for the home indicator and the rounded corners, sides
  for a landscape notch — and it can be pulled down to dismiss. The pan runs simultaneously with
  the body's scroll and only takes over once the body is at its top; the thresholds come from
  `@trm/client-core/game/sheetDismiss` so the web sheet lets go at the same pull. The sheet raises
  its own `GestureHandlerRootView` because an Android Modal is a separate native window that the
  app's root view does not reach.
- **`PlayerHand.tsx`** has two readings: the full-size scrolling row, and `brief` — the tutorial
  glossary's card size, wrapped instead of scrolled, so the whole hand reads at a glance in a
  couple of rows. The Cards tab's collapse toggle picks between them (issue #79,
  `../../screens/CLAUDE.md`); the anim/tutorial anchor wraps both, so a collapsed hand still
  catches its own card flights.
- **Card rows on the web harness** (`CardRowScroll.web.tsx`): browsers don't scroll an
  overflowing row with a plain wheel or mouse drag — the web variant adds both (drag swallows
  the resulting click past a slop) while native keeps the plain horizontal ScrollView.
- **`ScoreBoard.tsx`** ends the game with two rating asks, and their ORDER is the point: the web's
  in-app rate-this-game block (star + optional text → `POST /ratings`, per-gameId dedupe, online
  games only) comes first, and only once it has an answer — or was never going to appear, as
  offline — does the iOS App Store review sheet get its turn (`../../game/appReview.ts`). A player
  who just rated the game at or below `POOR_RATING_STARS` is never handed to the App Store at all.
  The `played` prop is GameStage's "the viewer actually played this" test; a replay or an
  encyclopedia clip reaches game over too and earns neither the count nor the prompt.
