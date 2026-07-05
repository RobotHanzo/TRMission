# Purge Inactive Rooms/Games + Admin Delete — Design

## Problem

Rooms and games accumulate forever today — there is no TTL, no scheduled job, and (for one status
combination) no admin action capable of closing them at all. Two related gaps:

1. **No cleanup for abandoned sessions.** A `LOBBY` room nobody joins, or a `LIVE` game nobody is
   playing, sits in the `rooms`/`games` collections indefinitely.
2. **No delete capability in the admin panel.** `RoomsView`/`GamesView` can `close`/`terminate`
   (flip a status), but never remove a document. Terminal clutter (`CLOSED`/`COMPLETED`/
   `TERMINATED`) can only grow.

## Key findings that shape this design

- **`RoomDoc.updatedAt` freezes the moment a room becomes `STARTED`.** It only bumps on room-level
  ops (join/leave/settings/chat/ready/bot changes) — never on in-game actions
  (`room.repo.ts` — no write path from `hub.ts` touches a room during play). Judging a `STARTED`
  room's staleness by its own `updatedAt` would misfire on every actively-played game. The real
  signal is the **linked game's** `updatedAt`, found the same way `findActiveByMember`
  (`room.repo.ts:278-289`) already does — a `$lookup` into `games` on `gameId`.
