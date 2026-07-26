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

## What a tap has to be able to route (issue #63)

Two things the payload shape is load-bearing for — both were silently broken:

- **`data` must ride under a top-level `body` key on APNs** (`apnsBody`). expo-notifications reads a
  remote notification's `content.data` from `userInfo["body"]` and nowhere else, so keys spread at
  the payload top level reach the app as no data at all: every iOS tap opened the app but never the
  game. Android needs no wrapper (expo copies a non-Expo FCM `data` map through as-is), so the two
  transports deliberately differ; `push-service.spec.ts` pins both shapes.
- **every game payload carries `roomCode`** — the client's routes are room-keyed while the hub only
  ever knows game ids. `PushService.withRoomCode` resolves it through a `RoomCodeResolver` that
  **LobbyModule** wires from `RoomRepo.findByGameId` on init (PushModule must not depend on
  LobbyModule, which imports it). Without it a `game_over` tap can never find its game: the client's
  own fallback, `GET /rooms/mine`, lists LIVE games only.

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
