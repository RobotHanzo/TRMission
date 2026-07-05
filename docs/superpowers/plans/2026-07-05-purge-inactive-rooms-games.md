# Purge Inactive Rooms/Games + Admin Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a background purge of stale `LOBBY` rooms and `LIVE` games, plus admin-panel delete
buttons for rooms/games (which terminate/close first if still active), with every delete
confirmed and counted in metrics.

**Architecture:** A single new `PurgeService` (`apps/server/src/dashboard/purge.service.ts`) owns
the hard-delete mechanics — shared by two callers: the manual `DELETE` routes (used by new admin
delete buttons) and a background sweep (an interval timer, opt-in via env, plus an on-demand admin
"Run purge now" endpoint). A `STARTED` room's own `updatedAt` freezes the moment its game begins,
so staleness for `STARTED` rooms is judged by the _linked game's_ `updatedAt` via a `$lookup`.
Terminal records (`CLOSED`/`COMPLETED`/`TERMINATED`) are never auto-deleted — only removable
through the manual delete buttons.

**Tech Stack:** NestJS + MongoDB (native driver) on the server; React + zustand on the admin panel;
vitest (`mongodb-memory-server` for server e2e, `@testing-library/react` for admin).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-05-purge-inactive-rooms-games-design.md` — read it
  first if anything below is unclear; it has the full rationale (including the `updatedAt`-freeze
  and "COMPLETED game never auto-evicts" findings).
- **One deliberate deviation from the spec**: the spec sketches an injectable `PurgeConfig` wrapper
  class (mirroring `DashboardConfig`) so tests can override thresholds. This plan skips that
  wrapper — `PurgeService` reads `env.purgeAutoEnabled`/`env.purgeIntervalMs`/
  `env.roomLobbyPurgeHours`/`env.gameLivePurgeHours` directly. Tests get determinism by backdating
  seeded documents' `updatedAt`, not by shrinking thresholds, so the extra indirection isn't
  needed — this matches how the majority of this codebase's env-driven behavior works (only
  `AuthConfig`/`DashboardConfig` get a wrapper class, because _their_ tests genuinely need
  different values per test case).
- All four new permissions (`games.delete`, `rooms.delete`, `purge.read`, `purge.run`) are
  **admin-tier only** — added to `ADMIN_PERMISSIONS` in `packages/shared/src/dashboard.ts`, not
  `MODERATOR_PERMISSIONS`. Moderators keep close/terminate but not delete.
- `PURGE_AUTO_ENABLED` defaults to **off** (`false`) — this permanently deletes data; an operator
  opts in after reviewing thresholds.
- Every delete action (room delete, game delete, "Run purge now") goes through the existing
  `ConfirmDialog` component (`danger`, and `withReason` where a free-text reason applies) —
  the same pattern already used by close/terminate/revoke. No new confirmation mechanism.
- Metrics: `trm_rooms_purged_total` / `trm_games_purged_total`, Counters, labels
  `trigger` (`'auto'|'manual'`) and `priorStatus`, registered in `MetricsService`
  (`apps/server/src/observability/metrics.service.ts`) — matches the existing `trm_`-prefixed /
  `_total`-suffixed naming convention. (Not added to the hub's dependency-free `MetricsHooks`
  seam in `observability/hooks.ts` — `PurgeService` isn't on the hub's hot path and already
  injects concrete services elsewhere, same as `DashboardService` does for its own metrics reads.)
- `apps/admin/src/i18n/index.ts`'s `en` object is typed `typeof zhHant` — every new key must be
  added to **both** tables or `yarn typecheck` fails. Treat that as your correctness check for i18n
  edits.
- `matchHistory` is never touched by any code in this plan — it's the intentional archive.
- Commands: `yarn workspace @trm/server test --run <substring>`,
  `yarn workspace @trm/admin test <substring>`, `yarn typecheck`, `yarn lint` (all from repo root
  unless noted). Server tests need Docker-free `mongodb-memory-server` — no `docker compose` needed
  for this plan's tests.

---

### Task 1: Shared plumbing — permissions, env vars, audit actions, metrics counters

**Files:**

- Modify: `packages/shared/src/dashboard.ts`
- Modify: `apps/server/src/config/env.ts`
- Modify: `apps/server/src/dashboard/audit.repo.ts`
- Modify: `apps/server/src/observability/metrics.service.ts`

**Interfaces:**

- Produces: 4 new `DashboardPermission` values (`games.delete`, `rooms.delete`, `purge.read`,
  `purge.run`), all admin-tier. 3 new `DashboardAuditAction` values (`game.delete`, `room.delete`,
  `purge.run`). `DashboardAuditRepo.listByAction(action, limit): Promise<AuditEntryDoc[]>`. 4 new
  `env` fields (`purgeAutoEnabled: boolean`, `purgeIntervalMs: number`, `roomLobbyPurgeHours:
number`, `gameLivePurgeHours: number`). `MetricsService.roomPurged(trigger, priorStatus): void`
  and `.gamePurged(trigger, priorStatus): void`.
- Consumes: nothing new — purely additive to existing files.

This task has no new _behavior_ to TDD (it's typed constants + two trivial counter-increment
methods) — it's verified by typecheck and the existing regression suite for the file it touches
most meaningfully (the shared permission taxonomy).

- [ ] **Step 1: Add the 4 new permissions**

In `packages/shared/src/dashboard.ts`, replace:

```ts
export const DASHBOARD_PERMISSIONS = [
  'overview.read',
  'users.read',
  'users.ban',
  'users.features',
  'games.read',
  'games.readLog',
  'games.terminate',
  'rooms.read',
  'rooms.close',
  'maintainers.read',
  'maintainers.write',
  'audit.read',
] as const;
```

with:

```ts
export const DASHBOARD_PERMISSIONS = [
  'overview.read',
  'users.read',
  'users.ban',
  'users.features',
  'games.read',
  'games.readLog',
  'games.terminate',
  'games.delete',
  'rooms.read',
  'rooms.close',
  'rooms.delete',
  'maintainers.read',
  'maintainers.write',
  'audit.read',
  'purge.read',
  'purge.run',
] as const;
```

and replace:

```ts
const ADMIN_PERMISSIONS: readonly DashboardPermission[] = [
  ...MODERATOR_PERMISSIONS,
  'users.features',
  'maintainers.read',
  'audit.read',
];
```

with:

```ts
const ADMIN_PERMISSIONS: readonly DashboardPermission[] = [
  ...MODERATOR_PERMISSIONS,
  'users.features',
  'maintainers.read',
  'audit.read',
  'games.delete',
  'rooms.delete',
  'purge.read',
  'purge.run',
];
```

- [ ] **Step 2: Run the existing permission-taxonomy test suite**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: PASS (these tests loop over `DASHBOARD_ROLES`/`ROLE_PERMISSIONS` generically — they
don't hardcode the permission list, so they stay green once the new entries are subset-consistent).

- [ ] **Step 3: Add the 4 new env vars**

In `apps/server/src/config/env.ts`, replace the final lines:

```ts
  dashboardOwnerEmails: (process.env.DASHBOARD_OWNER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
} as const;
```

with:

```ts
  dashboardOwnerEmails: (process.env.DASHBOARD_OWNER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Background purge of stale LOBBY rooms / LIVE games (dashboard/purge.service.ts). Off by
  // default — this permanently deletes data; an operator opts in after reviewing thresholds.
  // A STARTED room's own updatedAt freezes the moment play begins, so it's swept using its
  // linked game's updatedAt — gameLivePurgeHours governs both.
  purgeAutoEnabled: process.env.PURGE_AUTO_ENABLED === '1',
  purgeIntervalMs: Number(process.env.PURGE_INTERVAL_MS ?? 60 * 60 * 1000),
  roomLobbyPurgeHours: Number(process.env.ROOM_LOBBY_PURGE_HOURS ?? 24),
  gameLivePurgeHours: Number(process.env.GAME_LIVE_PURGE_HOURS ?? 24 * 7),
} as const;
```

- [ ] **Step 4: Add the 3 new audit actions + `listByAction`**

In `apps/server/src/dashboard/audit.repo.ts`, replace:

```ts
export type DashboardAuditAction =
  | 'bootstrap.grant'
  | 'user.ban'
  | 'user.unban'
  | 'user.features'
  | 'game.terminate'
  | 'room.close'
  | 'maintainer.grant'
  | 'maintainer.update'
  | 'maintainer.revoke';
```

with:

```ts
export type DashboardAuditAction =
  | 'bootstrap.grant'
  | 'user.ban'
  | 'user.unban'
  | 'user.features'
  | 'game.terminate'
  | 'game.delete'
  | 'room.close'
  | 'room.delete'
  | 'purge.run'
  | 'maintainer.grant'
  | 'maintainer.update'
  | 'maintainer.revoke';
```

and replace:

```ts
  /** Test/bootstrap helper: how many entries exist for one action (cheap, unindexed is fine). */
  countByAction(action: DashboardAuditAction): Promise<number> {
    return this.col.countDocuments({ action });
  }
}
```

with:

```ts
  /** Test/bootstrap helper: how many entries exist for one action (cheap, unindexed is fine). */
  countByAction(action: DashboardAuditAction): Promise<number> {
    return this.col.countDocuments({ action });
  }

  /** Most recent entries for one action (the Purge view's "recent runs" list). Still a
   *  read-only addition — append/list/countByAction/this stay the only surface; no update
   *  or delete methods exist. */
  listByAction(action: DashboardAuditAction, limit: number): Promise<AuditEntryDoc[]> {
    return this.col.find({ action }).sort({ _id: -1 }).limit(limit).toArray();
  }
}
```

- [ ] **Step 5: Add the 2 new metrics counters + methods**

In `apps/server/src/observability/metrics.service.ts`, replace:

```ts
  private readonly leaks: Counter;
  private readonly botStalls: Counter<'reason'>;
```

with:

```ts
  private readonly leaks: Counter;
  private readonly botStalls: Counter<'reason'>;
  private readonly roomsPurged: Counter<'trigger' | 'priorStatus'>;
  private readonly gamesPurged: Counter<'trigger' | 'priorStatus'>;
```

replace:

```ts
    this.botStalls = new Counter({
      name: 'trm_bot_driver_stalled_total',
      help: 'Bot driver made no progress on a bot turn (should stay 0)',
      labelNames: ['reason'],
      registers: [this.registry],
    });
  }
```

with:

```ts
    this.botStalls = new Counter({
      name: 'trm_bot_driver_stalled_total',
      help: 'Bot driver made no progress on a bot turn (should stay 0)',
      labelNames: ['reason'],
      registers: [this.registry],
    });
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
  }
