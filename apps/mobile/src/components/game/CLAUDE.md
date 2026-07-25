# In-game components (`apps/mobile/src/components/game/`)

App-wide context: `apps/mobile/CLAUDE.md`. Stage/layout contract: `../../screens/CLAUDE.md`.

- **`AnimationLayer.tsx`** renders the animation store's card flights / sweeps / floats / banners
  against the measured `animTargets` registry; the store→store driver (`useAnimationDriver`)
  mounts once in GameStage.
- **`ChatPanel.tsx` / `PlayerActionSheet.tsx`** carry the moderation surface (blocked-author
  filtering, report/block long-press) — see `../../store/CLAUDE.md`.
- **Card rows on the web harness** (`CardRowScroll.web.tsx`): browsers don't scroll an
  overflowing row with a plain wheel or mouse drag — the web variant adds both (drag swallows
  the resulting click past a slop) while native keeps the plain horizontal ScrollView.
