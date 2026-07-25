# CLAUDE.md

`src/push/` talks to FCM and APNs **directly — no relay, no Expo push service**. Empty credentials =
disabled no-op, so a dev server needs no setup.

## Device tokens & notifications

`POST/DELETE /me/devices` registers native device tokens (`userDevices`, token = `_id`, so
re-registering moves it to the new account). `PushService` speaks **FCM HTTP v1** and **APNs HTTP/2
token-auth**, localizes zh-Hant/en from account preferences, and prunes dead tokens (FCM 404,
APNs 410).

The hub's `push?: PushSink` option (the metrics-hooks idiom, `src/ws/CLAUDE.md`) drives:

- **your-turn** — debounced by `PUSH_YOUR_TURN_DELAY_MS`, only when the current player has no live
  socket, re-checked at fire time;
- **game-over** — absent humans only;

both off the same `broadcast` fan-out bots share. **game-started** fires from `LobbyService.start`.
Metrics: `trm_push_sent_total` / `trm_push_failed_total`, by kind.

## iOS Live Activities (issue #43)

Same APNs credentials. `POST/DELETE /me/live-activities` registers one ActivityKit token per activity
per game (`liveActivities`, token = `_id`, 12h TTL = ActivityKit's own ceiling). The hub's
`PushSink.liveActivity` fires on TURN_STARTED / GAME_ENDED for seated humans with **no live socket** —
a connected app updates its own card, and pushing anyway would burn Apple's update budget.

`ApnsTransport.sendLiveActivity` posts to the `<bundleId>.push-type.liveactivity` topic with
`apns-push-type: liveactivity`; GAME_ENDED sends `event: "end"` + a dismissal date and drops the
game's rows.

Two invariants:

1. the payload is **numbers and booleans only** (seat index, the recipient's own trains/points, a turn
   deadline — no names, no cards);
2. content is built from the **RECIPIENT's own row**, so a token registered against a game its account
   isn't seated in receives nothing at all.

Its `content-state` keys are the mobile Swift `ContentState`'s property names — see
`apps/mobile/CLAUDE.md`.

## Env vars

A platform is enabled only when **ALL** of its credentials are set.

- Android: `FCM_PROJECT_ID` + `FCM_CLIENT_EMAIL` + `FCM_PRIVATE_KEY`.
- iOS: `APNS_TEAM_ID` + `APNS_KEY_ID` + `APNS_PRIVATE_KEY` + `APNS_BUNDLE_ID` (+ `APNS_SANDBOX=1`).
- `PUSH_YOUR_TURN_DELAY_MS` — debounces the your-turn reminder (default 15s).