- **A `STARTED` room whose game finishes normally is never closed.** `MongoGameStore
  .recordCompletion` (`game-store.ts:112-149`, called from `hub.ts:596-601` on natural
  `GAME_OVER`) only flips the *game* to `COMPLETED` — it never touches the room. `closeRoom`
  (`dashboard-games.service.ts:174-188`) explicitly 409s on a `STARTED` room ("terminate the game
  instead"), but `terminate()` (`dashboard-games.service.ts:144-172`) only CASes a game that's
  still `LIVE`. Net effect: **every room whose game completed and was never rematched is stuck in
  `STARTED` forever today, with no admin action able to touch it.** This — not stuck `LIVE`
  games — is the bulk of what a room-purge sweep needs to clean up.
- **A `COMPLETED` game stays resident in `GameHub`'s in-memory registry forever.** `hub.ts:207-212`
  documents this directly: eviction "never happens on natural completion." Deleting a game's DB
  docs must therefore evict it from the hub first whenever it's registry-resident — not only when
  transitioning out of `LIVE` — or a still-connected spectator/player is left pointing at deleted
  data.
- **No scheduler exists anywhere in `apps/server`** (no `@nestjs/schedule`, no cron lib, confirmed
  by a full dependency/decorator search). The only precedent for a timer-driven loop is the raw
  `setTimeout` in `hub.ts`'s bot-driver retry — that's the pattern this feature follows rather than
  introducing a new dependency.

## Scope

- **Automated purge** targets only stale *non-terminal* sessions: `LOBBY` rooms, `STARTED` rooms
  (via the finding above), and `LIVE` games. Terminal records (`CLOSED`/`COMPLETED`/`TERMINATED`)
  are never auto-deleted — including ones a sweep itself produces as a side effect (e.g. a room
  closed by cascading termination stays around until a maintainer deletes it manually).
- **Manual delete** (admin panel) works on a room/game in *any* status, in one click: terminates/
  closes first if still active, then hard-deletes.
- **All delete actions require confirmation** — room delete, game delete, and "Run purge now" all
  go through the existing `ConfirmDialog` (danger, with a free-text reason where applicable),
  exactly like today's close/terminate.
- Purge activity (both automated and manual) is counted in Prometheus metrics, labeled by trigger.

## Thresholds & configuration

New `apps/server/src/config/env.ts` entries, following the existing unprefixed/`_MS`/`_HOURS`
naming style:

| Env var | Default | Meaning |
|---|---|---|
| `PURGE_AUTO_ENABLED` | `false` (opt-in) | Whether the background sweep runs at all. Off by default because this is new automated deletion of user data — an operator should turn it on deliberately after reviewing thresholds. |
| `PURGE_INTERVAL_MS` | `3_600_000` (1h) | How often the background sweep fires. |
| `ROOM_LOBBY_PURGE_HOURS` | `24` | How long a `LOBBY` room may sit with no room-level activity before it's purge-eligible. |
| `GAME_LIVE_PURGE_HOURS` | `168` (7d) | How long a `LIVE` game may go without an action before it's purge-eligible. Reused for `STARTED` rooms via their linked game's `updatedAt` (see below) — it's the same underlying signal ("nothing has happened here"). |

Conservative defaults: long enough that a slow-paced game, or one where players stepped away and
plan to reconnect (there is no reconnect grace period today — a human can rejoin a `LIVE` game
indefinitely), isn't nuked out from under them.

## Core service: `PurgeService`

New `apps/server/src/dashboard/purge.service.ts`, in `DashboardModule`. Owns the mechanics shared
by manual delete and the auto-sweep, split so audit/metrics are attributed correctly:

- **`purgeGameCore(gameId, reason)`** (private): the shared mechanics.
  1. Load the game; return `null` if missing.
  2. If `status === 'LIVE'`: same steps as today's `terminate()` — CAS to `TERMINATED`
     (`terminatedAt/terminatedBy/terminatedReason`), `hub.evictMatch(gameId, reason)`,
     `rooms.closeByGameId(gameId)`.
  3. Else if `registry.get(gameId) !== undefined` (a `COMPLETED` game that never got evicted, per
     the finding above): `hub.evictMatch(gameId, reason)` anyway, to clear stale in-memory
     connections before the DB docs disappear underneath them. Always safe — `COMPLETED`/
     `TERMINATED` games are never resurrected.
  4. Hard-delete: `games` doc, plus every `gameEvents`/`gameSnapshots`/`gameChats` doc for that
     `gameId` (`deleteMany({gameId})` on each — all three are keyed by `gameId`, not `_id`).
     `matchHistory` is **never touched** — it's the intentional denormalized archive, and is only
     written for `COMPLETED` games in the first place.
  5. Return the game's prior status (for metrics/audit).
- **`terminateIfLive(gameId, terminatedBy, reason)`** (private): the CAS-to-`TERMINATED` + evict +
  `closeByGameId` steps factored out of `purgeGameCore` on their own — a no-op if the game isn't
  `LIVE`. This is the piece `purgeRoomCore` needs: deleting a room must only *terminate* a still-`LIVE`
  linked game (status flip, record kept, still visible in Games view), never delete that game's
  record — deleting the game itself is a separate action on the Games view. `purgeGameCore` calls
  this too, then goes on to hard-delete.
- **`purgeRoomCore(code, reason)`** (private):
  1. Load the room; return `null` if missing.
  2. If `status === 'LOBBY'`: best-effort `closeLobby(code)` (CAS; harmless no-op if it raced to
     `STARTED` — re-fetch and fall through to the next branch in that case).
  3. Re-fetch. If `status === 'STARTED'` and `gameId` is set: `terminateIfLive` for that game (a
     no-op if it's already `COMPLETED`/`TERMINATED` — the game record is left exactly as-is).
  4. Hard-delete the room doc regardless of final status.
  5. Return the room's prior status.
- **`deleteGame(actor: AuthUser, gameId, reason?)`** (public, manual path): calls
  `purgeGameCore`, 404s if it returned `null`, then `audit.log(actor, 'game.delete', {type:'game',
  id: gameId}, {reason, priorStatus})` and `metrics.gamePurged('manual', priorStatus)`.
- **`deleteRoom(actor: AuthUser, code, reason?)`** (public, manual path): same shape, `room.delete`,
  `metrics.roomPurged('manual', priorStatus)`.
- **`runSweep(trigger: 'auto' | 'manual', actor?: AuthUser)`** (public — used by both the
  background timer and the admin "Run purge now" button; `actor` is required when
  `trigger === 'manual'`):
  1. Compute `gameThreshold = now - GAME_LIVE_PURGE_HOURS` and
     `roomThreshold = now - ROOM_LOBBY_PURGE_HOURS`.
  2. **Games first**: `find({status:'LIVE', updatedAt:{$lt: gameThreshold}})`, capped at 500 —
     `purgeGameCore` each, `metrics.gamePurged(trigger, 'LIVE')` per item. Running this before the
     room queries matters: a stale `LIVE` game's cascade closes its room, so that room no longer
     matches the `STARTED` query below — no special-casing needed, just ordering.
  3. **Stale `LOBBY` rooms**: `find({status:'LOBBY', updatedAt:{$lt: roomThreshold}})`, capped at
     500 — `purgeRoomCore` each.
  4. **Stale `STARTED` rooms**: an aggregation matching the finding above —
     `$match: {status:'STARTED'}` → `$lookup` into `games` on `gameId` → effective timestamp =
     linked game's `updatedAt` if present, else the room's own `updatedAt` (orphan safety net) →
     `$match: {effectiveUpdatedAt: {$lt: gameThreshold}}`, capped at 500 — `purgeRoomCore` each.
     (This is the query that catches the "game finished, nobody rematched" case — the room's own
     status, not its linked game's status, is what makes it in-scope: the room itself is stuck
     non-terminal.)
  5. If any query hit its cap, note it (`capped: true` in the summary) — no silent truncation.
  6. Write **one** summary entry: `trigger === 'auto' ? audit.logSystem(...) :
     audit.log(actor, ...)`, action `'purge.run'`, params `{roomsDeleted, gamesDeleted, capped,
     thresholds}`. Per-item audit entries are deliberately skipped for the sweep (a run can touch
     hundreds of docs; the summary is the record) — metrics still increment per item since
     Prometheus counters are meant to aggregate.
  7. Return `{roomsDeleted, gamesDeleted, capped}`.

**Scheduler**: `PurgeService implements OnModuleInit, OnModuleDestroy`. If `env.purgeAutoEnabled`,
`onModuleInit` starts `setInterval(() => void this.runSweep('auto'), env.purgeIntervalMs)`;
`onModuleDestroy` clears it. No new dependency — matches the raw-timer style already used for the
bot-driver retry in `hub.ts`. The first sweep fires after one interval, not immediately at boot
(avoids a surprise mass-delete right after a deploy/restart before an operator has reviewed
thresholds).

## API & permissions

New permissions in `packages/shared/src/dashboard.ts`'s `DASHBOARD_PERMISSIONS`, added only to
`ADMIN_PERMISSIONS` (moderators keep close/terminate but not delete):
`rooms.delete`, `games.delete`, `purge.read`, `purge.run`.

New audit actions in `audit.repo.ts`'s `DashboardAuditAction` union: `room.delete`, `game.delete`,
`purge.run`.

New endpoints:

| Method | Path | Permission | Body |
|---|---|---|---|
| `DELETE` | `/dashboard/rooms/:code` | `rooms.delete` | `ModerationReasonDto` (reused as-is) |
| `DELETE` | `/dashboard/games/:gameId` | `games.delete` | `ModerationReasonDto` |
| `POST` | `/dashboard/purge/run` | `purge.run` | none |
| `GET` | `/dashboard/purge/status` | `purge.read` | — |

The two `DELETE` routes live on the existing `DashboardGamesController` (conventional REST grouping
by resource — games/rooms routes stay together) but call into the new `PurgeService`. `run`/
`status` live on a new `DashboardPurgeController`.

Response bodies: both `DELETE` routes return `204 No Content` (nothing left to return once the doc
is gone — same convention as the existing `deleteMaintainer`), `POST /purge/run` returns
`{roomsDeleted, gamesDeleted, capped}`, `GET /purge/status` returns the config + recent-runs shape
described below.

`GET /dashboard/purge/status` returns config (`autoEnabled`, `intervalMs`,
`roomLobbyPurgeHours`, `gameLivePurgeHours`) plus recent `purge.run` runs for the admin UI. Getting
those runs needs one small, in-spirit addition to `DashboardAuditRepo`
(`apps/server/src/dashboard/audit.repo.ts`) — a `listByAction(action, limit)` method
(`find({action}).sort({_id:-1}).limit(limit)`, mirroring the existing `countByAction` shape).
This is a new **read** method only; the repo's append-only invariant ("no update or delete
methods") is untouched. Filtering the general `list()` client-side was considered and rejected —
with hourly runs plus ordinary admin activity, the last N general entries could easily contain zero
`purge.run` rows.

## Admin UI

- **`RoomsView.tsx`**: a Delete button next to (STARTED: instead of) the close-hint, gated on
  `rooms.delete`, visible for any status. `ConfirmDialog` (`danger`, `withReason`) — body text
  differs when `status === 'STARTED'` (mentions the in-progress game will be terminated first) vs.
  `LOBBY`/`CLOSED`. On confirm: `api.deleteRoom(code, reason)` → remove the row → toast
  (`toast.roomDeleted` / error).
- **`GameDrawer` (`GamesView.tsx`)**: a Delete button alongside Terminate, gated on `games.delete`,
  visible for any status. Same pattern; body text warns when `status === 'LIVE'` that the game will
  be terminated (ending it with no scores, matching the existing terminate-confirm wording) before
  deletion.
- **New `PurgeView.tsx`**, nav item `purge` (gated on `purge.read`, new `Trash2` icon in `App.tsx`'s
  `NAV`, new `'purge'` member in `store/ui.ts`'s `AdminView` union and its path regex):
  - Read-only panel: auto-purge enabled y/n, interval, both thresholds (from
    `GET /dashboard/purge/status`).
  - "Run purge now" button, gated on `purge.run`, `ConfirmDialog` (`danger`, no reason field — it
    targets a set of stale sessions, not one entity) → `api.runPurge()` → toast showing counts
    (`toast.purgeRun`, interpolating `{rooms, games}`).
  - A small recent-runs table below (from the same status payload): timestamp, actor (`system` for
    auto, maintainer name for manual), rooms/games deleted, capped flag.
- `apps/admin/src/net/rest.ts`: `deleteRoom(code, reason?)`, `deleteGame(id, reason?)`,
  `getPurgeStatus()`, `runPurge()` added to the `api` object, following the existing
  `deleteMaintainer`/`terminateGame` call shape.
- New i18n keys (both `zh-Hant` and `en` tables in `i18n/index.ts`): `rooms.delete*`,
  `games.delete*`, `nav.purge`, a `purge.*` namespace (title, config labels, run button, recent-runs
  table headers), `toast.roomDeleted`, `toast.gameDeleted`, `toast.purgeRun`.

## Metrics

`MetricsService` (`apps/server/src/observability/metrics.service.ts`) gains two Counters,
registered alongside the existing ones, `trm_`-prefixed/`_total`-suffixed per convention:

```ts
this.roomsPurged = new Counter({
  name: 'trm_rooms_purged_total',
  help: 'Rooms deleted, by trigger and prior status',
  labelNames: ['trigger', 'priorStatus'],
  registers: [this.registry],
});
this.gamesPurged = new Counter({
  name: 'trm_games_purged_total',
  help: 'Games deleted, by trigger and prior status',
  labelNames: ['trigger', 'priorStatus'],
  registers: [this.registry],
});
```

`trigger` is `'auto'` (background sweep) or `'manual'` (admin-attended — both the per-row delete
button and an operator clicking "Run purge now"). `priorStatus` is the room's/game's status at the
moment of deletion (`LOBBY`/`STARTED` or `LIVE`/`COMPLETED`/`TERMINATED`). Public increment methods
`roomPurged(trigger, priorStatus)` / `gamePurged(trigger, priorStatus)` added to both
`MetricsService` and the dependency-free `MetricsHooks` interface (`observability/hooks.ts`) +
`NOOP_METRICS`, matching the existing seam.

## Non-goals

- No hard-delete/retention sweep for terminal records (`CLOSED`/`COMPLETED`/`TERMINATED`) — those
  are only removable via the manual per-row delete button.
- No distributed lock for the interval timer — single server instance is assumed, matching the
  current deployment model. Running multiple server instances would need this addressed.
- No change to `matchHistory`, replay, or the hidden-information rules around a `LIVE` game's seed.
- No configurable-from-the-dashboard thresholds — env vars only, per the earlier decision.
- No reconnect-grace-period feature — that's a separate concern; purge thresholds are deliberately
  long enough (7 days) that this gap doesn't collide with it in practice.

## Testing

- **`purge.service.spec.ts`** (new, `apps/server/test/` or colocated per existing convention):
  - `purgeGameCore`/`deleteGame`: `LIVE` game → terminates + evicts + closes room + hard-deletes
    all four collections; `COMPLETED` game still registry-resident → evicts without a status CAS,
    then deletes; already-`TERMINATED` game with no registry entry → deletes directly, no hub call;
    missing game → 404 (public path) / `null` (core path).
  - `purgeRoomCore`/`deleteRoom`: `LOBBY` room → closes then deletes; `STARTED` room with `LIVE`
    linked game → terminates the game (asserting the cascade), then deletes the room; `STARTED`
    room with `COMPLETED` linked game → deletes the room, leaves the game untouched; `STARTED` room
    with no linked game doc (orphan) → deletes directly.
  - `runSweep`: seeds a stale `LOBBY` room, a stale `LIVE` game (with its `STARTED` room), and a
    `STARTED` room whose game is `COMPLETED` and old — asserts all three get purged, a *fresh*
    version of each is left alone, and the `LIVE`-game room isn't double-processed by the
    `STARTED`-room query (ordering assertion). Asserts the cap + `capped: true` behavior with a
    seeded count over the limit. Asserts exactly one `purge.run` audit entry per call, with correct
    `actorId` for `'manual'` vs. `system:env`-shaped for `'auto'`.
  - Metrics: each path increments the right counter/labels (use the existing `NOOP_METRICS`-style
    fake or inspect `registry.getMetricsAsJSON()`, matching `dashboard.service.ts`'s own pattern).
- **`dashboard-read.e2e.spec.ts`/new e2e**: `DELETE` routes 403 for a `moderator`-role account
  (permission is admin-tier only), 200 + row gone for `admin`; `POST /purge/run` and
  `GET /purge/status` similarly permission-gated.
- **Admin (`apps/admin`)**: `RoomsView`/`GamesView` tests — delete button hidden without
  `rooms.delete`/`games.delete`, confirm dialog required, success removes the row + toasts, failure
  toasts and leaves the row; new `PurgeView.test.tsx` — renders config, "Run purge now" requires
  confirmation, success toast shows counts, recent-runs table renders.
- `yarn workspace @trm/server test`, `yarn workspace @trm/admin test`, `yarn lint`, `yarn typecheck`
  must pass before committing.
