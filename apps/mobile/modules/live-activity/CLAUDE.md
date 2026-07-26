# Live Activities (iOS only — issue #43)

App-wide context: `apps/mobile/CLAUDE.md`.

The game in progress on the lock screen / Dynamic Island: whose turn it is (own turn called out in
EMU orange), the viewer's own trains + points, the last-round chip, and a `Text(timerInterval:)`
turn countdown that ticks **without** any update.

Four pieces, and the seam between them is one contract in three languages:

- `modules/live-activity/` (here) — a **local Expo module** (autolinked from `./modules`,
  `platforms: ["apple"]`). `ios/TrmLiveActivityModule.swift` owns at most ONE activity (`start` on
  a live one updates in place), re-adopts a still-running activity on cold start, and emits
  `onPushToken` / `onStateChange`. `index.ts` is the JS face: every call no-ops to `null`/`false`
  where the native module is absent (Android, RNW harness, Expo Go), so callers need no `Platform`
  checks.
- `ios-live-activity/` — the widget extension's SwiftUI (`ActivityConfiguration` + lock-screen and
  Dynamic Island presentations) and its `Info.plist`.
- `plugins/withLiveActivity.js` — injects the extension target into the CNG-generated pbxproj;
  traps and their regression test: `apps/mobile/plugins/CLAUDE.md`.
- `src/game/liveActivity.ts` (pure, tested) + `useLiveActivity.ts` (the driver, mounted from
  **GameScreen** — never GameStage, which the offline sandbox and tutorial also render).

**The contract**: static attributes carry the LOCALIZED per-seat turn labels + seat colours (the
widget formats and localizes nothing — i18n stays in i18next), and `ContentState` carries numbers
and booleans only. That is what lets the **server** push updates while the app is suspended
(`POST /me/live-activities` registers the ActivityKit token; the hub pushes
`apns-push-type: liveactivity` on turn changes to players whose socket is gone — see
`apps/server/src/push/`). Keep `ContentState` field-for-field identical across
`TRMissionActivityAttributes.swift`, `modules/live-activity/index.ts`, and the server's
`apnsLiveActivityBody`: a mismatch decodes to nothing and blanks the card with no error anywhere.

**Tapping the card** opens the game, not just the app (issue #63): both presentations set
`.widgetURL("trmission://room/<roomCode>")` from the STATIC attributes — the room deep link the app
already handles (`App.tsx` `linking` + `src/app/roomLink.ts`), whose room screen poll then carries a
seated player into the live game. No `ContentState` field is involved, so the pushed payload stays
numbers and booleans only.

Delivery: the extension is a second bundle id (`…trmission.LiveActivity`) and therefore a second App
ID + provisioning profile — listed in `fastlane/Matchfile`, signed per-target by the beta lane, and
registered per `docs/release/app-store-connect-setup.md` Step 2. Push-to-start is deliberately not
implemented (the app starts the activity when you enter a game).
