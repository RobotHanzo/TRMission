# Stores (`apps/mobile/src/store/`)

App-wide context: `apps/mobile/CLAUDE.md`. Most stores are thin re-exports of the shared
zustand stores in `@trm/client-core`; the files below are mobile-owned.

## Moderation (`moderation.ts` — Apple 1.2 / Play UGC)

The account's client-side mute list mirrored locally (hydrated on sign-in/restore, `reset()` on
sign-out; optimistic block/unblock with rollback via `PUT/DELETE /me/blocks/:userId`). Blocking is
display-only: `ChatPanel` filters blocked authors' messages (text AND presets) and
`usePlayerName` masks their UGC display name back to `P{seat+1}` — game state is never touched.
Long-press on a tracker row or chat message opens `PlayerActionSheet` (report with the 7
`REPORT_CATEGORIES` from `@trm/shared` + block/unblock; never for yourself or `bot:` ids — gate
with its `canModerate`). Reports POST `/reports/player` with `gameId`/`roomCode` context read from
`../game/activeRoom.ts` (set by GameScreen alongside the push-suppression id; display-only, never
authorization).

## Settings (`settings.ts` + `../screens/settings/`)

Zustand persist key `trm-settings` (haptics **on**, notifications **off**, `notifyOnlyWhenAway`
**on**, live activities **on**, `pushPromptSeen` false by default). `notifyOnlyWhenAway` (issue #48)
holds push back while the app is open — the rule lives in `../push/notifications.ts`, not here.
The screen is a grouped index + one page per group (`../screens/CLAUDE.md`).
`LiveActivityRow` renders nothing off iOS and needs no OS
permission — Live Activities are allowed unless the user switches them off for the app in iOS
Settings (`areLiveActivitiesEnabled()` is checked at start time), so it is a plain default-on toggle,
unlike the push row. `NotificationsRow` toggle ON = OS permission request (permanently denied ⇒
alert → `Linking.openSettings()`) then `ensurePushRegistration`; OFF = unregister the device.
Account deletion (hidden for guests, store-compliance requirement): two-step confirm →
`performAccountDeletion` (`../account/deleteAccount.ts`) — fresh SIWA authorization code when
available (cancel proceeds without), push unregister, `DELETE /auth/me`, local session clear.

## Session (`session.ts`)

The auth/transport port — see `../net/CLAUDE.md`.
