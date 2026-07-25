# Push (`apps/mobile/src/push/`)

App-wide context: `apps/mobile/CLAUDE.md`. Direct FCM/APNs (no Expo push service) — the app only
registers native device tokens against the P0 server surface.

`register.ts` owns the token lifecycle — its module path is load-bearing (the session store's
tests mock it): `ensurePushRegistration()` is permission-GATED and **never requests** permission
itself (that only happens from an explicit user gesture in `PushPrompt`/`NotificationsRow`);
`registerDeviceForPush()` adds the `settings.notifications` gate (the session-start hook);
`unregisterDeviceForPush()` runs before logout; `watchTokenRotation()` re-registers on FCM/APNs
rotation. Payload contract is exactly `{kind, gameId, roomCode?}`. `notifications.ts`: the
foreground handler suppresses banners for the game you're looking at (`setActiveGameId`, fed
from `RoomView.gameId` by GameScreen); `navigateForPush` is async because the nav route is
`Game {roomCode}` while `your_turn`/`game_over` carry only `gameId` — it resolves via
`api.getMyRooms()` (vanished room = no-op). `PushPrompt` is the one-shot contextual card at
game-over (`pushPromptSeen`).

**Expo Go gotcha:** never `import * as Notifications from 'expo-notifications'` directly —
`expo-notifications`'s own auto-registration side effect calls `addPushTokenListener` at IMPORT
time, which throws under Expo Go on Android (SDK 53 dropped remote push from Expo Go). All 4
call sites (`register.ts`, `notifications.ts`, `PushPrompt.tsx`, `NotificationsRow.tsx`) import
the lazy, `isRunningInExpoGo()`-gated `Notifications` from `expoNotifications.ts` instead —
`null` under Expo Go (push no-ops), the real module in dev/production builds. Same pattern in
`../auth/googleSigninModule.ts` for `@react-native-google-signin/google-signin` (a third-party
native module never bundled in Expo Go at all, unlike `expo-*` packages). Both are backed by
`apps/mobile/__mocks__/expo.js` — see `apps/mobile/__mocks__/CLAUDE.md`. Both are also gated to
`null` on the react-native-web harness.
