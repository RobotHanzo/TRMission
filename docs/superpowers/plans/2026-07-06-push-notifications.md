# Push Notifications (P0-d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side push: a device-token registry (`POST/DELETE /me/devices`), a `PushService` speaking **FCM HTTP v1** and **APNs HTTP/2 token auth** directly (no SaaS relay, per the approved spec), and hub/lobby triggers — **your-turn** (only when the player has no live socket, debounced), **game-started**, **game-over** (to absent humans only).

**Architecture:** New `src/push/` module. Transports implement a small `PushTransport` seam (config-gated by env credentials — the OAuth-provider "unset = disabled" pattern); `PushService` fans out per device, prunes dead tokens (FCM 404/UNREGISTERED, APNs 410/Unregistered — both verified against current docs), localizes zh-Hant/en from user preferences, and counts `trm_push_sent_total`/`trm_push_failed_total`. The hub gets an optional `push?: PushSink` in `GameHubOptions` (the `metrics?: MetricsHooks` + NOOP idiom): a single hook in `broadcast()` scans committed events — `TURN_STARTED` schedules a debounced reminder (fire-time re-check: still that player's turn AND still socketless), `GAME_ENDED` notifies absent humans; both paths cover bot moves automatically since bots commit through the same `applyPrepared`→`broadcast`. Game-started fires from `LobbyService.start` (the one seam with display names + human/bot flags). Account deletion clears the registry.

**Tech Stack:** `google-auth-library` (already a dep — JWT client mints the FCM bearer), `jose` (already a dep — ES256 APNs provider token), `node:http2` (APNs; no library needed), NestJS + zod, vitest harness + direct `GameHub` construction (the `bots.e2e.spec.ts` idiom: `new GameHub(new GameRegistry(), {...})`, `makeDevTicket`, `encodeClient`, `pickAction`).

## Global Constraints

- swc not tsx; zod single-source; fake-seam tests; never `git add -A`; existing specs keep passing.
- Verified API facts (do not deviate): FCM `POST https://fcm.googleapis.com/v1/projects/{pid}/messages:send`, scope `https://www.googleapis.com/auth/firebase.messaging`, `data` values must be strings; APNs `POST /3/device/{token}` on `api.push.apple.com` / `api.sandbox.push.apple.com`, provider JWT ES256 `{iss: teamId, iat}` + `kid` header (refresh ≤60min; cache ~40min), headers `apns-topic` (bundle id), `apns-push-type: alert`, `apns-priority: 10`, payload `{aps:{alert:{title,body},sound:'default'}, ...customKeysAtTopLevel}`.
- Hub stays framework-light: `PushSink` is a plain interface in hub.ts; the Nest `PushService` is adapted into it by the `game.module.ts` factory.
- Your-turn debounce: default 15s (`PUSH_YOUR_TURN_DELAY_MS`), 0 in tests (still async — `setTimeout(…, 0)`); one pending timer per game (there is only one current player); cleared on `GAME_ENDED`, superseded by the next `TURN_STARTED`, re-checked at fire time. `evictMatch` clears it.
- Bots never get pushes (`isBotId`); game-over notifies only humans WITHOUT a live socket (foreground players are watching the victory screen already).

---

### Task 1: Device registry + account-deletion cleanup

**Files:**
- Create: `apps/server/src/push/device.repo.ts`, `apps/server/src/push/push.schemas.ts`, `apps/server/src/push/devices.controller.ts`, `apps/server/src/push/push.module.ts` (skeleton: repo + controller only, service lands in Task 2)
- Create: `apps/server/test/push-devices.e2e.spec.ts`
- Modify: `apps/server/src/app.module.ts` (register `PushModule`)
- Modify: `apps/server/src/account/account.module.ts` + `account-deletion.service.ts` (device cleanup)
- Modify: `apps/server/test/account-delete.e2e.spec.ts` (extend the cascade test with a device row)

**Interfaces:**
- Produces: collection `userDevices` `{ _id: token, userId, platform: 'ios'|'android', createdAt, lastSeenAt }` (index `{userId:1}`); `DeviceRepo.upsert(userId, platform, token)`, `.removeForUser(userId, token)`, `.listForUsers(userIds): Promise<DeviceDoc[]>`, `.prune(token)`, `.deleteAllForUser(userId)`; `POST /api/v1/me/devices` `{platform, token}` → 204 (re-registering a token moves it to the new account); `DELETE /api/v1/me/devices` `{token}` → 204 (scoped to own user).

- [x] Failing e2e first (`push-devices.e2e.spec.ts`): register/list-through-db/upsert-idempotent/account-move/delete-scoped tests + extend the account-delete cascade test to seed a `userDevices` row and assert it is gone after `DELETE /auth/me`. Run `--run push-devices` → FAIL (404). Implement repo/schemas/controller/module (AccessTokenGuard from AuthModule; controller `@Controller('api/v1/me/devices')`, both routes `@HttpCode(204)`), `AccountModule` imports `PushModule` and the deletion service calls `devices.deleteAllForUser`. Run `--run push-devices` and `--run account-delete` → PASS. Commit: `feat(server): mobile push device registry`.

### Task 2: PushService + FCM/APNs transports + metrics

**Files:**
- Create: `apps/server/src/push/push.transports.ts` (seam + `FcmTransport` + `ApnsTransport` + `buildTransportsFromEnv()`)
- Create: `apps/server/src/push/push.service.ts`
- Create: `apps/server/test/push-service.spec.ts`
- Modify: `apps/server/src/config/env.ts` (FCM/APNs credentials + `pushYourTurnDelayMs`)
- Modify: `apps/server/src/observability/metrics.service.ts` (`trm_push_sent_total`/`trm_push_failed_total` counters, `pushSent(kind)`/`pushFailed(kind)`)
- Modify: `apps/server/src/push/push.module.ts` (provide `PUSH_TRANSPORTS` via `buildTransportsFromEnv`, export `PushService` + `DeviceRepo`)

**Interfaces:**
- Produces:
  - `type PushKind = 'your_turn' | 'game_started' | 'game_over'`
  - `interface PushMessage { title: string; body: string; data: Record<string, string> }`
  - `interface PushTransport { readonly platform: 'ios' | 'android'; send(token: string, msg: PushMessage): Promise<'ok' | 'prune' | 'error'> }`, symbol `PUSH_TRANSPORTS` (array; empty = push disabled)
  - `PushService.notifyYourTurn(gameId, playerId)`, `.notifyGameStarted(userIds, gameId, roomCode)`, `.notifyGameOver(gameId, userIds)` — all fire-and-forget-safe (never throw), localize per `user.preferences.locale`, prune on `'prune'`.
  - Env: `FCM_PROJECT_ID`+`FCM_CLIENT_EMAIL`+`FCM_PRIVATE_KEY` (Android on iff all set), `APNS_TEAM_ID`+`APNS_KEY_ID`+`APNS_PRIVATE_KEY`+`APNS_BUNDLE_ID` (+`APNS_SANDBOX=1`) (iOS on iff all set), `PUSH_YOUR_TURN_DELAY_MS` (default 15000).
- Tests construct `PushService` directly with fake transports + real `DeviceRepo`/`UserRepo`/`MetricsService` pulled from `t.app.get(...)`: fan-out to both platforms, locale pick (zh-Hant default / en pref), token pruned on `'prune'`, bot ids skipped, no-transport no-op. Real transports are covered by typecheck only (network); their request-shaping helpers (`fcmBody`, `apnsBody`, provider-JWT builder with ~40min cache) are exported pure functions with direct unit tests.
- Commit: `feat(server): push service with direct FCM v1 + APNs transports`.

### Task 3: Hub + lobby triggers, regression, docs

**Files:**
- Modify: `apps/server/src/ws/hub.ts` (`PushSink`, `push`/`yourTurnDelayMs` options, `maybeNotify` in `broadcast`, timer cleanup in `evictMatch`)
- Modify: `apps/server/src/game/game.module.ts` (inject `PushService`, adapt into the options bag; `GameModule` imports `PushModule`)
- Modify: `apps/server/src/lobby/lobby.service.ts` + `lobby.module.ts` (game-started push after `hub.createMatch`, humans only)
- Create: `apps/server/test/push-hub.e2e.spec.ts`
- Modify: `CLAUDE.md`, `apps/server/CLAUDE.md` (env + architecture notes)

**Interfaces:**
- Produces in hub.ts:
  ```ts
  export interface PushSink {
    yourTurn(gameId: string, playerId: string): void;
    gameOver(gameId: string, playerIds: string[]): void;
  }
  ```
  `GameHubOptions.push?: PushSink`, `GameHubOptions.yourTurnDelayMs?: number` (default 15000). `maybeNotify(match, events)` called from `broadcast()`: `TURN_STARTED` → skip bots/connected, schedule per-game timer (fire-time re-check `match.session.currentPlayer === player && !members.get(gameId)?.has(player)`); `GAME_ENDED` → clear timer, `gameOver(gameId, turnOrder humans without sockets)`.
- Hub test (direct-construction idiom, `yourTurnDelayMs: 0`, recording sink): 1 human + 2 bots; human connects, plays setup + first turn (assert NO your-turn push while connected), `hub.closeConnection` → bots play → `TURN_STARTED(human)` fires the push (poll ticks until recorded). Game-over branch: the disconnect-dance loop (reconnect with a fresh conn id + dev ticket whenever actionable, disconnect after acting) drives a full deterministic game; pin a seed for which the final commit is a bot move (try a few seeds during implementation — the whole system is seeded-deterministic, so the outcome is stable per seed) and assert `gameOver` includes the human. If no convenient seed emerges within a few tries, keep the your-turn coverage and assert the game-over branch via the connected-human negative case only (documented fallback).
- Lobby: `LobbyService.start` after `hub.createMatch(...)`: `this.push.notifyGameStarted(room.members.filter(m => !m.isBot).map(m => m.userId), gameId, room._id)` — fire-and-forget (`void`, PushService never throws).
- Gates: full `yarn workspace @trm/server test`, `yarn typecheck`, `yarn lint`. Docs: env vars in root `CLAUDE.md` mobile paragraph; `apps/server/CLAUDE.md` gets a `src/push/` bullet (registry, transports, hub sink, triggers, prune semantics).
- Commits: `feat(server): your-turn/game-started/game-over push triggers` then `docs: document push notification env + architecture`.