```

and replace:

```ts
  botDriverStalled(reason: 'no_legal_action' | 'persist_failed'): void {
    this.botStalls.inc({ reason });
  }

  metrics(): Promise<string> {
```

with:

```ts
  botDriverStalled(reason: 'no_legal_action' | 'persist_failed'): void {
    this.botStalls.inc({ reason });
  }
  roomPurged(trigger: 'auto' | 'manual', priorStatus: string): void {
    this.roomsPurged.inc({ trigger, priorStatus });
  }
  gamePurged(trigger: 'auto' | 'manual', priorStatus: string): void {
    this.gamesPurged.inc({ trigger, priorStatus });
  }

  metrics(): Promise<string> {
```

- [ ] **Step 6: Verify everything still typechecks and the server test suite is unaffected**

Run: `yarn typecheck`
Expected: PASS across all workspaces.

Run: `yarn workspace @trm/server test --run dashboard-terminate`
Expected: PASS (unrelated existing suite — confirms these additive changes didn't break the
audit/metrics files it depends on).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/dashboard.ts apps/server/src/config/env.ts apps/server/src/dashboard/audit.repo.ts apps/server/src/observability/metrics.service.ts
git commit -m "feat(dashboard): add permissions, env vars, audit actions, and metrics for room/game purge"
```

---

### Task 2: PurgeService — deleteGame (manual delete, any status)

**Files:**

- Create: `apps/server/src/dashboard/purge.service.ts`
- Modify: `apps/server/src/dashboard/dashboard-games.controller.ts`
- Modify: `apps/server/src/dashboard/dashboard.module.ts`
- Test: Create `apps/server/test/dashboard-purge.e2e.spec.ts`

**Interfaces:**

- Consumes: `MONGO_DB` token, `GameRegistry.get(gameId): Match | undefined`, `GameHub.evictMatch
(gameId, message): Promise<void>`, `RoomRepo.closeByGameId(gameId): Promise<void>`,
  `AuditService.log(actor, action, target?, params?): Promise<AuditEntryDoc>`,
  `MetricsService.gamePurged(trigger, priorStatus): void`, `GameDoc`/`GameEventDoc`/
  `GameSnapshotDoc`/`GameChatDoc` from `../persistence/types`, `AuthUser` from `../auth/auth.types`.
- Produces: `PurgeService.deleteGame(actor: AuthUser, gameId: string, reason?: string):
Promise<void>` (throws `NotFoundException` if the game doesn't exist) — Task 3 adds
  `deleteRoom` to this same class and reuses its private `terminateIfLive` helper.
  `DELETE /api/v1/dashboard/games/:gameId` (permission `games.delete`, 204 on success).

- [ ] **Step 1: Write the failing e2e tests**

Create `apps/server/test/dashboard-purge.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';
import { GameRegistry } from '../src/game/game-registry';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

/** Host + one member start a LIVE game. Returns the room code and gameId. */
async function startGame(hostName: string, memberName: string) {
  const host = await guest(hostName);
  const member = await guest(memberName);
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({})
    .expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(member.token)).expect(200);
  for (const u of [host, member]) {
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(u.token))
      .send({ ready: true })
      .expect(200);
  }
  const started = await request(server())
    .post(`/api/v1/rooms/${code}/start`)
    .set(auth(host.token))
    .expect(200);
  return { code, gameId: started.body.gameId as string, host, member };
}

async function backdateGame(gameId: string, hoursAgo: number) {
  await t.db
    .collection('games')
    .updateOne({ _id: gameId } as never, {
      $set: { updatedAt: new Date(Date.now() - hoursAgo * 3_600_000) },
    });
}
async function backdateRoom(code: string, hoursAgo: number) {
  await t.db
    .collection('rooms')
    .updateOne({ _id: code } as never, {
      $set: { updatedAt: new Date(Date.now() - hoursAgo * 3_600_000) },
    });
}

let admin: { userId: string; token: string };
let moderator: { userId: string; token: string };

beforeAll(async () => {
  t = await createTestApp();
  const adminRes = await request(server())
    .post('/api/v1/auth/register')
    .send({ email: 'admin@example.com', password: 'password123', displayName: 'Admin' })
    .expect(201);
  admin = { userId: adminRes.body.user.id, token: adminRes.body.accessToken };
  await t.db.collection('dashboardAccounts').insertOne({
    _id: admin.userId,
    role: 'admin',
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);

  const modRes = await request(server())
    .post('/api/v1/auth/register')
    .send({ email: 'mod@example.com', password: 'password123', displayName: 'Mod' })
    .expect(201);
  moderator = { userId: modRes.body.user.id, token: modRes.body.accessToken };
  await t.db.collection('dashboardAccounts').insertOne({
    _id: moderator.userId,
    role: 'moderator',
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}, 60_000);

afterAll(() => t.close());

describe('delete game', () => {
  it('403s a moderator (admin-tier permission)', async () => {
    const { gameId } = await startGame('H1', 'M1');
    await request(server())
      .delete(`/api/v1/dashboard/games/${gameId}`)
      .set(auth(moderator.token))
      .send({})
      .expect(403);
  });

  it('deletes a LIVE game: terminates, evicts, closes its room, hard-deletes all collections', async () => {
    const { code, gameId } = await startGame('H2', 'M2');
    expect(t.app.get(GameRegistry).get(gameId)).toBeTruthy();

    await request(server())
      .delete(`/api/v1/dashboard/games/${gameId}`)
      .set(auth(admin.token))
      .send({ reason: 'cleanup' })
      .expect(204);

    expect(t.app.get(GameRegistry).get(gameId)).toBeUndefined();
    expect(await t.db.collection('games').findOne({ _id: gameId } as never)).toBeNull();
    expect(await t.db.collection('gameEvents').countDocuments({ gameId } as never)).toBe(0);
    expect(await t.db.collection('gameSnapshots').countDocuments({ gameId } as never)).toBe(0);
    expect(await t.db.collection('gameChats').countDocuments({ gameId } as never)).toBe(0);
    const roomDoc = await t.db.collection('rooms').findOne({ _id: code } as never);
    expect(roomDoc?.status).toBe('CLOSED');
    expect(
      await t.db
        .collection('dashboardAudit')
        .countDocuments({ action: 'game.delete', 'target.id': gameId } as never),
    ).toBe(1);
  });

  it('deletes a COMPLETED game that is still hub-resident (natural completion never evicts)', async () => {
    const { gameId } = await startGame('H3', 'M3');
    // Simulate natural completion without playing a full game out: the hub never evicts on
    // its own natural-completion path (hub.ts), so the match stays registered exactly like a
    // real finished game would.
    await t.db
      .collection('games')
      .updateOne({ _id: gameId } as never, {
        $set: { status: 'COMPLETED', updatedAt: new Date() },
      });
    expect(t.app.get(GameRegistry).get(gameId)).toBeTruthy();

    await request(server())
      .delete(`/api/v1/dashboard/games/${gameId}`)
      .set(auth(admin.token))
      .send({})
      .expect(204);

    expect(t.app.get(GameRegistry).get(gameId)).toBeUndefined();
    expect(await t.db.collection('games').findOne({ _id: gameId } as never)).toBeNull();
  });

  it('404s an unknown game', async () => {
    await request(server())
      .delete('/api/v1/dashboard/games/nope')
      .set(auth(admin.token))
      .send({})
      .expect(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-purge`
Expected: FAIL — `404` on all requests (no `PurgeService`, no `DELETE /dashboard/games/:gameId`
route exists yet), and `Cannot find module '../src/dashboard/purge.service'` is not yet a concern
since the test file doesn't import it directly — the failures should all be HTTP-level (route
not found → 404 where 403/204/404 were expected, mismatched status codes).

- [ ] **Step 3: Create `PurgeService` with `deleteGame`**

Create `apps/server/src/dashboard/purge.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { GameHub } from '../ws/hub';
import { GameRegistry } from '../game/game-registry';
import { RoomRepo } from '../lobby/room.repo';
import type { GameDoc, GameEventDoc, GameSnapshotDoc, GameChatDoc } from '../persistence/types';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { MetricsService } from '../observability/metrics.service';

/**
 * Hard-delete mechanics for rooms/games, shared by the manual admin delete buttons and the
 * background purge sweep (added in a later change). A room/game is always terminated/closed
 * first if it's still active — never deleted out from under a live session.
 */
@Injectable()
export class PurgeService {
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly snapshots: Collection<GameSnapshotDoc>;
  private readonly chats: Collection<GameChatDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly registry: GameRegistry,
    private readonly hub: GameHub,
    private readonly rooms: RoomRepo,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.snapshots = db.collection<GameSnapshotDoc>('gameSnapshots');
    this.chats = db.collection<GameChatDoc>('gameChats');
  }

  /** Terminate a LIVE game in place: CAS to TERMINATED, evict, close its room. A no-op
   *  (not an error) if the game isn't LIVE — callers that only need "stop it if it's still
   *  running" (room deletion, added later) rely on this; the game's record is never touched
   *  here. */
  private async terminateIfLive(
    gameId: string,
    terminatedBy: string,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const res = await this.games.updateOne(
      { _id: gameId, status: 'LIVE' },
      {
        $set: {
          status: 'TERMINATED',
          terminatedAt: now,
          terminatedBy,
          terminatedReason: reason,
          updatedAt: now,
        },
      },
    );
    if (res.matchedCount === 1) {
      await this.hub.evictMatch(gameId, reason);
      await this.rooms.closeByGameId(gameId);
    }
  }

  /** Fully delete a game: terminate it first if still LIVE, evict it from the hub if
   *  resident (a COMPLETED game never auto-evicts on natural completion — see hub.ts),
   *  then hard-delete the game doc plus every gameEvents/gameSnapshots/gameChats doc for
   *  it. matchHistory is never touched — it's the intentional archive. */
  private async purgeGameCore(
    gameId: string,
    terminatedBy: string,
    reason: string,
  ): Promise<GameDoc['status'] | null> {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) return null;
    const priorStatus = game.status;
    if (priorStatus === 'LIVE') {
      await this.terminateIfLive(gameId, terminatedBy, reason);
    }
    if (this.registry.get(gameId) !== undefined) {
      await this.hub.evictMatch(gameId, reason);
    }
    await Promise.all([
      this.games.deleteOne({ _id: gameId }),
      this.events.deleteMany({ gameId }),
      this.snapshots.deleteMany({ gameId }),
      this.chats.deleteMany({ gameId }),
    ]);
    return priorStatus;
  }

  async deleteGame(actor: AuthUser, gameId: string, reason?: string): Promise<void> {
    const priorStatus = await this.purgeGameCore(
      gameId,
      actor.userId,
      reason ?? 'deleted by a maintainer',
    );
    if (priorStatus === null) throw new NotFoundException('game not found');
    await this.audit.log(
      actor,
      'game.delete',
      { type: 'game', id: gameId },
      { reason, priorStatus },
    );
    this.metrics.gamePurged('manual', priorStatus);
  }
}
```

- [ ] **Step 4: Wire the `DELETE /dashboard/games/:gameId` route**

In `apps/server/src/dashboard/dashboard-games.controller.ts`, replace the import line:

```ts
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
```

with:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
```

Add a new import alongside the existing ones:

```ts
import { PurgeService } from './purge.service';
```

Replace the constructor:

```ts
export class DashboardGamesController {
  constructor(private readonly games: DashboardGamesService) {}
```

with:

```ts
export class DashboardGamesController {
  constructor(
    private readonly games: DashboardGamesService,
    private readonly purge: PurgeService,
  ) {}
```

Insert this route right before `@Get('rooms')`:

```ts
  @Delete('games/:gameId')
  @HttpCode(204)
  @RequirePermission('games.delete')
  @ApiOperation({
    summary: 'Hard-delete a game (admin-only)',
    description:
      'Terminates it first if still LIVE (same as force-terminate), then permanently removes ' +
      'the game doc plus its action log, snapshots, and chat. matchHistory is left untouched.',
  })
  deleteGame(
    @Param('gameId') gameId: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.purge.deleteGame(actor, gameId, body.reason);
  }

```

- [ ] **Step 5: Register `PurgeService` in the module**

In `apps/server/src/dashboard/dashboard.module.ts`, add the import:

```ts
import { PurgeService } from './purge.service';
```

and replace the `providers` array:

```ts
  providers: [
    DashboardConfig,
    DashboardAccountRepo,
    DashboardAuditRepo,
    AuditService,
    DashboardGuard,
    DashboardService,
    DashboardUsersService,
    DashboardGamesService,
    DashboardMaintainersService,
    DashboardBootstrap,
  ],
```

with:

```ts
  providers: [
    DashboardConfig,
    DashboardAccountRepo,
    DashboardAuditRepo,
    AuditService,
    DashboardGuard,
    DashboardService,
    DashboardUsersService,
    DashboardGamesService,
    DashboardMaintainersService,
    DashboardBootstrap,
    PurgeService,
  ],
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace @trm/server test --run dashboard-purge`
Expected: PASS (all 4 cases in the `delete game` describe block).

- [ ] **Step 7: Typecheck and lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/dashboard/purge.service.ts apps/server/src/dashboard/dashboard-games.controller.ts apps/server/src/dashboard/dashboard.module.ts apps/server/test/dashboard-purge.e2e.spec.ts
git commit -m "feat(dashboard): add PurgeService.deleteGame + DELETE /dashboard/games/:gameId"
```

---

### Task 3: PurgeService — deleteRoom (manual delete, any status)

**Files:**

- Modify: `apps/server/src/dashboard/purge.service.ts`
- Modify: `apps/server/src/dashboard/dashboard-games.controller.ts`
- Test: Modify `apps/server/test/dashboard-purge.e2e.spec.ts`

**Interfaces:**

- Consumes: `RoomRepo.get(code): Promise<RoomDoc|null>`, `RoomRepo.closeLobby(code):
Promise<boolean>`, the private `terminateIfLive` from Task 2 (same class).
- Produces: `PurgeService.deleteRoom(actor: AuthUser, code: string, reason?: string):
Promise<void>` (throws `NotFoundException` if missing). `DELETE /api/v1/dashboard/rooms/:code`
  (permission `rooms.delete`, 204 on success). Task 4's sweep reuses the same private
  `purgeRoomCore` this task adds.

- [ ] **Step 1: Write the failing e2e tests**

Append this `describe` block to `apps/server/test/dashboard-purge.e2e.spec.ts`, after the
`describe('delete game', ...)` block:

```ts
describe('delete room', () => {
  it('403s a moderator (admin-tier permission)', async () => {
    const host = await guest('H4');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    await request(server())
      .delete(`/api/v1/dashboard/rooms/${room.body.code}`)
      .set(auth(moderator.token))
      .send({})
      .expect(403);
  });

  it('deletes a LOBBY room', async () => {
    const host = await guest('H5');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .delete(`/api/v1/dashboard/rooms/${code}`)
      .set(auth(admin.token))
      .send({ reason: 'cleanup' })
      .expect(204);

    expect(await t.db.collection('rooms').findOne({ _id: code } as never)).toBeNull();
    expect(
      await t.db
        .collection('dashboardAudit')
        .countDocuments({ action: 'room.delete', 'target.id': code } as never),
    ).toBe(1);
  });

  it('deletes a STARTED room with a LIVE game: terminates the game (record kept), deletes only the room', async () => {
    const { code, gameId } = await startGame('H6', 'M6');

    await request(server())
      .delete(`/api/v1/dashboard/rooms/${code}`)
      .set(auth(admin.token))
      .send({})
      .expect(204);

    expect(await t.db.collection('rooms').findOne({ _id: code } as never)).toBeNull();
    const gameDoc = await t.db.collection('games').findOne({ _id: gameId } as never);
    expect(gameDoc?.status).toBe('TERMINATED');
    expect(t.app.get(GameRegistry).get(gameId)).toBeUndefined();
  });

  it('deletes a STARTED room whose linked game is already COMPLETED: room gone, game untouched', async () => {
    const { code, gameId } = await startGame('H7', 'M7');
    await t.db
      .collection('games')
      .updateOne({ _id: gameId } as never, {
        $set: { status: 'COMPLETED', updatedAt: new Date() },
      });

    await request(server())
      .delete(`/api/v1/dashboard/rooms/${code}`)
      .set(auth(admin.token))
      .send({})
      .expect(204);

    expect(await t.db.collection('rooms').findOne({ _id: code } as never)).toBeNull();
    const gameDoc = await t.db.collection('games').findOne({ _id: gameId } as never);
    expect(gameDoc?.status).toBe('COMPLETED'); // untouched — not deleted, not re-terminated
  });

  it('deletes a STARTED room whose linked game no longer exists (orphan)', async () => {
    const host = await guest('H8');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await t.db
      .collection('rooms')
      .updateOne({ _id: code } as never, {
        $set: { status: 'STARTED', gameId: 'ghost-game-id', updatedAt: new Date() },
      });

    await request(server())
      .delete(`/api/v1/dashboard/rooms/${code}`)
      .set(auth(admin.token))
      .send({})
      .expect(204);

    expect(await t.db.collection('rooms').findOne({ _id: code } as never)).toBeNull();
  });

  it('404s an unknown room', async () => {
    await request(server())
      .delete('/api/v1/dashboard/rooms/NOPE1')
      .set(auth(admin.token))
      .send({})
      .expect(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-purge`
Expected: FAIL — the `delete room` describe block gets 404s (no `DELETE /dashboard/rooms/:code`
route yet); the `delete game` block from Task 2 still passes.

- [ ] **Step 3: Add `purgeRoomCore` + `deleteRoom` to `PurgeService`**

In `apps/server/src/dashboard/purge.service.ts`, replace the import:

```ts
import { RoomRepo } from '../lobby/room.repo';
```

with:

```ts
import { RoomRepo, type RoomDoc } from '../lobby/room.repo';
```

Replace the field declarations:

```ts
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly snapshots: Collection<GameSnapshotDoc>;
  private readonly chats: Collection<GameChatDoc>;
```

with:

```ts
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly snapshots: Collection<GameSnapshotDoc>;
  private readonly chats: Collection<GameChatDoc>;
  private readonly roomsCol: Collection<RoomDoc>;
```

Replace the constructor body:

```ts
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.snapshots = db.collection<GameSnapshotDoc>('gameSnapshots');
    this.chats = db.collection<GameChatDoc>('gameChats');
  }
```

with:

```ts
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.snapshots = db.collection<GameSnapshotDoc>('gameSnapshots');
    this.chats = db.collection<GameChatDoc>('gameChats');
    this.roomsCol = db.collection<RoomDoc>('rooms');
  }
```

Append at the end of the class (replace the final `}` that closes `deleteGame`/the class):

```ts
    this.metrics.gamePurged('manual', priorStatus);
  }
}
```

with:

```ts
    this.metrics.gamePurged('manual', priorStatus);
  }

  /** Delete a room: close it first if LOBBY, terminate (not delete) its linked game if
   *  STARTED with one still LIVE, then hard-delete the room doc regardless of status. A
   *  STARTED room whose game is already COMPLETED/TERMINATED is left as-is — deleting the
   *  game itself is a separate action on the Games view. */
  private async purgeRoomCore(
    code: string,
    terminatedBy: string,
    reason: string,
  ): Promise<RoomDoc['status'] | null> {
    let room = await this.rooms.get(code);
    if (!room) return null;
    const priorStatus = room.status;
    if (room.status === 'LOBBY') {
      await this.rooms.closeLobby(code);
      room = (await this.rooms.get(code)) ?? room;
    }
    if (room.status === 'STARTED' && room.gameId) {
      await this.terminateIfLive(room.gameId, terminatedBy, reason);
    }
    await this.roomsCol.deleteOne({ _id: code });
    return priorStatus;
  }

  async deleteRoom(actor: AuthUser, code: string, reason?: string): Promise<void> {
    const priorStatus = await this.purgeRoomCore(
      code,
      actor.userId,
      reason ?? 'deleted by a maintainer',
    );
    if (priorStatus === null) throw new NotFoundException('room not found');
    await this.audit.log(
      actor,
      'room.delete',
      { type: 'room', id: code },
      { reason, priorStatus },
    );
    this.metrics.roomPurged('manual', priorStatus);
  }
}
```

- [ ] **Step 4: Wire the `DELETE /dashboard/rooms/:code` route**

In `apps/server/src/dashboard/dashboard-games.controller.ts`, replace the end of the file:

```ts
  closeRoom(
    @Param('code') code: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.games.closeRoom(actor, code, body.reason);
  }
}
```

with:

```ts
  closeRoom(
    @Param('code') code: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.games.closeRoom(actor, code, body.reason);
  }

  @Delete('rooms/:code')
  @HttpCode(204)
  @RequirePermission('rooms.delete')
  @ApiOperation({
    summary: 'Hard-delete a room (admin-only)',
    description:
      'Closes it first if LOBBY; if STARTED with a LIVE game, terminates that game (its ' +
      'record is kept, not deleted) before removing the room doc.',
  })
  deleteRoom(
    @Param('code') code: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.purge.deleteRoom(actor, code, body.reason);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @trm/server test --run dashboard-purge`
Expected: PASS (both `delete game` and `delete room` describe blocks, 9 tests total).

- [ ] **Step 6: Typecheck and lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/dashboard/purge.service.ts apps/server/src/dashboard/dashboard-games.controller.ts apps/server/test/dashboard-purge.e2e.spec.ts
git commit -m "feat(dashboard): add PurgeService.deleteRoom + DELETE /dashboard/rooms/:code"
```

---

### Task 4: PurgeService — runSweep + status + scheduler + DashboardPurgeController

**Files:**

- Modify: `apps/server/src/dashboard/purge.service.ts`
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts`
- Create: `apps/server/src/dashboard/dashboard-purge.controller.ts`
- Modify: `apps/server/src/dashboard/dashboard.module.ts`
- Test: Modify `apps/server/test/dashboard-purge.e2e.spec.ts`

**Interfaces:**

- Consumes: `DashboardAuditRepo.listByAction` (Task 1), `env.purgeAutoEnabled` /
  `env.purgeIntervalMs` / `env.roomLobbyPurgeHours` / `env.gameLivePurgeHours` (Task 1),
  `AuditService.logSystem(action, target?, params?): Promise<AuditEntryDoc>`, the private
  `purgeGameCore`/`purgeRoomCore` from Tasks 2/3 (same class).
- Produces: `PurgeService.runSweep(trigger: 'auto'|'manual', actor?: AuthUser):
Promise<{roomsDeleted: number; gamesDeleted: number; capped: boolean}>`.
  `PurgeService.status(): Promise<{autoEnabled, intervalMs, roomLobbyPurgeHours,
gameLivePurgeHours, recentRuns: {at, actorName, roomsDeleted, gamesDeleted, capped}[]}>`.
  `GET /api/v1/dashboard/purge/status` (permission `purge.read`), `POST
/api/v1/dashboard/purge/run` (permission `purge.run`). Task 5 (admin REST client) consumes both
  routes and this exact response shape.

- [ ] **Step 1: Write the failing e2e tests**

Append this `describe` block to `apps/server/test/dashboard-purge.e2e.spec.ts`, after the
`describe('delete room', ...)` block:

```ts
describe('purge sweep + status', () => {
  it('403s a moderator on run and status (admin-tier permissions)', async () => {
    await request(server())
      .post('/api/v1/dashboard/purge/run')
      .set(auth(moderator.token))
      .send({})
      .expect(403);
    await request(server())
      .get('/api/v1/dashboard/purge/status')
      .set(auth(moderator.token))
      .expect(403);
  });

  it('returns config + thresholds from status', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/purge/status')
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.autoEnabled).toBe(false);
    expect(typeof res.body.intervalMs).toBe('number');
    expect(typeof res.body.roomLobbyPurgeHours).toBe('number');
    expect(typeof res.body.gameLivePurgeHours).toBe('number');
    expect(Array.isArray(res.body.recentRuns)).toBe(true);
  });

  it(
    'purges a stale LOBBY room, a stale LIVE game (closing but not deleting its room), and a ' +
      'STARTED room whose game finished long ago — leaves fresh ones alone',
    async () => {
      // Stale LOBBY room (> 24h default threshold) vs. a fresh one.
      const staleLobbyHost = await guest('SL');
      const staleLobby = await request(server())
        .post('/api/v1/rooms')
        .set(auth(staleLobbyHost.token))
        .send({})
        .expect(201);
      await backdateRoom(staleLobby.body.code, 30);
      const freshLobbyHost = await guest('FL');
      const freshLobby = await request(server())
        .post('/api/v1/rooms')
        .set(auth(freshLobbyHost.token))
        .send({})
        .expect(201);

      // Stale LIVE game (> 168h default threshold) vs. a fresh one.
      const stale = await startGame('SG-H', 'SG-M');
      await backdateGame(stale.gameId, 200);
      const fresh = await startGame('FG-H', 'FG-M');

      // STARTED room whose game finished normally long ago and was never rematched — the
      // key gap this feature exists to close (see the design doc's finding).
      const finished = await startGame('DG-H', 'DG-M');
      await t.db
        .collection('games')
        .updateOne({ _id: finished.gameId } as never, {
          $set: { status: 'COMPLETED', updatedAt: new Date(Date.now() - 200 * 3_600_000) },
        });

      const res = await request(server())
        .post('/api/v1/dashboard/purge/run')
        .set(auth(admin.token))
        .expect(200);
      expect(res.body.roomsDeleted).toBe(2); // staleLobby + finished's room
      expect(res.body.gamesDeleted).toBe(1); // stale LIVE game
      expect(res.body.capped).toBe(false);

      // Stale LOBBY room: gone. Fresh LOBBY room: untouched.
      expect(
        await t.db.collection('rooms').findOne({ _id: staleLobby.body.code } as never),
      ).toBeNull();
      expect(
        await t.db.collection('rooms').findOne({ _id: freshLobby.body.code } as never),
      ).not.toBeNull();

      // Stale LIVE game: deleted; its room is CLOSED but NOT deleted (non-goal: terminal
      // records produced as a side effect of a sweep are left for manual cleanup).
      expect(await t.db.collection('games').findOne({ _id: stale.gameId } as never)).toBeNull();
      const staleRoom = await t.db.collection('rooms').findOne({ _id: stale.code } as never);
      expect(staleRoom?.status).toBe('CLOSED');
      // Fresh LIVE game: untouched.
      expect(await t.db.collection('games').findOne({ _id: fresh.gameId } as never)).not.toBeNull();

      // Finished-long-ago room: deleted; its COMPLETED game record is left alone.
      expect(await t.db.collection('rooms').findOne({ _id: finished.code } as never)).toBeNull();
      const finishedGame = await t.db
        .collection('games')
        .findOne({ _id: finished.gameId } as never);
      expect(finishedGame?.status).toBe('COMPLETED');

      // Exactly one purge.run audit entry, attributed to the admin who triggered it.
      const auditEntries = await t.db
        .collection('dashboardAudit')
        .find({ action: 'purge.run' } as never)
        .toArray();
      expect(auditEntries.length).toBe(1);
      expect((auditEntries[0] as { actorId: string }).actorId).toBe(admin.userId);

      // Recent-runs now shows it.
      const status = await request(server())
        .get('/api/v1/dashboard/purge/status')
        .set(auth(admin.token))
        .expect(200);
      expect(status.body.recentRuns.length).toBeGreaterThanOrEqual(1);
      expect(status.body.recentRuns[0].roomsDeleted).toBe(res.body.roomsDeleted);
    },
    60_000,
  );

  it('caps a sweep at 500 rooms per run and reports capped:true', async () => {
    const stale = new Date(Date.now() - 30 * 3_600_000);
    const docs = Array.from({ length: 501 }, (_, i) => ({
      _id: `CAP${i}`,
      hostId: 'nobody',
      status: 'LOBBY',
      members: [],
      maxPlayers: 5,
      settings: {},
      createdAt: stale,
      updatedAt: stale,
    }));
    await t.db.collection('rooms').insertMany(docs as never);

    const res = await request(server())
      .post('/api/v1/dashboard/purge/run')
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.capped).toBe(true);
    expect(res.body.roomsDeleted).toBe(500);

    const remaining = await t.db
      .collection('rooms')
      .countDocuments({ _id: { $regex: /^CAP/ } } as never);
    expect(remaining).toBe(1);
  }, 30_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-purge`
Expected: FAIL — the `purge sweep + status` describe block gets 404s (no
`DashboardPurgeController`, no `runSweep`/`status` methods yet); the two earlier describe blocks
still pass.

- [ ] **Step 3: Add `runSweep` + `status` + the scheduler to `PurgeService`**

In `apps/server/src/dashboard/purge.service.ts`, replace the import block:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { GameHub } from '../ws/hub';
import { GameRegistry } from '../game/game-registry';
import { RoomRepo, type RoomDoc } from '../lobby/room.repo';
import type { GameDoc, GameEventDoc, GameSnapshotDoc, GameChatDoc } from '../persistence/types';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { MetricsService } from '../observability/metrics.service';
```

with:

```ts
import {
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { env } from '../config/env';
import { GameHub } from '../ws/hub';
import { GameRegistry } from '../game/game-registry';
import { RoomRepo, type RoomDoc } from '../lobby/room.repo';
import type { GameDoc, GameEventDoc, GameSnapshotDoc, GameChatDoc } from '../persistence/types';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { DashboardAuditRepo } from './audit.repo';
import { MetricsService } from '../observability/metrics.service';

export type PurgeTrigger = 'auto' | 'manual';

export interface PurgeSummary {
  roomsDeleted: number;
  gamesDeleted: number;
  capped: boolean;
}

const SWEEP_CAP = 500;
const SYSTEM_ACTOR_ID = 'system:purge';
```

Replace the class declaration + fields + constructor:

```ts
@Injectable()
export class PurgeService {
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly snapshots: Collection<GameSnapshotDoc>;
  private readonly chats: Collection<GameChatDoc>;
  private readonly roomsCol: Collection<RoomDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly registry: GameRegistry,
    private readonly hub: GameHub,
    private readonly rooms: RoomRepo,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.snapshots = db.collection<GameSnapshotDoc>('gameSnapshots');
    this.chats = db.collection<GameChatDoc>('gameChats');
    this.roomsCol = db.collection<RoomDoc>('rooms');
  }
```

with:

```ts
@Injectable()
export class PurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly snapshots: Collection<GameSnapshotDoc>;
  private readonly chats: Collection<GameChatDoc>;
  private readonly roomsCol: Collection<RoomDoc>;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly registry: GameRegistry,
    private readonly hub: GameHub,
    private readonly rooms: RoomRepo,
    private readonly audit: AuditService,
    private readonly auditRepo: DashboardAuditRepo,
    private readonly metrics: MetricsService,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.snapshots = db.collection<GameSnapshotDoc>('gameSnapshots');
    this.chats = db.collection<GameChatDoc>('gameChats');
    this.roomsCol = db.collection<RoomDoc>('rooms');
  }

  onModuleInit(): void {
    if (env.purgeAutoEnabled) {
      this.timer = setInterval(() => void this.runSweep('auto'), env.purgeIntervalMs);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
```

Append at the end of the class (replace the final closing brace after `deleteRoom`):

```ts
    this.metrics.roomPurged('manual', priorStatus);
  }
}
```

with:

```ts
    this.metrics.roomPurged('manual', priorStatus);
  }

  async runSweep(trigger: PurgeTrigger, actor?: AuthUser): Promise<PurgeSummary> {
    if (trigger === 'manual' && !actor) throw new Error('manual sweep requires an actor');
    const terminatedBy = trigger === 'auto' ? SYSTEM_ACTOR_ID : actor!.userId;
    const now = Date.now();
    const gameThreshold = new Date(now - env.gameLivePurgeHours * 3_600_000);
    const roomThreshold = new Date(now - env.roomLobbyPurgeHours * 3_600_000);

    const staleGames = await this.games
      .find({ status: 'LIVE', updatedAt: { $lt: gameThreshold } })
      .limit(SWEEP_CAP + 1)
      .toArray();
    const gamesCapped = staleGames.length > SWEEP_CAP;
    for (const g of staleGames.slice(0, SWEEP_CAP)) {
      const prior = await this.purgeGameCore(g._id, terminatedBy, 'auto-purge: inactive LIVE game');
      if (prior) this.metrics.gamePurged(trigger, prior);
    }

    const staleLobby = await this.roomsCol
      .find({ status: 'LOBBY', updatedAt: { $lt: roomThreshold } })
      .limit(SWEEP_CAP + 1)
      .toArray();
    const lobbyCapped = staleLobby.length > SWEEP_CAP;
    for (const r of staleLobby.slice(0, SWEEP_CAP)) {
      const prior = await this.purgeRoomCore(r._id, terminatedBy, 'auto-purge: inactive LOBBY room');
      if (prior) this.metrics.roomPurged(trigger, prior);
    }

    const staleStarted = await this.roomsCol
      .aggregate<RoomDoc>([
        { $match: { status: 'STARTED' } },
        { $lookup: { from: 'games', localField: 'gameId', foreignField: '_id', as: 'game' } },
        {
          $addFields: {
            effectiveUpdatedAt: {
              $ifNull: [{ $arrayElemAt: ['$game.updatedAt', 0] }, '$updatedAt'],
            },
          },
        },
        { $match: { effectiveUpdatedAt: { $lt: gameThreshold } } },
        { $project: { game: 0, effectiveUpdatedAt: 0 } },
        { $limit: SWEEP_CAP + 1 },
      ])
      .toArray();
    const startedCapped = staleStarted.length > SWEEP_CAP;
    for (const r of staleStarted.slice(0, SWEEP_CAP)) {
      const prior = await this.purgeRoomCore(
        r._id,
        terminatedBy,
        'auto-purge: inactive STARTED room',
      );
      if (prior) this.metrics.roomPurged(trigger, prior);
    }

    const summary: PurgeSummary = {
      gamesDeleted: Math.min(staleGames.length, SWEEP_CAP),
      roomsDeleted:
        Math.min(staleLobby.length, SWEEP_CAP) + Math.min(staleStarted.length, SWEEP_CAP),
      capped: gamesCapped || lobbyCapped || startedCapped,
    };
    const params = {
      ...summary,
      thresholds: {
        gameLiveHours: env.gameLivePurgeHours,
        roomLobbyHours: env.roomLobbyPurgeHours,
      },
    };
    if (trigger === 'auto') {
      await this.audit.logSystem('purge.run', undefined, params);
    } else {
      await this.audit.log(actor!, 'purge.run', undefined, params);
    }
    return summary;
  }

  async status(): Promise<{
    autoEnabled: boolean;
    intervalMs: number;
    roomLobbyPurgeHours: number;
    gameLivePurgeHours: number;
    recentRuns: {
      at: string;
      actorName: string;
      roomsDeleted: number;
      gamesDeleted: number;
      capped: boolean;
    }[];
  }> {
    const entries = await this.auditRepo.listByAction('purge.run', 10);
    return {
      autoEnabled: env.purgeAutoEnabled,
      intervalMs: env.purgeIntervalMs,
      roomLobbyPurgeHours: env.roomLobbyPurgeHours,
      gameLivePurgeHours: env.gameLivePurgeHours,
      recentRuns: entries.map((e) => ({
        at: e.at.toISOString(),
        actorName: e.actorName,
        roomsDeleted: (e.params?.roomsDeleted as number | undefined) ?? 0,
        gamesDeleted: (e.params?.gamesDeleted as number | undefined) ?? 0,
        capped: (e.params?.capped as boolean | undefined) ?? false,
      })),
    };
  }
}
```

- [ ] **Step 4: Add the response schemas**

In `apps/server/src/dashboard/dashboard.schemas.ts`, append at the end of the file:

```ts
// ---- purge --------------------------------------------------------------------------

export const PurgeRunResultSchema = z.object({
  roomsDeleted: z.number(),
  gamesDeleted: z.number(),
  capped: z.boolean(),
});

export const PurgeStatusSchema = z.object({
  autoEnabled: z.boolean(),
  intervalMs: z.number(),
  roomLobbyPurgeHours: z.number(),
  gameLivePurgeHours: z.number(),
  recentRuns: z.array(
    z.object({
      at: z.string(),
      actorName: z.string(),
      roomsDeleted: z.number(),
      gamesDeleted: z.number(),
      capped: z.boolean(),
    }),
  ),
});
```

- [ ] **Step 5: Create `DashboardPurgeController`**

Create `apps/server/src/dashboard/dashboard-purge.controller.ts`:

```ts
import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { PurgeService } from './purge.service';
import { PurgeRunResultSchema, PurgeStatusSchema } from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard/purge')
export class DashboardPurgeController {
  constructor(private readonly purge: PurgeService) {}

  @Get('status')
  @RequirePermission('purge.read')
  @ApiOperation({ summary: 'Purge configuration, thresholds, and recent runs' })
  @ApiResponse({ status: 200, schema: apiSchema(PurgeStatusSchema) })
  status() {
    return this.purge.status();
  }

  @Post('run')
  @HttpCode(200)
  @RequirePermission('purge.run')
  @ApiOperation({
    summary: 'Run the inactive-session purge sweep immediately (admin-only)',
    description:
      'Deletes stale LOBBY rooms and LIVE games past their idle threshold (games are ' +
      'force-terminated first); a STARTED room whose linked game has gone idle is deleted ' +
      'too (the game record itself is only touched if still LIVE). Terminal records are ' +
      'never auto-deleted.',
  })
  @ApiResponse({ status: 200, schema: apiSchema(PurgeRunResultSchema) })
  run(@CurrentUser() actor: AuthUser) {
    return this.purge.runSweep('manual', actor);
  }
}
```

- [ ] **Step 6: Register the controller**

In `apps/server/src/dashboard/dashboard.module.ts`, add the import:

```ts
import { DashboardPurgeController } from './dashboard-purge.controller';
```

and replace the `controllers` array:

```ts
  controllers: [
    DashboardController,
    DashboardUsersController,
    DashboardGamesController,
    DashboardMaintainersController,
  ],
```

with:

```ts
  controllers: [
    DashboardController,
    DashboardUsersController,
    DashboardGamesController,
    DashboardMaintainersController,
    DashboardPurgeController,
  ],
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `yarn workspace @trm/server test --run dashboard-purge`
Expected: PASS (all three describe blocks — `delete game`, `delete room`, `purge sweep +
status`).

- [ ] **Step 8: Full server suite, typecheck, lint**

Run: `yarn workspace @trm/server test`
Expected: PASS (no regressions in the rest of the server suite).

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/dashboard/purge.service.ts apps/server/src/dashboard/dashboard.schemas.ts apps/server/src/dashboard/dashboard-purge.controller.ts apps/server/src/dashboard/dashboard.module.ts apps/server/test/dashboard-purge.e2e.spec.ts
git commit -m "feat(dashboard): add purge sweep, scheduler, and GET/POST /dashboard/purge endpoints"
```

---

### Task 5: Admin REST client + i18n

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/i18n/index.ts`

**Interfaces:**

- Produces: `api.deleteRoom(code, reason?): Promise<void>`, `api.deleteGame(id, reason?):
Promise<void>`, `api.getPurgeStatus(): Promise<PurgeStatus>`, `api.runPurge():
Promise<PurgeRunResult>`, and the `PurgeStatus`/`PurgeRunResult` interfaces — consumed by Tasks
  6–8. New i18n keys (listed in Step 2) — consumed by Tasks 6–8's JSX.

This task adds no new behavior of its own (a REST client function is just a typed `fetch` call;
i18n strings are static data) — there's nothing meaningful to red/green here. It's verified by
`yarn typecheck` (which enforces the `en: typeof zhHant` key-tree match) and the full existing
admin test suite staying green.

- [ ] **Step 1: Add the REST client functions**

In `apps/admin/src/net/rest.ts`, add these two interfaces right after the `AuditEntry` interface
(before `export type UsersPage = ...`):

```ts
export interface PurgeRunResult {
  roomsDeleted: number;
  gamesDeleted: number;
  capped: boolean;
}
export interface PurgeStatus {
  autoEnabled: boolean;
  intervalMs: number;
  roomLobbyPurgeHours: number;
  gameLivePurgeHours: number;
  recentRuns: {
    at: string;
    actorName: string;
    roomsDeleted: number;
    gamesDeleted: number;
    capped: boolean;
  }[];
}
```

Replace:

```ts
  terminateGame: (id: string, reason?: string) =>
    req<GameDetail>('POST', `/dashboard/games/${encodeURIComponent(id)}/terminate`, { reason }),

  listRooms: (opts: { status?: string; cursor?: string } = {}) =>
    req<RoomsPage>('GET', `/dashboard/rooms${qs(opts)}`),
  closeRoom: (code: string, reason?: string) =>
    req<RoomRow>('POST', `/dashboard/rooms/${encodeURIComponent(code)}/close`, { reason }),
```

with:

```ts
  terminateGame: (id: string, reason?: string) =>
    req<GameDetail>('POST', `/dashboard/games/${encodeURIComponent(id)}/terminate`, { reason }),
  deleteGame: (id: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/games/${encodeURIComponent(id)}`, { reason }),

  listRooms: (opts: { status?: string; cursor?: string } = {}) =>
    req<RoomsPage>('GET', `/dashboard/rooms${qs(opts)}`),
  closeRoom: (code: string, reason?: string) =>
    req<RoomRow>('POST', `/dashboard/rooms/${encodeURIComponent(code)}/close`, { reason }),
  deleteRoom: (code: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/rooms/${encodeURIComponent(code)}`, { reason }),
```

Replace:

```ts
  listAudit: (opts: { cursor?: string } = {}) =>
    req<AuditPage>('GET', `/dashboard/audit${qs(opts)}`),
};
```

with:

```ts
  listAudit: (opts: { cursor?: string } = {}) =>
    req<AuditPage>('GET', `/dashboard/audit${qs(opts)}`),

  getPurgeStatus: () => req<PurgeStatus>('GET', '/dashboard/purge/status'),
  runPurge: () => req<PurgeRunResult>('POST', '/dashboard/purge/run', {}),
};
```

- [ ] **Step 2: Add i18n keys to both locale tables**

In `apps/admin/src/i18n/index.ts`, make the following 7 pairs of edits. Each `zhHant` edit has a
matching `en` edit right below it — do both or `yarn typecheck` will fail (the `en` object is
typed `typeof zhHant`).

**2a. `nav.purge`** — zhHant, replace:

```ts
  nav: {
    overview: '總覽',
    users: '使用者',
    features: '功能開通',
    games: '對局',
    rooms: '房間',
    maintainers: '維護者',
    audit: '稽核',
    logout: '登出',
```

with:

```ts
  nav: {
    overview: '總覽',
    users: '使用者',
    features: '功能開通',
    games: '對局',
    rooms: '房間',
    maintainers: '維護者',
    audit: '稽核',
    purge: '清理',
    logout: '登出',
```

en, replace:

```ts
  nav: {
    overview: 'Overview',
    users: 'Users',
    features: 'Feature access',
    games: 'Games',
    rooms: 'Rooms',
    maintainers: 'Maintainers',
    audit: 'Audit',
    logout: 'Sign out',
```

with:

```ts
  nav: {
    overview: 'Overview',
    users: 'Users',
    features: 'Feature access',
    games: 'Games',
    rooms: 'Rooms',
    maintainers: 'Maintainers',
    audit: 'Audit',
    purge: 'Purge',
    logout: 'Sign out',
```

**2b. `toast.roomDeleted`/`gameDeleted`/`purgeRun`** — zhHant, replace:

```ts
  toast: {
    userBanned: '帳號已停權',
    userUnbanned: '已解除停權',
    featuresSaved: '功能開通已儲存',
    gameTerminated: '對局已強制終止',
    roomClosed: '房間已關閉',
    maintainerSaved: '維護者權限已儲存',
    maintainerRevoked: '維護者權限已撤銷',
  },
```

with:

```ts
  toast: {
    userBanned: '帳號已停權',
    userUnbanned: '已解除停權',
    featuresSaved: '功能開通已儲存',
    gameTerminated: '對局已強制終止',
    gameDeleted: '對局已刪除',
    roomClosed: '房間已關閉',
    roomDeleted: '房間已刪除',
    maintainerSaved: '維護者權限已儲存',
    maintainerRevoked: '維護者權限已撤銷',
    purgeRun: '清理已完成',
  },
```

en, replace:

```ts
  toast: {
    userBanned: 'Account disabled',
    userUnbanned: 'Account re-enabled',
    featuresSaved: 'Feature access saved',
    gameTerminated: 'Game force-terminated',
    roomClosed: 'Room closed',
    maintainerSaved: 'Maintainer access saved',
    maintainerRevoked: 'Maintainer access revoked',
  },
```

with:

```ts
  toast: {
    userBanned: 'Account disabled',
    userUnbanned: 'Account re-enabled',
    featuresSaved: 'Feature access saved',
    gameTerminated: 'Game force-terminated',
    gameDeleted: 'Game deleted',
    roomClosed: 'Room closed',
    roomDeleted: 'Room deleted',
    maintainerSaved: 'Maintainer access saved',
    maintainerRevoked: 'Maintainer access revoked',
    purgeRun: 'Purge completed',
  },
```

**2c. `games.delete*`** — zhHant, replace:

```ts
    terminatedBy: '終止執行者',
    terminatedReason: '終止原因',
    bot: '電腦',
    you: '',
  },
```

with:

```ts
    terminatedBy: '終止執行者',
    terminatedReason: '終止原因',
    bot: '電腦',
    you: '',
    delete: '刪除對局',
    deleteConfirmTitle: '刪除此對局?',
    deleteConfirmBody: '此操作無法復原,對局紀錄將永久刪除。',
    deleteConfirmBodyLive: '此對局仍在進行中,將先強制終止(不會留下成績,無法重播),再永久刪除對局紀錄。此操作無法復原。',
  },
```

en, replace:

```ts
    terminatedBy: 'Terminated by',
    terminatedReason: 'Reason',
    bot: 'bot',
    you: '',
  },
```

with:

```ts
    terminatedBy: 'Terminated by',
    terminatedReason: 'Reason',
    bot: 'bot',
    you: '',
    delete: 'Delete game',
    deleteConfirmTitle: 'Delete this game?',
    deleteConfirmBody: 'This cannot be undone — the game record is permanently deleted.',
    deleteConfirmBodyLive:
      'This game is still in progress. It will be force-terminated first (no scores, never ' +
      'replayable), then the game record is permanently deleted. This cannot be undone.',
  },
```

**2d. `rooms.delete*`** — zhHant, replace:

```ts
    close: '關閉房間',
    closeConfirmTitle: '關閉此房間?',
    closeConfirmBody: '等候中的成員將無法開始遊戲。此操作無法復原。',
    startedHint: '進行中的房間請改為終止其對局',
  },
```

with:

```ts
    close: '關閉房間',
    closeConfirmTitle: '關閉此房間?',
    closeConfirmBody: '等候中的成員將無法開始遊戲。此操作無法復原。',
    startedHint: '進行中的房間請改為終止其對局',
    delete: '刪除房間',
    deleteConfirmTitle: '刪除此房間?',
    deleteConfirmBody: '此操作無法復原,房間紀錄將永久刪除。',
    deleteConfirmBodyStarted:
      '此房間仍有進行中的對局,將先強制終止該對局(不會留下成績),再永久刪除房間紀錄。此操作無法復原。',
  },
```

en, replace:

```ts
    close: 'Close room',
    closeConfirmTitle: 'Close this room?',
    closeConfirmBody: 'Waiting members will not be able to start. This cannot be undone.',
    startedHint: 'A started room follows its game — terminate the game instead',
  },
```

with:

```ts
    close: 'Close room',
    closeConfirmTitle: 'Close this room?',
    closeConfirmBody: 'Waiting members will not be able to start. This cannot be undone.',
    startedHint: 'A started room follows its game — terminate the game instead',
    delete: 'Delete room',
    deleteConfirmTitle: 'Delete this room?',
    deleteConfirmBody: 'This cannot be undone — the room record is permanently deleted.',
    deleteConfirmBodyStarted:
      'This room still has a game in progress. It will be force-terminated first (no scores, ' +
      'not replayable), then the room record is permanently deleted. This cannot be undone.',
  },
```

**2e. `audit.action` additions** — zhHant, replace:

```ts
    action: {
      'bootstrap.grant': '系統授權擁有者',
      'user.ban': '停權使用者',
      'user.unban': '解除停權',
      'user.features': '調整功能開通',
      'game.terminate': '終止對局',
      'room.close': '關閉房間',
      'maintainer.grant': '授權維護者',
      'maintainer.update': '更新維護者',
      'maintainer.revoke': '撤銷維護者',
    },
```

with:

```ts
    action: {
      'bootstrap.grant': '系統授權擁有者',
      'user.ban': '停權使用者',
      'user.unban': '解除停權',
      'user.features': '調整功能開通',
      'game.terminate': '終止對局',
      'game.delete': '刪除對局',
      'room.close': '關閉房間',
      'room.delete': '刪除房間',
      'purge.run': '執行閒置清理',
      'maintainer.grant': '授權維護者',
      'maintainer.update': '更新維護者',
      'maintainer.revoke': '撤銷維護者',
    },
```

en, replace:

```ts
    action: {
      'bootstrap.grant': 'System granted owner',
      'user.ban': 'Disabled user',
      'user.unban': 'Re-enabled user',
      'user.features': 'Changed feature access',
      'game.terminate': 'Terminated game',
      'room.close': 'Closed room',
      'maintainer.grant': 'Granted maintainer',
      'maintainer.update': 'Updated maintainer',
      'maintainer.revoke': 'Revoked maintainer',
    },
```

with:

```ts
    action: {
      'bootstrap.grant': 'System granted owner',
      'user.ban': 'Disabled user',
      'user.unban': 'Re-enabled user',
      'user.features': 'Changed feature access',
      'game.terminate': 'Terminated game',
      'game.delete': 'Deleted game',
      'room.close': 'Closed room',
      'room.delete': 'Deleted room',
      'purge.run': 'Ran purge',
      'maintainer.grant': 'Granted maintainer',
      'maintainer.update': 'Updated maintainer',
      'maintainer.revoke': 'Revoked maintainer',
    },
```

**2f. `perm` additions** — zhHant, replace:

```ts
  perm: {
    'overview.read': '檢視總覽',
    'users.read': '檢視使用者',
    'users.ban': '停權使用者',
    'users.features': '管理功能開通',
    'games.read': '檢視對局',
    'games.readLog': '檢視對局紀錄',
    'games.terminate': '終止對局',
    'rooms.read': '檢視房間',
    'rooms.close': '關閉房間',
    'maintainers.read': '檢視維護者',
    'maintainers.write': '管理維護者',
    'audit.read': '檢視稽核紀錄',
  },
};
```

with:

```ts
  perm: {
    'overview.read': '檢視總覽',
    'users.read': '檢視使用者',
    'users.ban': '停權使用者',
    'users.features': '管理功能開通',
    'games.read': '檢視對局',
    'games.readLog': '檢視對局紀錄',
    'games.terminate': '終止對局',
    'games.delete': '刪除對局',
    'rooms.read': '檢視房間',
    'rooms.close': '關閉房間',
    'rooms.delete': '刪除房間',
    'maintainers.read': '檢視維護者',
    'maintainers.write': '管理維護者',
    'audit.read': '檢視稽核紀錄',
    'purge.read': '檢視清理狀態',
    'purge.run': '執行閒置清理',
  },
  purge: {
    title: '閒置清理',
    autoEnabled: '自動清理',
    on: '已啟用',
    off: '未啟用',
    interval: '自動清理週期(分鐘)',
    roomLobbyHours: '等候房間閒置門檻(小時)',
    gameLiveHours: '進行中對局閒置門檻(小時)',
    runNow: '立即執行清理',
    runConfirmTitle: '立即執行閒置清理?',
    runConfirmBody:
      '將清除所有已超過閒置門檻的等候房間與進行中對局(進行中對局會先強制終止)。此操作無法復原。',
    colTime: '時間',
    colActor: '執行者',
    colRooms: '房間',
    colGames: '對局',
    colCapped: '達上限',
    cappedYes: '是',
  },
};
```

en, replace:

```ts
  perm: {
    'overview.read': 'View overview',
    'users.read': 'View users',
    'users.ban': 'Ban users',
    'users.features': 'Manage feature access',
    'games.read': 'View games',
    'games.readLog': 'View game logs',
    'games.terminate': 'Terminate games',
    'rooms.read': 'View rooms',
    'rooms.close': 'Close rooms',
    'maintainers.read': 'View maintainers',
    'maintainers.write': 'Manage maintainers',
    'audit.read': 'View audit log',
  },
};
```

with:

```ts
  perm: {
    'overview.read': 'View overview',
    'users.read': 'View users',
    'users.ban': 'Ban users',
    'users.features': 'Manage feature access',
    'games.read': 'View games',
    'games.readLog': 'View game logs',
    'games.terminate': 'Terminate games',
    'games.delete': 'Delete games',
    'rooms.read': 'View rooms',
    'rooms.close': 'Close rooms',
    'rooms.delete': 'Delete rooms',
    'maintainers.read': 'View maintainers',
    'maintainers.write': 'Manage maintainers',
    'audit.read': 'View audit log',
    'purge.read': 'View purge status',
    'purge.run': 'Run purge',
  },
  purge: {
    title: 'Inactive session purge',
    autoEnabled: 'Automatic purge',
    on: 'Enabled',
    off: 'Disabled',
    interval: 'Auto-purge interval (minutes)',
    roomLobbyHours: 'Lobby room idle threshold (hours)',
    gameLiveHours: 'Live game idle threshold (hours)',
    runNow: 'Run purge now',
    runConfirmTitle: 'Run the inactive-session purge now?',
    runConfirmBody:
      'This deletes every lobby room and live game past its idle threshold (live games are ' +
      'force-terminated first). This cannot be undone.',
    colTime: 'Time',
    colActor: 'Actor',
    colRooms: 'Rooms',
    colGames: 'Games',
    colCapped: 'Capped',
    cappedYes: 'Yes',
  },
};
```

- [ ] **Step 3: Typecheck and run the existing admin suite**

Run: `yarn typecheck`
Expected: PASS — this is the real check for i18n key-tree parity between `zhHant` and `en`.

Run: `yarn workspace @trm/admin test`
Expected: PASS (no existing test depends on these files' old shape in a way that would break).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/i18n/index.ts
git commit -m "feat(admin): add REST client + i18n strings for room/game delete and purge"
```

---

### Task 6: RoomsView delete button

**Files:**

- Modify: `apps/admin/src/views/RoomsView.tsx`
- Modify: `apps/admin/src/views/RoomsView.test.tsx`

**Interfaces:**

- Consumes: `api.deleteRoom(code, reason?)` (Task 5), `useSession((s) =>
s.hasPermission('rooms.delete'))`, existing `ConfirmDialog`/`useToast` components.

- [ ] **Step 1: Write the failing tests**

In `apps/admin/src/views/RoomsView.test.tsx`, replace the `stubFetch` helper (so a `204` response
doesn't throw when the `Response` constructor is given a body):

```ts
function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.entries(routes).find(([path]) => url.includes(path));
      const route = hit?.[1] ?? { status: 404, body: { message: 'not found' } };
      return new Response(JSON.stringify(route.body), { status: route.status });
    }),
  );
}
```

with:

```ts
function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.entries(routes).find(([path]) => url.includes(path));
      const route = hit?.[1] ?? { status: 404, body: { message: 'not found' } };
      // A 204 response must not carry a body, or the Response constructor throws.
      const body = route.status === 204 ? null : JSON.stringify(route.body);
      return new Response(body, { status: route.status });
    }),
  );
}
```

Append this `describe` block at the end of the file:

```ts

