# Game view logic (`apps/mobile/src/game/`)

App-wide context: `apps/mobile/CLAUDE.md`. Most modules here re-export the shared game view logic
from `@trm/client-core` (payments/tunnel/events/tickets/content catalog); the files below are
mobile-owned.

- **Haptics** (`haptics.ts` + `useHaptics.ts`): `cuesForEvents` is a pure event→cue map
  (routeClaimed / tunnelRevealed / ticketCompleted / gameEnded) so it stays vitest-testable;
  `useHaptics` fires expo-haptics behind `settings.haptics`, mounted in GameStage next to the
  sound driver with the same `lastBatch.seq` once-per-batch idiom. `settings.haptics` is the
  device's ONE switch for anything that vibrates, not a game-only flag — the other site is
  `../hooks/useRefreshHaptics.ts` (pull-to-refresh, issue #61), which gates on it too.
- **Live Activities** (`liveActivity.ts`, pure + tested, and the `useLiveActivity.ts` driver —
  mounted from **GameScreen**, never GameStage): `apps/mobile/modules/live-activity/CLAUDE.md`.
- **`activeRoom.ts`** carries the current `gameId`/`roomCode` for push suppression and moderation
  report context (display-only, never authorization) — see `../push/CLAUDE.md`,
  `../store/CLAUDE.md`.
