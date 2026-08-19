# Game view logic (`apps/mobile/src/game/`)

App-wide context: `apps/mobile/CLAUDE.md`. Most modules here re-export the shared game view logic
from `@trm/client-core` (payments/tunnel/events/tickets/content catalog); the files below are
mobile-owned.

- **Haptics** (`haptics.ts` + `useHaptics.ts`): `cuesForEvents` is a pure event→cue map
  (routeClaimed / tunnelRevealed / ticketCompleted / gameEnded, plus `turnStarted` for the viewer
  only) so it stays vitest-testable; `useHaptics` fires expo-haptics behind `settings.haptics`,
  mounted in GameStage next to the sound driver with the same `lastBatch.seq` once-per-batch idiom.
  `settings.haptics` is the device's ONE switch for anything that vibrates, not a game-only flag —
  the other site is `../hooks/useRefreshHaptics.ts` (pull-to-refresh, issue #61), which gates on it
  too. The your-turn nudge (issue #78, a double pulse — every other beat is a single buzz) needs the
  viewer's playerId, so it's the one cue `cuesForEvents` takes an argument for; GameStage passes
  `playing = !!commands && !demo` so replay and encyclopedia clips, which script turns for someone
  who isn't playing, never buzz for them. That is a finer gate than the stage's `sandbox` prop
  (which is also true for offline + tutorial games, where the nudge IS wanted).
- **Live Activities** (`liveActivity.ts`, pure + tested, and the `useLiveActivity.ts` driver —
  mounted from **GameScreen**, never GameStage): `apps/mobile/modules/live-activity/CLAUDE.md`.
- **`activeRoom.ts`** carries the current `gameId`/`roomCode` for push suppression and moderation
  report context (display-only, never authorization) — see `../push/CLAUDE.md`,
  `../store/CLAUDE.md`.
- **App Store review prompt** (`appReview.ts` + its `useAppReviewPrompt` driver, mounted from
  **ScoreBoard**): the iOS StoreKit review sheet after a finished game, via `expo-store-review`.
  iOS only — Android's Play In-App Review is a separate policy surface we have not taken on, and
  falling through to `requestReview()`'s store-link fallback would leave the app instead of
  prompting inside it. The OS is the real rate limiter (a few sheets per year, once per app
  version, silent otherwise), so the gates here exist to spend those slots well, not to cap:
  a two-game grace window (same "a newcomer's first game stays clean" rule as `../ads/interstitial.ts`,
  which also keeps this clear of `../push/PushPrompt.tsx`'s one-shot ask after game 1), one request
  per app version, a 90-day floor between requests, and never straight after a poor in-app rating.
  **Adding the dependency changed the OTA fingerprint** — the first OTA after it lands needs a
  fresh native build on both stores (`docs/mobile/ota.md`).