describe('RoomsView delete toasts', () => {
  beforeEach(() => {
    useToast.getState().reset();
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['rooms.read', 'rooms.close', 'rooms.delete']),
    });
  });

  it('shows a success toast after deleting a room and removes its row', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD': { status: 204, body: {} },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除房間'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除房間' }));
    expect(await screen.findByText('房間已刪除')).toBeInTheDocument();
    expect(screen.queryByText('ABCD')).not.toBeInTheDocument();
  });

  it('shows an error toast when deleting fails and keeps the row', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD': { status: 500, body: { message: 'boom' } },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除房間'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除房間' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.getByText('ABCD')).toBeInTheDocument();
  });

  it('shows the STARTED-specific confirm body when deleting a started room', async () => {
    const startedRow = { ...ROOM_ROW, status: 'STARTED' };
    stubFetch({
      '/dashboard/rooms/ABCD': { status: 204, body: {} },
      '/dashboard/rooms?': { status: 200, body: { rooms: [startedRow], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除房間'));
    expect(
      await screen.findByText('此房間仍有進行中的對局,將先強制終止該對局(不會留下成績),再永久刪除房間紀錄。此操作無法復原。'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/admin test RoomsView`
Expected: FAIL — `screen.findByText('刪除房間')` (the trigger button) times out; no delete button
exists yet.

- [ ] **Step 3: Add the delete button + confirm dialog**

In `apps/admin/src/views/RoomsView.tsx`, replace the top of the component:

```tsx
export function RoomsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canClose = useSession((s) => s.hasPermission('rooms.close'));
  const pushToast = useToast((s) => s.push);

  const [rows, setRows] = useState<RoomRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
```

with:

```tsx
export function RoomsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canClose = useSession((s) => s.hasPermission('rooms.close'));
  const canDelete = useSession((s) => s.hasPermission('rooms.delete'));
  const pushToast = useToast((s) => s.push);

  const [rows, setRows] = useState<RoomRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
```

Replace the `close` function block (add a `del` function right after it):

```tsx
const close = async (code: string, reason?: string) => {
  setBusy(true);
  try {
    const updated = await api.closeRoom(code, reason);
    setRows((prev) => prev.map((r) => (r.code === code ? updated : r)));
    pushToast('success', t('toast.roomClosed'));
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  } finally {
    setBusy(false);
    setClosing(null);
  }
};
```

with:

```tsx
const close = async (code: string, reason?: string) => {
  setBusy(true);
  try {
    const updated = await api.closeRoom(code, reason);
    setRows((prev) => prev.map((r) => (r.code === code ? updated : r)));
    pushToast('success', t('toast.roomClosed'));
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  } finally {
    setBusy(false);
    setClosing(null);
  }
};

const del = async (code: string, reason?: string) => {
  setBusy(true);
  try {
    await api.deleteRoom(code, reason);
    setRows((prev) => prev.filter((r) => r.code !== code));
    pushToast('success', t('toast.roomDeleted'));
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  } finally {
    setBusy(false);
    setDeleting(null);
  }
};
```

Replace the table header's action column:

```tsx
<th className="num">{t('rooms.colUpdated')}</th>;
{
  canClose && <th />;
}
```

with:

```tsx
<th className="num">{t('rooms.colUpdated')}</th>;
{
  (canClose || canDelete) && <th />;
}
```

Replace the row's action cell:

```tsx
<td className="num">{fmtDateTime(r.updatedAt, locale)}</td>;
{
  canClose && (
    <td>
      {r.status === 'LOBBY' && (
        <button className="oc-btn danger" onClick={() => setClosing(r.code)}>
          {t('rooms.close')}
        </button>
      )}
      {r.status === 'STARTED' && (
        <span className="oc-muted" style={{ fontSize: 11 }}>
          {t('rooms.startedHint')}
        </span>
      )}
    </td>
  );
}
```

with:

```tsx
<td className="num">{fmtDateTime(r.updatedAt, locale)}</td>;
{
  (canClose || canDelete) && (
    <td>
      {canClose && r.status === 'LOBBY' && (
        <button className="oc-btn danger" onClick={() => setClosing(r.code)}>
          {t('rooms.close')}
        </button>
      )}
      {canClose && r.status === 'STARTED' && (
        <span className="oc-muted" style={{ fontSize: 11 }}>
          {t('rooms.startedHint')}
        </span>
      )}
      {canDelete && (
        <button
          className="oc-btn danger"
          style={{ marginLeft: 6 }}
          onClick={() => setDeleting(r.code)}
        >
          {t('rooms.delete')}
        </button>
      )}
    </td>
  );
}
```

Replace the final `ConfirmDialog` block (add a second dialog for delete right after it, before
the closing `</div>`):

```tsx
      {closing && (
        <ConfirmDialog
          title={t('rooms.closeConfirmTitle')}
          body={t('rooms.closeConfirmBody')}
          confirmLabel={t('rooms.close')}
          danger
          withReason
          busy={busy}
          onConfirm={(reason) => void close(closing, reason)}
          onCancel={() => setClosing(null)}
        />
      )}
    </div>
  );
}
```

with:

```tsx
      {closing && (
        <ConfirmDialog
          title={t('rooms.closeConfirmTitle')}
          body={t('rooms.closeConfirmBody')}
          confirmLabel={t('rooms.close')}
          danger
          withReason
          busy={busy}
          onConfirm={(reason) => void close(closing, reason)}
          onCancel={() => setClosing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('rooms.deleteConfirmTitle')}
          body={
            rows.find((r) => r.code === deleting)?.status === 'STARTED'
              ? t('rooms.deleteConfirmBodyStarted')
              : t('rooms.deleteConfirmBody')
          }
          confirmLabel={t('rooms.delete')}
          danger
          withReason
          busy={busy}
          onConfirm={(reason) => void del(deleting, reason)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/admin test RoomsView`
Expected: PASS (existing close-toast tests + the 3 new delete tests).

- [ ] **Step 5: Typecheck and lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/views/RoomsView.tsx apps/admin/src/views/RoomsView.test.tsx
git commit -m "feat(admin): add room delete button to RoomsView"
```

---

### Task 7: GamesView (GameDrawer) delete button

**Files:**

- Modify: `apps/admin/src/views/GamesView.tsx`
- Modify: `apps/admin/src/views/GamesView.test.tsx`

**Interfaces:**

- Consumes: `api.deleteGame(id, reason?)` (Task 5), `useSession((s) =>
s.hasPermission('games.delete'))`.

- [ ] **Step 1: Write the failing tests**

In `apps/admin/src/views/GamesView.test.tsx`, replace the `stubFetch` helper (204-safe, same fix
as Task 6):

```ts
function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.entries(routes).find(([path]) => url.includes(path));
      const route = hit?.[1] ?? { status: 404, body: { message: 'not found' } };
      return new Response(JSON.stringify(route.body), { status: route.status });
    }),
  );
}
```

with:

```ts
function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.entries(routes).find(([path]) => url.includes(path));
      const route = hit?.[1] ?? { status: 404, body: { message: 'not found' } };
      // A 204 response must not carry a body, or the Response constructor throws.
      const body = route.status === 204 ? null : JSON.stringify(route.body);
      return new Response(body, { status: route.status });
    }),
  );
}
```

Append this `describe` block at the end of the file:

```ts

// GET /dashboard/games/g1 (detail) and DELETE /dashboard/games/g1 (this task's new route)
// hit the IDENTICAL path — REST convention, no /verb suffix like /terminate has — and
// stubFetch() only matches by URL substring, blind to HTTP method. So the two tests that
// actually invoke delete use a bespoke sequenced mock (1st hit to that path = the detail
// GET, 2nd = the delete) instead of the shared stubFetch. The third test never clicks
// confirm (no delete call fires), so it can use stubFetch as normal.
describe('GamesView delete toasts', () => {
  beforeEach(() => {
    useToast.getState().reset();
    useUi.setState({ view: 'games', param: 'g1' });
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['games.read', 'games.delete']),
    });
  });

  it('shows a success toast and closes the drawer after deleting a game', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard/games?')) {
          return new Response(JSON.stringify({ games: [], nextCursor: null }), { status: 200 });
        }
        if (url.includes('/dashboard/games/g1')) {
          call += 1;
          if (call === 1) return new Response(JSON.stringify(GAME_DETAIL), { status: 200 });
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
      }),
    );
    render(
      <>
        <GamesView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除對局'));
    const dialog = await screen.findByRole('dialog', { name: '刪除此對局?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除對局' }));
    expect(await screen.findByText('對局已刪除')).toBeInTheDocument();
  });

  it('shows an error toast when deleting fails', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/dashboard/games?')) {
          return new Response(JSON.stringify({ games: [], nextCursor: null }), { status: 200 });
        }
        if (url.includes('/dashboard/games/g1')) {
          call += 1;
          if (call === 1) return new Response(JSON.stringify(GAME_DETAIL), { status: 200 });
          return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
        }
        return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
      }),
    );
    render(
      <>
        <GamesView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('刪除對局'));
    const dialog = await screen.findByRole('dialog', { name: '刪除此對局?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除對局' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('shows the LIVE-specific confirm body when deleting a live game', async () => {
    stubFetch({
      '/dashboard/games/g1': { status: 200, body: { ...GAME_DETAIL, status: 'LIVE' } },
      '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
    });
    render(<GamesView />);
    fireEvent.click(await screen.findByText('刪除對局'));
    expect(
      await screen.findByText(
        '此對局仍在進行中,將先強制終止(不會留下成績,無法重播),再永久刪除對局紀錄。此操作無法復原。',
      ),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/admin test GamesView`
Expected: FAIL — `screen.findByText('刪除對局')` times out; no delete button exists yet.

- [ ] **Step 3: Add the delete button + confirm dialog to `GameDrawer`**

In `apps/admin/src/views/GamesView.tsx`, replace the top of `GameDrawer`:

```tsx
function GameDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canTerminate = useSession((s) => s.hasPermission('games.terminate'));
  const canReadLog = useSession((s) => s.hasPermission('games.readLog'));
  const pushToast = useToast((s) => s.push);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [log, setLog] = useState<GameLogEntry[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
```

with:

```tsx
function GameDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canTerminate = useSession((s) => s.hasPermission('games.terminate'));
  const canDelete = useSession((s) => s.hasPermission('games.delete'));
  const canReadLog = useSession((s) => s.hasPermission('games.readLog'));
  const pushToast = useToast((s) => s.push);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [log, setLog] = useState<GameLogEntry[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
```

Replace the `terminate` function block (add a `del` function right after it):

```tsx
const terminate = async (reason?: string) => {
  setBusy(true);
  try {
    setDetail(await api.terminateGame(id, reason));
    pushToast('success', t('toast.gameTerminated'));
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  } finally {
    setBusy(false);
    setConfirming(false);
  }
};
```

with:

```tsx
const terminate = async (reason?: string) => {
  setBusy(true);
  try {
    setDetail(await api.terminateGame(id, reason));
    pushToast('success', t('toast.gameTerminated'));
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  } finally {
    setBusy(false);
    setConfirming(false);
  }
};

const del = async (reason?: string) => {
  setBusy(true);
  try {
    await api.deleteGame(id, reason);
    pushToast('success', t('toast.gameDeleted'));
    onClose();
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  } finally {
    setBusy(false);
    setConfirmingDelete(false);
  }
};
```

Replace the terminate button section + its confirm dialog:

```tsx
          {canTerminate && detail.status === 'LIVE' && (
            <section>
              <button className="oc-btn danger" disabled={busy} onClick={() => setConfirming(true)}>
                {t('games.terminate')}
              </button>
            </section>
          )}

          {confirming && (
            <ConfirmDialog
              title={t('games.terminateConfirmTitle')}
              body={t('games.terminateConfirmBody')}
              confirmLabel={t('games.terminate')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void terminate(reason)}
              onCancel={() => setConfirming(false)}
            />
          )}
        </>
      )}
    </Drawer>
  );
}
```

with:

```tsx
          {canTerminate && detail.status === 'LIVE' && (
            <section>
              <button className="oc-btn danger" disabled={busy} onClick={() => setConfirming(true)}>
                {t('games.terminate')}
              </button>
            </section>
          )}

          {canDelete && (
            <section>
              <button
                className="oc-btn danger"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                {t('games.delete')}
              </button>
            </section>
          )}

          {confirming && (
            <ConfirmDialog
              title={t('games.terminateConfirmTitle')}
              body={t('games.terminateConfirmBody')}
              confirmLabel={t('games.terminate')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void terminate(reason)}
              onCancel={() => setConfirming(false)}
            />
          )}

          {confirmingDelete && (
            <ConfirmDialog
              title={t('games.deleteConfirmTitle')}
              body={
                detail.status === 'LIVE'
                  ? t('games.deleteConfirmBodyLive')
                  : t('games.deleteConfirmBody')
              }
              confirmLabel={t('games.delete')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void del(reason)}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/admin test GamesView`
Expected: PASS (existing chat/terminate tests + the 3 new delete tests).

- [ ] **Step 5: Typecheck and lint**

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/views/GamesView.tsx apps/admin/src/views/GamesView.test.tsx
git commit -m "feat(admin): add game delete button to GameDrawer"
```

---

### Task 8: PurgeView + nav wiring

**Files:**

- Create: `apps/admin/src/views/PurgeView.tsx`
- Create: `apps/admin/src/views/PurgeView.test.tsx`
- Modify: `apps/admin/src/store/ui.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/App.test.tsx`

**Interfaces:**

- Consumes: `api.getPurgeStatus()`/`api.runPurge()` (Task 5), `useSession((s) =>
s.hasPermission('purge.read'|'purge.run'))`.
- Produces: `PurgeView` component, rendered by `App.tsx`'s `ActiveView` switch for `view ===
'purge'`.

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/views/PurgeView.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../i18n';
import { PurgeView } from './PurgeView';
import { useSession } from '../store/session';
import { useToast } from '../store/toast';
import { ToastStack } from '../components/ToastStack';

interface Route {
  status: number;
  body: unknown;
}
function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.entries(routes).find(([path]) => url.includes(path));
      const route = hit?.[1] ?? { status: 404, body: { message: 'not found' } };
      const body = route.status === 204 ? null : JSON.stringify(route.body);
      return new Response(body, { status: route.status });
    }),
  );
}

const STATUS = {
  autoEnabled: false,
  intervalMs: 3_600_000,
  roomLobbyPurgeHours: 24,
  gameLivePurgeHours: 168,
  recentRuns: [
    {
      at: '2026-01-01T00:00:00.000Z',
      actorName: 'Admin',
      roomsDeleted: 3,
      gamesDeleted: 1,
      capped: false,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
  useSession.setState({
    phase: 'ready',
    user: { id: 'u1', displayName: 'Ops', isGuest: false },
    role: 'admin',
    permissions: new Set(['purge.read', 'purge.run']),
  });
  stubFetch({ '/dashboard/purge/status': { status: 200, body: STATUS } });
});

describe('PurgeView', () => {
  it('renders config and recent runs', async () => {
    render(<PurgeView />);
    expect(await screen.findByText('未啟用')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('168')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('requires confirmation before running, then shows a success toast with fresh counts', async () => {
    render(
      <>
        <PurgeView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('立即執行清理'));
    const dialog = await screen.findByRole('dialog');
    stubFetch({
      '/dashboard/purge/status': {
        status: 200,
        body: { ...STATUS, recentRuns: [{ ...STATUS.recentRuns[0], roomsDeleted: 5 }] },
      },
      '/dashboard/purge/run': {
        status: 200,
        body: { roomsDeleted: 5, gamesDeleted: 2, capped: false },
      },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '立即執行清理' }));
    expect(await screen.findByText('清理已完成')).toBeInTheDocument();
    expect(await screen.findByText('5')).toBeInTheDocument();
  });

  it('shows an error toast when running fails', async () => {
    render(
      <>
        <PurgeView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('立即執行清理'));
    const dialog = await screen.findByRole('dialog');
    stubFetch({
      '/dashboard/purge/status': { status: 200, body: STATUS },
      '/dashboard/purge/run': { status: 500, body: { message: 'boom' } },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '立即執行清理' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('hides the run button without purge.run', async () => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'viewer',
      permissions: new Set(['purge.read']),
    });
    render(<PurgeView />);
    await screen.findByText('未啟用');
    expect(screen.queryByText('立即執行清理')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/admin test PurgeView`
Expected: FAIL — `Cannot find module './PurgeView'` (the component doesn't exist yet).

- [ ] **Step 3: Create `PurgeView`**

Create `apps/admin/src/views/PurgeView.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type PurgeStatus } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../store/toast';
import { fmtDateTime } from '../lib/fmt';

export function PurgeView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canRun = useSession((s) => s.hasPermission('purge.run'));
  const pushToast = useToast((s) => s.push);

  const [status, setStatus] = useState<PurgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.getPurgeStatus());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    try {
      await api.runPurge();
      pushToast('success', t('toast.purgeRun'));
      await load();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (loading || !status) {
    return (
      <div>
        <h1 className="oc-page-title">{t('purge.title')}</h1>
        <div className="oc-empty">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="oc-page-title">{t('purge.title')}</h1>

      <section>
        <div className="oc-kv">
          <span className="k">{t('purge.autoEnabled')}</span>
          <span className="v">{status.autoEnabled ? t('purge.on') : t('purge.off')}</span>
        </div>
        <div className="oc-kv">
          <span className="k">{t('purge.interval')}</span>
          <span className="v">{Math.round(status.intervalMs / 60_000)}</span>
        </div>
        <div className="oc-kv">
          <span className="k">{t('purge.roomLobbyHours')}</span>
          <span className="v">{status.roomLobbyPurgeHours}</span>
        </div>
        <div className="oc-kv">
          <span className="k">{t('purge.gameLiveHours')}</span>
          <span className="v">{status.gameLivePurgeHours}</span>
        </div>
      </section>

      {canRun && (
        <div className="oc-toolbar">
          <button className="oc-btn danger" disabled={busy} onClick={() => setConfirming(true)}>
            {t('purge.runNow')}
          </button>
        </div>
      )}

      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('purge.colTime')}</th>
              <th>{t('purge.colActor')}</th>
              <th className="num">{t('purge.colRooms')}</th>
              <th className="num">{t('purge.colGames')}</th>
              <th>{t('purge.colCapped')}</th>
            </tr>
          </thead>
          <tbody>
            {status.recentRuns.map((r, i) => (
              <tr key={i}>
                <td className="num">{fmtDateTime(r.at, locale)}</td>
                <td>{r.actorName}</td>
                <td className="num">{r.roomsDeleted}</td>
                <td className="num">{r.gamesDeleted}</td>
                <td>{r.capped ? t('purge.cappedYes') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {status.recentRuns.length === 0 && <div className="oc-empty">{t('common.empty')}</div>}
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('purge.runConfirmTitle')}
          body={t('purge.runConfirmBody')}
          confirmLabel={t('purge.runNow')}
          danger
          busy={busy}
          onConfirm={() => void run()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the `purge` nav item**

In `apps/admin/src/store/ui.ts`, replace:

```ts
export type AdminView =
  | 'overview'
  | 'users'
  | 'features'
  | 'games'
  | 'rooms'
  | 'maintainers'
  | 'audit';
```

with:

```ts
export type AdminView =
  | 'overview'
  | 'users'
  | 'features'
  | 'games'
  | 'rooms'
  | 'maintainers'
  | 'audit'
  | 'purge';
```

and replace:

```ts
const m = /^\/(users|features|games|rooms|maintainers|audit)(?:\/([^/]+))?\/?$/.exec(p);
```

with:

```ts
const m = /^\/(users|features|games|rooms|maintainers|audit|purge)(?:\/([^/]+))?\/?$/.exec(p);
```

In `apps/admin/src/App.tsx`, replace the icon import:

```tsx
import {
  Activity,
  ClipboardList,
  DoorOpen,
  Languages,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  Swords,
  ToggleRight,
  TrainFront,
  Users,
} from 'lucide-react';
```

with:

```tsx
import {
  Activity,
  ClipboardList,
  DoorOpen,
  Languages,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  Swords,
  ToggleRight,
  TrainFront,
  Trash2,
  Users,
} from 'lucide-react';
```

Replace the view imports:

```tsx
import { AuditView } from './views/AuditView';
import { ToastStack } from './components/ToastStack';
```

with:

```tsx
import { AuditView } from './views/AuditView';
import { PurgeView } from './views/PurgeView';
import { ToastStack } from './components/ToastStack';
```

Replace the `NAV` array:

```tsx
const NAV: { view: AdminView; permission: DashboardPermission; icon: typeof Users }[] = [
  { view: 'overview', permission: 'overview.read', icon: Activity },
  { view: 'users', permission: 'users.read', icon: Users },
  { view: 'features', permission: 'users.features', icon: ToggleRight },
  { view: 'games', permission: 'games.read', icon: Swords },
  { view: 'rooms', permission: 'rooms.read', icon: DoorOpen },
  { view: 'maintainers', permission: 'maintainers.read', icon: ShieldCheck },
  { view: 'audit', permission: 'audit.read', icon: ClipboardList },
];
```

with:

```tsx
const NAV: { view: AdminView; permission: DashboardPermission; icon: typeof Users }[] = [
  { view: 'overview', permission: 'overview.read', icon: Activity },
  { view: 'users', permission: 'users.read', icon: Users },
  { view: 'features', permission: 'users.features', icon: ToggleRight },
  { view: 'games', permission: 'games.read', icon: Swords },
  { view: 'rooms', permission: 'rooms.read', icon: DoorOpen },
  { view: 'maintainers', permission: 'maintainers.read', icon: ShieldCheck },
  { view: 'audit', permission: 'audit.read', icon: ClipboardList },
  { view: 'purge', permission: 'purge.read', icon: Trash2 },
];
```

Replace the `ActiveView` switch:

```tsx
function ActiveView({ view }: { view: AdminView }) {
  switch (view) {
    case 'users':
      return <UsersView />;
    case 'features':
      return <FeaturesView />;
    case 'games':
      return <GamesView />;
    case 'rooms':
      return <RoomsView />;
    case 'maintainers':
      return <MaintainersView />;
    case 'audit':
      return <AuditView />;
    default:
      return <OverviewView />;
  }
}
```

with:

```tsx
function ActiveView({ view }: { view: AdminView }) {
  switch (view) {
    case 'users':
      return <UsersView />;
    case 'features':
      return <FeaturesView />;
    case 'games':
      return <GamesView />;
    case 'rooms':
      return <RoomsView />;
    case 'maintainers':
      return <MaintainersView />;
    case 'audit':
      return <AuditView />;
    case 'purge':
      return <PurgeView />;
    default:
      return <OverviewView />;
  }
}
```

- [ ] **Step 5: Update `App.test.tsx`'s permission-gated shell tests**

In `apps/admin/src/App.test.tsx`, replace the viewer assertions:

```tsx
it('a viewer sees only the sections their permissions allow', async () => {
  primeSession(['overview.read', 'users.read', 'games.read', 'rooms.read']);
  render(<App />);
  expect(await screen.findByText('使用者')).toBeInTheDocument(); // nav item
  expect(screen.getByText('對局')).toBeInTheDocument();
  expect(screen.getByText('房間')).toBeInTheDocument();
  expect(screen.queryByText('維護者')).not.toBeInTheDocument();
  expect(screen.queryByText('稽核')).not.toBeInTheDocument();
});
```

with:

```tsx
it('a viewer sees only the sections their permissions allow', async () => {
  primeSession(['overview.read', 'users.read', 'games.read', 'rooms.read']);
  render(<App />);
  expect(await screen.findByText('使用者')).toBeInTheDocument(); // nav item
  expect(screen.getByText('對局')).toBeInTheDocument();
  expect(screen.getByText('房間')).toBeInTheDocument();
  expect(screen.queryByText('維護者')).not.toBeInTheDocument();
  expect(screen.queryByText('稽核')).not.toBeInTheDocument();
  expect(screen.queryByText('清理')).not.toBeInTheDocument();
});
```

and replace the owner assertions:

```tsx
it('an owner sees every section', async () => {
  primeSession(
    [
      'overview.read',
      'users.read',
      'users.ban',
      'games.read',
      'games.readLog',
      'games.terminate',
      'rooms.read',
      'rooms.close',
      'maintainers.read',
      'maintainers.write',
      'audit.read',
    ],
    'owner',
  );
  render(<App />);
  expect(await screen.findByText('維護者')).toBeInTheDocument();
  expect(screen.getByText('稽核')).toBeInTheDocument();
});
```

with:

```tsx
it('an owner sees every section', async () => {
  primeSession(
    [
      'overview.read',
      'users.read',
      'users.ban',
      'games.read',
      'games.readLog',
      'games.terminate',
      'games.delete',
      'rooms.read',
      'rooms.close',
      'rooms.delete',
      'maintainers.read',
      'maintainers.write',
      'audit.read',
      'purge.read',
      'purge.run',
    ],
    'owner',
  );
  render(<App />);
  expect(await screen.findByText('維護者')).toBeInTheDocument();
  expect(screen.getByText('稽核')).toBeInTheDocument();
  expect(screen.getByText('清理')).toBeInTheDocument();
});
```

- [ ] **Step 6: Run all the new/modified tests to verify they pass**

Run: `yarn workspace @trm/admin test PurgeView`
Expected: PASS (4 tests).

Run: `yarn workspace @trm/admin test App`
Expected: PASS (including the updated viewer/owner assertions).

- [ ] **Step 7: Full admin suite, typecheck, lint**

Run: `yarn workspace @trm/admin test`
Expected: PASS (no regressions).

Run: `yarn typecheck && yarn lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/views/PurgeView.tsx apps/admin/src/views/PurgeView.test.tsx apps/admin/src/store/ui.ts apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git commit -m "feat(admin): add Purge view with status, run-now, and recent runs"
```

---

## After all 8 tasks

Run the full validation gate once more from repo root:

```bash
yarn build && yarn typecheck && yarn lint && yarn test
```

Expected: PASS. At this point: rooms/games have admin-tier delete buttons (terminate/close first
if active, always confirmed), a background sweep exists (off by default via
`PURGE_AUTO_ENABLED=1`) alongside an on-demand "Run purge now" in a new Purge admin view, and
`trm_rooms_purged_total`/`trm_games_purged_total` track both triggers by prior status.
