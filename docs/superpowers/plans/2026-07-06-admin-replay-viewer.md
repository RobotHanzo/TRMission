# Admin Replay Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a maintainer watch the interactive replay of any COMPLETED or TERMINATED game from the admin panel, gated by a new `games.viewReplay` permission (default: viewer role) distinct from the existing `games.readLog`.

**Architecture:** A short-lived signed ticket (same pattern as the existing ws-game ticket) hands off from `apps/admin`'s dashboard session to a new ticket-authorized route in `apps/web`, which reuses the existing `ReplayScreen`/`GameStage`/`useReplayPlayer` machinery. Server-side, a new `HistoryRepo.loadReplayForAdmin` builds the payload directly from `GameDoc`/`gameEvents` (not `matchHistory`, which doesn't exist for TERMINATED games), reached through a new ticket-verifying guard.

**Tech Stack:** NestJS + `@nestjs/jwt` on the server; React + Zustand on `apps/web`/`apps/admin`; Vitest + Supertest (server e2e), Vitest + @testing-library/react (frontend).

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-05-admin-maps-replay-versions-design.md` (Feature 2).
- The player-facing `/history/:gameId/replay` endpoint, its `replayReview` feature gate, and `HistoryRepo.loadReplay`'s COMPLETED-only hard gate are **never** modified — the new admin path is fully additive.
- A TERMINATED game has no `matchHistory` doc and no `GAME_OVER` in its action log — the admin payload must be built from `GameDoc`/`gameEvents` directly, with `winners`/`completedAt` present only when a `matchHistory` doc exists (COMPLETED) and `terminatedAt`/`terminatedBy` present only when the game was terminated. Never both.
- Server tests are e2e-only (`apps/server/test/*.e2e.spec.ts`).
- The cross-app link (`window.location.origin + '/admin-replay/...'`) only resolves correctly in the production nginx deployment where `apps/web` and `apps/admin` are same-origin — this is a known, accepted limitation for local dev (see spec).
- `yarn workspace @trm/server test`, `yarn workspace @trm/web test`, `yarn workspace @trm/admin test`, `yarn lint`, `yarn typecheck` must pass before every commit.
- **Shared files across sibling plans:** `packages/shared/src/dashboard.ts`, `apps/server/src/dashboard/audit.repo.ts`, `apps/server/src/config/env.ts`, `apps/admin/src/net/rest.ts`, and `apps/admin/src/i18n/index.ts` are also touched by the custom-maps and commit-hash plans. Fine to run sequentially in one working tree; if run in parallel isolated worktrees, expect a merge/rebase step on these files afterward.

---

### Task 1: `games.viewReplay` permission

**Files:**

- Modify: `packages/shared/src/dashboard.ts`
- Test: `packages/shared/test/dashboard.spec.ts`

**Interfaces:**

- Produces: `DASHBOARD_PERMISSIONS` includes `'games.viewReplay'`; `ROLE_PERMISSIONS.viewer` includes it.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/test/dashboard.spec.ts`:

```ts
it('games.viewReplay is a viewer permission, independent of games.readLog', () => {
  expect(ROLE_PERMISSIONS.viewer).toContain('games.viewReplay');
  expect(ROLE_PERMISSIONS.viewer).not.toContain('games.readLog');
  expect(ROLE_PERMISSIONS.moderator).toContain('games.readLog');
  expect(ROLE_PERMISSIONS.moderator).toContain('games.viewReplay');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: FAIL — `'games.viewReplay'` is not a member of `ROLE_PERMISSIONS.viewer`.

- [ ] **Step 3: Add the permission**

In `packages/shared/src/dashboard.ts`:

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
  'games.viewReplay',
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

```ts
const VIEWER_PERMISSIONS: readonly DashboardPermission[] = [
  'overview.read',
  'users.read',
  'games.read',
  'rooms.read',
  'games.viewReplay',
];
```

(If Task 1 of the custom-maps plan already landed first, this file also has `'maps.read'` in both arrays — add `games.viewReplay` alongside it without disturbing that entry.)

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dashboard.ts packages/shared/test/dashboard.spec.ts
git commit -m "feat(shared): add games.viewReplay dashboard permission"
```

---

### Task 2: Ticket minting — `POST /dashboard/games/:gameId/replay-ticket`

**Files:**

- Modify: `apps/server/src/config/env.ts`
- Modify: `apps/server/src/auth/auth.types.ts`
- Modify: `apps/server/src/auth/token.service.ts`
- Modify: `apps/server/src/dashboard/audit.repo.ts`
- Modify: `apps/server/src/dashboard/dashboard-games.service.ts`
- Modify: `apps/server/src/dashboard/dashboard-games.controller.ts`
- Create: `apps/server/test/admin-replay.e2e.spec.ts`

**Interfaces:**

- Produces: `TokenService.signAdminReplayTicket({gameId, actorId}): string`, `TokenService.verifyAdminReplayTicket(token): AdminReplayTicketPayload | null`, `DashboardGamesService.mintReplayTicket(actor, gameId): Promise<{ticket: string; expiresIn: string}>`.
- Consumes: `env.adminReplayTicketTtl` (new), `AuditService.log`.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/admin-replay.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { taiwanBoard } from '@trm/engine';
import type { Board } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { actionToCommand, encodeClient, pickAction } from './helpers';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { token: res.body.accessToken, id: res.body.user.id as string };
}
async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id as string };
}
async function grantDashboard(userId: string, role: 'viewer' | 'moderator' | 'admin') {
  await t.db.collection('dashboardAccounts').insertOne({
    _id: userId,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

let viewer: { token: string; id: string };
let noPerm: { token: string; id: string };
let board: Board;
let completedGameId: string;
let terminatedGameId: string;

beforeAll(async () => {
  t = await createTestApp();
  board = taiwanBoard();
  viewer = await registered('viewer@example.com', 'Viewer');
  await grantDashboard(viewer.id, 'viewer');
  noPerm = await registered('noperm@example.com', 'NoPerm');

  // A fully COMPLETED game, driven to GAME_OVER through the hub like history-replay.e2e.spec.ts.
  const host = await guest('Host');
  const member = await guest('Member');
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
  completedGameId = started.body.gameId;
  const memberTicket: string = (
    await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(member.token)).expect(200)
  ).body.ticket;

  const hub = t.app.get(GameHub);
  const seqs = new Map<string, number>();
  const nextSeq = (id: string) => {
    const n = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, n);
    return n;
  };
  hub.openConnection('c-host', () => {});
  hub.openConnection('c-member', () => {});
  await hub.receive(
    'c-host',
    encodeClient(nextSeq(host.id), {
      case: 'hello',
      value: { ticket: started.body.ticket, protocolVersion: 1 },
    }),
  );
  await hub.receive(
    'c-member',
    encodeClient(nextSeq(member.id), {
      case: 'hello',
      value: { ticket: memberTicket, protocolVersion: 1 },
    }),
  );

  const match = t.app.get(GameRegistry).get(completedGameId);
  if (!match) throw new Error('match not registered');
  const connOf = new Map([
    [host.id, 'c-host'],
    [member.id, 'c-member'],
  ]);
  let guard = 0;
  while (match.session.phase !== 'GAME_OVER') {
    if (++guard > 50_000) throw new Error('game did not terminate');
    const state = match.session.raw();
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? [host.id, member.id].map(asPlayerId).find((p) => match.session.hasPendingOffer(p))
        : match.session.currentPlayer;
    if (!actor) throw new Error(`no actor in ${state.turn.phase}`);
    await hub.receive(
      connOf.get(actor as string)!,
      encodeClient(nextSeq(actor as string), actionToCommand(pickAction(board, state, actor))),
    );
  }
  await new Promise((r) => setTimeout(r, 50));

  // A TERMINATED game: start, play one action, then force-terminate via the dashboard.
  const admin = await registered('admin@example.com', 'Admin');
  await grantDashboard(admin.id, 'admin');
  const host2 = await guest('Host2');
  const member2 = await guest('Member2');
  const room2 = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host2.token))
    .send({})
    .expect(201);
  const code2: string = room2.body.code;
  await request(server()).post(`/api/v1/rooms/${code2}/join`).set(auth(member2.token)).expect(200);
  for (const u of [host2, member2]) {
    await request(server())
      .post(`/api/v1/rooms/${code2}/ready`)
      .set(auth(u.token))
      .send({ ready: true })
      .expect(200);
  }
  const started2 = await request(server())
    .post(`/api/v1/rooms/${code2}/start`)
    .set(auth(host2.token))
    .expect(200);
  terminatedGameId = started2.body.gameId;
  hub.openConnection('c-host2', () => {});
  await hub.receive(
    'c-host2',
    encodeClient(1, { case: 'hello', value: { ticket: started2.body.ticket, protocolVersion: 1 } }),
  );
  const match2 = t.app.get(GameRegistry).get(terminatedGameId);
  if (!match2) throw new Error('match2 not registered');
  const state2 = match2.session.raw();
  const actor2 =
    state2.turn.phase === 'SETUP_TICKETS' ? asPlayerId(host2.id) : match2.session.currentPlayer;
  await hub.receive(
    'c-host2',
    encodeClient(2, actionToCommand(pickAction(board, state2, actor2 as never))),
  );
  await request(server())
    .post(`/api/v1/dashboard/games/${terminatedGameId}/terminate`)
    .set(auth(admin.token))
    .send({ reason: 'test' })
    .expect(200);
}, 180_000);
afterAll(() => t.close());

describe('POST /dashboard/games/:gameId/replay-ticket', () => {
  it('403s without games.viewReplay', async () => {
    await request(server())
      .post(`/api/v1/dashboard/games/${completedGameId}/replay-ticket`)
      .set(auth(noPerm.token))
      .expect(403);
  });

  it('404s an unknown game', async () => {
    await request(server())
      .post('/api/v1/dashboard/games/nope/replay-ticket')
      .set(auth(viewer.token))
      .expect(404);
  });

  it('mints a ticket for a COMPLETED game (viewer permission is enough)', async () => {
    const res = await request(server())
      .post(`/api/v1/dashboard/games/${completedGameId}/replay-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    expect(typeof res.body.ticket).toBe('string');
  });

  it('mints a ticket for a TERMINATED game', async () => {
    const res = await request(server())
      .post(`/api/v1/dashboard/games/${terminatedGameId}/replay-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    expect(typeof res.body.ticket).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run admin-replay`
Expected: FAIL — the route doesn't exist yet (the beforeAll setup itself should succeed; only the `describe('POST .../replay-ticket')` assertions fail with 404s from the missing route).

- [ ] **Step 3: Add the env var**

In `apps/server/src/config/env.ts`, add near `wsTicketTtl`:

```ts
  /** Admin replay ticket lifetime — short-lived handoff from the dashboard to apps/web's
   *  ticket-authorized replay route (ADR: same pattern as the ws-game ticket). */
  adminReplayTicketTtl: process.env.ADMIN_REPLAY_TICKET_TTL ?? '5m',
```

- [ ] **Step 4: Add the ticket payload type**

In `apps/server/src/auth/auth.types.ts`, add after `WsTicketPayload`:

```ts
/** Admin-replay ticket JWT payload — a maintainer's handoff from the dashboard to
 *  apps/web's ticket-authorized replay route. Bypasses membership entirely; the ticket
 *  itself (scoped to one gameId, short-lived) is the sole authority. */
export interface AdminReplayTicketPayload {
  kind: 'admin-replay';
  gameId: string;
  actorId: string;
}
```

- [ ] **Step 5: Add sign/verify methods to `TokenService`**

In `apps/server/src/auth/token.service.ts`, add the import and two methods:

```ts
import type {
  JwtPayload,
  WsTicketPayload,
  OauthStatePayload,
  AdminReplayTicketPayload,
} from './auth.types';
```

```ts
  signAdminReplayTicket(input: { gameId: string; actorId: string }): string {
    const payload: AdminReplayTicketPayload = { kind: 'admin-replay', ...input };
    return this.jwt.sign(payload, { expiresIn: env.adminReplayTicketTtl as Ttl });
  }

  verifyAdminReplayTicket(token: string): AdminReplayTicketPayload | null {
    try {
      const payload = this.jwt.verify<AdminReplayTicketPayload>(token);
      return payload.kind === 'admin-replay' ? payload : null;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 6: Add the audit action**

In `apps/server/src/dashboard/audit.repo.ts`, add `'game.viewReplay'` to the `DashboardAuditAction` union (alongside `'game.terminate' | 'game.delete'`).

- [ ] **Step 7: Add `mintReplayTicket` to `DashboardGamesService`**

In `apps/server/src/dashboard/dashboard-games.service.ts`, add imports and the constructor param, then the method:

```ts
import { TokenService } from '../auth/token.service';
import { env } from '../config/env';
```

```ts
  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly registry: GameRegistry,
    private readonly hub: GameHub,
    private readonly rooms: RoomRepo,
    private readonly history: HistoryRepo,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.chats = db.collection<GameChatDoc>('gameChats');
  }
```

```ts
  /** Mint a short-lived ticket a maintainer hands off to apps/web's ticket-authorized
   *  replay route — works for COMPLETED and TERMINATED games (unlike the player-facing
   *  replay feature, which stays COMPLETED-only forever; see HistoryRepo.loadReplayForAdmin). */
  async mintReplayTicket(actor: AuthUser, gameId: string): Promise<{ ticket: string; expiresIn: string }> {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) throw new NotFoundException('game not found');
    if (game.status !== 'COMPLETED' && game.status !== 'TERMINATED') {
      throw new ConflictException('replay is only available for completed or terminated games');
    }
    await this.audit.log(actor, 'game.viewReplay', { type: 'game', id: gameId });
    return {
      ticket: this.tokens.signAdminReplayTicket({ gameId, actorId: actor.userId }),
      expiresIn: env.adminReplayTicketTtl,
    };
  }
```

- [ ] **Step 8: Add the route to `DashboardGamesController`**

In `apps/server/src/dashboard/dashboard-games.controller.ts`, add after the existing `gameReplay` route:

```ts
  @Post('games/:gameId/replay-ticket')
  @HttpCode(200)
  @RequirePermission('games.viewReplay')
  @ApiOperation({
    summary: "Mint a short-lived ticket to view a game's replay in apps/web",
    description: 'Works for COMPLETED and TERMINATED games. 409 for LIVE (nothing to replay yet).',
  })
  mintReplayTicket(@Param('gameId') gameId: string, @CurrentUser() actor: AuthUser) {
    return this.games.mintReplayTicket(actor, gameId);
  }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run admin-replay`
Expected: The `replay-ticket` describe block PASSES; a later describe block (Task 3's, not yet written) doesn't exist yet in this file — there is none yet, so the whole file should pass at this point.

- [ ] **Step 10: Typecheck + lint**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/config/env.ts apps/server/src/auth/auth.types.ts apps/server/src/auth/token.service.ts apps/server/src/dashboard/audit.repo.ts apps/server/src/dashboard/dashboard-games.service.ts apps/server/src/dashboard/dashboard-games.controller.ts apps/server/test/admin-replay.e2e.spec.ts
git commit -m "feat(server): mint admin replay tickets for completed/terminated games"
```

---

### Task 3: Ticket-authorized fetch — `GET /history/:gameId/admin-replay`

**Files:**

- Modify: `apps/server/src/history/history.repo.ts`
- Modify: `apps/server/src/dashboard/dashboard-games.service.ts` (stale comment fix)
- Create: `apps/server/src/history/admin-replay.guard.ts`
- Create: `apps/server/src/history/admin-replay.controller.ts`
- Modify: `apps/server/src/history/history.module.ts`
- Modify: `apps/server/test/admin-replay.e2e.spec.ts`

**Interfaces:**

- Consumes: `TokenService.verifyAdminReplayTicket` (Task 2).
- Produces: `HistoryRepo.loadReplayForAdmin(gameId): Promise<AdminReplayData | null>`; `GET /api/v1/history/:gameId/admin-replay?ticket=...` (no `AccessTokenGuard` — the ticket is the sole authority).

- [ ] **Step 1: Write the failing e2e tests**

Append to `apps/server/test/admin-replay.e2e.spec.ts`:

```ts
async function mintTicket(gameId: string): Promise<string> {
  const res = await request(server())
    .post(`/api/v1/dashboard/games/${gameId}/replay-ticket`)
    .set(auth(viewer.token))
    .expect(200);
  return res.body.ticket;
}

describe('GET /history/:gameId/admin-replay', () => {
  it('404s with no ticket, a garbage ticket, or a ticket scoped to a different game', async () => {
    await request(server()).get(`/api/v1/history/${completedGameId}/admin-replay`).expect(404);
    await request(server())
      .get(`/api/v1/history/${completedGameId}/admin-replay`)
      .query({ ticket: 'garbage' })
      .expect(404);
    const ticketForOther = await mintTicket(terminatedGameId);
    await request(server())
      .get(`/api/v1/history/${completedGameId}/admin-replay`)
      .query({ ticket: ticketForOther })
      .expect(404);
  });

  it('returns the COMPLETED payload: winners + completedAt, no terminatedAt', async () => {
    const ticket = await mintTicket(completedGameId);
    const res = await request(server())
      .get(`/api/v1/history/${completedGameId}/admin-replay`)
      .query({ ticket })
      .expect(200);
    expect(res.body.gameId).toBe(completedGameId);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.actions.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.winners)).toBe(true);
    expect(typeof res.body.completedAt).toBe('string');
    expect(res.body.terminatedAt).toBeUndefined();
    const names = res.body.players.map((p: { displayName?: string }) => p.displayName);
    expect(names).toContain('Host');
  });

  it('returns the TERMINATED payload: terminatedAt/terminatedBy, no winners/completedAt', async () => {
    const ticket = await mintTicket(terminatedGameId);
    const res = await request(server())
      .get(`/api/v1/history/${terminatedGameId}/admin-replay`)
      .query({ ticket })
      .expect(200);
    expect(res.body.gameId).toBe(terminatedGameId);
    expect(res.body.status).toBe('TERMINATED');
    expect(res.body.actions.length).toBe(1);
    expect(res.body.winners).toBeUndefined();
    expect(res.body.completedAt).toBeUndefined();
    expect(typeof res.body.terminatedAt).toBe('string');
    expect(typeof res.body.terminatedBy).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run admin-replay`
Expected: FAIL — `/admin-replay` route doesn't exist yet.

- [ ] **Step 3: Add `loadReplayForAdmin` to `HistoryRepo`**

In `apps/server/src/history/history.repo.ts`, add near `ReplayData`:

```ts
export interface AdminReplayData extends ReplayData {
  status: 'COMPLETED' | 'TERMINATED';
  winners?: string[];
  completedAt?: string;
  terminatedAt?: string;
  terminatedBy?: string;
  terminatedReason?: string;
}
```

Add the method to the `HistoryRepo` class, after `loadReplay`:

```ts
  /**
   * Admin-only replay source, sourced from `games`/`gameEvents` directly rather than the
   * `matchHistory` archive (which is only written on natural completion — a TERMINATED
   * game has no such doc). `winners`/`completedAt` are present only when a matchHistory
   * doc exists (COMPLETED); `terminatedAt`/`terminatedBy` only when the game was
   * terminated. Reachable ONLY through the ticket-authorized admin-replay route — never
   * exposed to the player-facing /history endpoints, which keep the original
   * COMPLETED-only gate in `loadReplay` above untouched.
   */
  async loadReplayForAdmin(gameId: string): Promise<AdminReplayData | null> {
    const game = await this.games.findOne({ _id: gameId, status: { $in: ['COMPLETED', 'TERMINATED'] } });
    if (!game) return null;
    const events = await this.events.find({ gameId }).sort({ seq: 1 }).toArray();
    const last = events[events.length - 1];
    const archive = await this.col.findOne({ _id: gameId });
    return {
      config: game.config,
      engineVersion: game.engineVersion,
      schemaVersion: game.schemaVersion,
      bots: game.bots ?? [],
      actions: events.map((e) => e.action),
      ...(last ? { finalDigest: last.stateDigest } : {}),
      status: game.status as 'COMPLETED' | 'TERMINATED',
      ...(archive
        ? { winners: archive.winners, completedAt: archive.completedAt.toISOString() }
        : {}),
      ...(game.terminatedAt
        ? {
            terminatedAt: game.terminatedAt.toISOString(),
            terminatedBy: game.terminatedBy ?? 'unknown',
            ...(game.terminatedReason ? { terminatedReason: game.terminatedReason } : {}),
          }
        : {}),
    };
  }
```

- [ ] **Step 4: Fix the stale comment in `DashboardGamesService`**

In `apps/server/src/dashboard/dashboard-games.service.ts`, update the doc comment above `gameReplay()`:

```ts
/**
 * Replay payload with the MEMBERSHIP check bypassed — never the COMPLETED gate, which
 * stays in exactly one place for the PLAYER-FACING path (HistoryRepo.loadReplay). A
 * second, deliberately more permissive path exists for maintainers
 * (HistoryRepo.loadReplayForAdmin, reachable only via a minted ticket — see
 * admin-replay.controller.ts) that also accepts TERMINATED games.
 */
```

- [ ] **Step 5: Write `AdminReplayTicketGuard`**

Create `apps/server/src/history/admin-replay.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../auth/token.service';
import type { AdminReplayTicketPayload } from '../auth/auth.types';

/**
 * Verifies a `?ticket=` query param minted by `POST /dashboard/games/:id/replay-ticket`.
 * No AccessTokenGuard runs alongside this — the ticket itself (scoped to one gameId,
 * short-lived) is the sole authority, same posture as the ws-game ticket handoff.
 */
@Injectable()
export class AdminReplayTicketGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { adminReplay?: AdminReplayTicketPayload }>();
    const ticket = req.query.ticket;
    if (typeof ticket !== 'string') throw new NotFoundException('replay not available');
    const payload = this.tokens.verifyAdminReplayTicket(ticket);
    if (!payload || payload.gameId !== req.params.gameId) {
      throw new NotFoundException('replay not available');
    }
    req.adminReplay = payload;
    return true;
  }
}
```

- [ ] **Step 6: Write `AdminReplayController`**

Create `apps/server/src/history/admin-replay.controller.ts`:

```ts
import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HistoryRepo } from './history.repo';
import { AdminReplayTicketGuard } from './admin-replay.guard';

@ApiTags('history')
@Controller('api/v1/history')
export class AdminReplayController {
  constructor(private readonly repo: HistoryRepo) {}

  @Get(':gameId/admin-replay')
  @UseGuards(AdminReplayTicketGuard)
  @ApiOperation({
    summary: 'Ticket-authorized replay for maintainers',
    description:
      'Bypasses membership entirely — authorized solely by a minted admin-replay ticket. ' +
      'Works for COMPLETED and TERMINATED games (the player-facing /replay stays COMPLETED-only).',
  })
  async adminReplay(@Param('gameId') gameId: string) {
    const data = await this.repo.loadReplayForAdmin(gameId);
    if (!data) throw new NotFoundException('replay not available');
    const names = await this.repo.displayNames(data.config.players.map((p) => p.id));
    const botsById = new Map(data.bots.map((b) => [b.playerId, b]));
    return {
      gameId,
      config: data.config,
      engineVersion: data.engineVersion,
      schemaVersion: data.schemaVersion,
      actions: data.actions,
      status: data.status,
      players: data.config.players.map((p) => ({
        userId: p.id,
        seat: p.seat,
        ...(names.has(p.id) ? { displayName: names.get(p.id) } : {}),
        ...(botsById.has(p.id) ? { isBot: true, difficulty: botsById.get(p.id)!.difficulty } : {}),
      })),
      ...(data.winners ? { winners: data.winners } : {}),
      ...(data.completedAt ? { completedAt: data.completedAt } : {}),
      ...(data.terminatedAt
        ? {
            terminatedAt: data.terminatedAt,
            terminatedBy: data.terminatedBy,
            ...(data.terminatedReason ? { terminatedReason: data.terminatedReason } : {}),
          }
        : {}),
      ...(data.finalDigest ? { finalDigest: data.finalDigest } : {}),
    };
  }
}
```

- [ ] **Step 7: Wire the module**

In `apps/server/src/history/history.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HistoryController } from './history.controller';
import { AdminReplayController } from './admin-replay.controller';
import { AdminReplayTicketGuard } from './admin-replay.guard';
import { HistoryRepo } from './history.repo';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [HistoryController, AdminReplayController],
  providers: [HistoryRepo, AdminReplayTicketGuard],
  exports: [HistoryRepo],
})
export class HistoryModule {}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run admin-replay`
Expected: PASS (all describe blocks in the file).

- [ ] **Step 9: Typecheck + lint**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/history/history.repo.ts apps/server/src/history/admin-replay.guard.ts apps/server/src/history/admin-replay.controller.ts apps/server/src/history/history.module.ts apps/server/src/dashboard/dashboard-games.service.ts apps/server/test/admin-replay.e2e.spec.ts
git commit -m "feat(server): ticket-authorized admin replay endpoint"
```

---

### Task 4: apps/web — `AdminReplayScreen`

**Files:**

- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/store/ui.ts`
- Modify: `apps/web/src/screens/ReplayScreen.tsx` (extract `ReplayStage`)
- Create: `apps/web/src/screens/AdminReplayScreen.tsx`
- Create: `apps/web/src/screens/AdminReplayScreen.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/i18n/index.ts`

**Interfaces:**

- Consumes: `ReplayStage` (extracted, `share` prop now optional), `useReplayPlayer` (unchanged).
- Produces: `api.adminReplay(gameId, ticket): Promise<AdminReplayPayload>`; route `/admin-replay/:gameId?ticket=...` → `view: 'adminReplay'`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/screens/AdminReplayScreen.test.tsx`:

Follow `ReplayScreen.test.tsx`'s exact convention: import the real i18n, mock `../net/rest`'s `api` object directly (this IS the established `apps/web` pattern, unlike `apps/admin`'s `stubFetch`), and assert the real translated zh-Hant string rather than the raw i18n key:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../i18n';
import AdminReplayScreen from './AdminReplayScreen';
import { useUi } from '../store/ui';
import { api } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../net/rest')>();
  return { ...actual, api: { ...actual.api, adminReplay: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({
    view: 'adminReplay',
    adminReplayGameId: 'game-1',
    adminReplayTicket: 'tok',
  } as never);
});

describe('AdminReplayScreen', () => {
  it('shows the load-failed card when the ticket fetch fails', async () => {
    vi.mocked(api.adminReplay).mockRejectedValue(new Error('nope'));
    render(<AdminReplayScreen />);
    await waitFor(() => expect(screen.getByText('無法載入對局')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test AdminReplayScreen`
Expected: FAIL — `./AdminReplayScreen` doesn't exist.

- [ ] **Step 3: Add the API client + payload type**

In `apps/web/src/net/rest.ts`, add near `ReplayPayload`:

```ts
export interface AdminReplayPayload {
  gameId: string;
  config: ReplayPayload['config'];
  engineVersion: number;
  schemaVersion: number;
  actions: unknown[];
  status: 'COMPLETED' | 'TERMINATED';
  players: ReplayPlayerMeta[];
  winners?: string[];
  completedAt?: string;
  terminatedAt?: string;
  terminatedBy?: string;
  terminatedReason?: string;
  finalDigest?: string;
}
```

Add to the `api` object, near `replay`:

```ts
  adminReplay: (gameId: string, ticket: string) =>
    req<AdminReplayPayload>(
      'GET',
      `/history/${encodeURIComponent(gameId)}/admin-replay?ticket=${encodeURIComponent(ticket)}`,
    ),
```

- [ ] **Step 4: Add routing state**

In `apps/web/src/store/ui.ts`:

```ts
export type View =
  | 'home'
  | 'room'
  | 'game'
  | 'tutorial'
  | 'login'
  | 'loginCallback'
  | 'history'
  | 'replay'
  | 'adminReplay'
  | 'maps'
  | 'mapEditor';
```

```ts
const ADMIN_REPLAY_PATH = /^\/admin-replay\/([^/]+)$/;
```

```ts
export const adminReplayFromPath = (): { id: string; ticket: string | null } | null => {
  const id = ADMIN_REPLAY_PATH.exec(window.location.pathname)?.[1];
  if (!id) return null;
  const ticket = new URLSearchParams(window.location.search).get('ticket');
  return { id: decodeURIComponent(id), ticket };
};
```

Add two fields to `UiState`/the store's initial object:

```ts
adminReplayGameId: string | null;
adminReplayTicket: string | null;
```

```ts
  adminReplayGameId: null,
  adminReplayTicket: null,
```

In `syncFromUrl`, add a branch BEFORE the existing `replayIdFromPath()` check (an admin-replay URL must not be swallowed by the general replay-path branch, since its regex is more specific but unrelated):

```ts
// Ticket-authorized maintainer view — never auth-gated (the ticket is the sole
// authority), reachable from a fresh tab with no prior session in this app.
const adminReplay = adminReplayFromPath();
if (adminReplay) {
  disconnectGame();
  set({
    view: 'adminReplay',
    adminReplayGameId: adminReplay.id,
    adminReplayTicket: adminReplay.ticket,
    roomCode: null,
    gameId: null,
    ticket: null,
    replayGameId: null,
  });
  return;
}
```

(No changes needed to `enterReplay`/`navigateAfterAuth`/`goHome` — this route is only ever entered by loading the URL directly in a new tab, never navigated to from within the app.)

- [ ] **Step 5: Extract `ReplayStage` from `ReplayScreen.tsx`**

In `apps/web/src/screens/ReplayScreen.tsx`, change `ReplayStage`'s `share` prop to optional and guard its render:

```tsx
function ReplayStage({
  board,
  config,
  actions,
  players,
  finalDigest,
  initialViewer,
  share,
  onLeave,
}: {
  board: Board;
  config: GameConfig;
  actions: Action[];
  players: ReplayPlayerMeta[];
  finalDigest: string | undefined;
  initialViewer: ReturnType<typeof asPlayerId> | null;
  share?: { gameId: string; visibility: ReplayVisibility; canConfigure: boolean };
  onLeave?: () => void;
}) {
```

```tsx
<aside className="replay-rail">
  <PerspectiveSwitcher players={players} viewer={player.viewer} onChange={player.setViewer} />
  {share && (
    <ReplayShare
      gameId={share.gameId}
      visibility={share.visibility}
      canConfigure={share.canConfigure}
    />
  )}
  <LogPanel />
</aside>
```

```tsx
<GameStage
  snapshot={snapshot}
  commands={null}
  sandbox
  frameTarget={frameTarget}
  onLeave={onLeave ?? (() => {})}
/>
```

Export `ReplayStage` so `AdminReplayScreen` can import it:

```tsx
export function ReplayStage({
```

(`ReplayScreen`'s default export and its own usage of `<ReplayStage .../>` are otherwise unchanged — it still passes `share` and `onLeave`.)

- [ ] **Step 6: Write `AdminReplayScreen`**

Create `apps/web/src/screens/AdminReplayScreen.tsx`:

```tsx
// The ticket-authorized replay viewer for maintainers (/admin-replay/:gameId?ticket=...).
// Never auth-gated — the ticket minted by the dashboard is the sole authority. Reuses the
// same ReplayStage/GameStage/useReplayPlayer machinery as the player-facing /replay route.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildBoard, ENGINE_VERSION, SCHEMA_VERSION } from '@trm/engine';
import type { Action, Board, GameConfig } from '@trm/engine';
import { asPlayerId, type RuleParams, type SeatIndex } from '@trm/shared';
import { api, ApiError, type AdminReplayPayload } from '../net/rest';
import { resolveContent } from '../game/contentCache';
import { setActiveContent, resetToDefaultContent } from '../game/catalog';
import { useUi } from '../store/ui';
import { useRoster } from '../store/roster';
import { SandboxProvider } from '../store/sandboxProvider';
import { ReplayStage } from './ReplayScreen';
import '../styles/replay.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; msgKey: string }
  | {
      kind: 'ready';
      payload: AdminReplayPayload;
      board: Board;
      config: GameConfig;
      actions: Action[];
    };

export default function AdminReplayScreen() {
  const { t } = useTranslation();
  const gameId = useUi((s) => s.adminReplayGameId);
  const ticket = useUi((s) => s.adminReplayTicket);
  const setMembers = useRoster((s) => s.setMembers);
  const clearRoster = useRoster((s) => s.clear);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!gameId || !ticket) {
      setLoad({ kind: 'error', msgKey: 'history.loadFailed' });
      return;
    }
    let cancelled = false;
    setLoad({ kind: 'loading' });
    api
      .adminReplay(gameId, ticket)
      .then(async (payload) => {
        if (cancelled) return;
        if (payload.engineVersion !== ENGINE_VERSION || payload.schemaVersion !== SCHEMA_VERSION) {
          setLoad({ kind: 'error', msgKey: 'history.notReplayable' });
          return;
        }
        let board: Board;
        try {
          const content = await resolveContent(payload.config.contentHash);
          if (cancelled) return;
          board = buildBoard(content);
          setActiveContent(content);
        } catch {
          setLoad({ kind: 'error', msgKey: 'history.unknownMap' });
          return;
        }
        const config: GameConfig = {
          seed: payload.config.seed,
          players: payload.config.players.map((p) => ({
            id: asPlayerId(p.id),
            seat: p.seat as SeatIndex,
          })),
          contentHash: payload.config.contentHash,
          ...(payload.config.ruleParams
            ? { ruleParams: payload.config.ruleParams as Partial<RuleParams> }
            : {}),
          ...(payload.config.shuffleTurnOrder !== undefined
            ? { shuffleTurnOrder: payload.config.shuffleTurnOrder }
            : {}),
        };
        setLoad({ kind: 'ready', payload, board, config, actions: payload.actions as Action[] });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setLoad({
            kind: 'error',
            msgKey:
              e instanceof ApiError && e.status === 404
                ? 'history.notReplayable'
                : 'history.loadFailed',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, ticket]);

  useEffect(() => () => resetToDefaultContent(), []);

  useEffect(() => {
    if (load.kind !== 'ready') return;
    setMembers(
      load.payload.players.map((p) => ({
        userId: p.userId,
        displayName: p.displayName ?? '',
        isGuest: false,
        seat: p.seat,
        ready: true,
        ...(p.isBot ? { isBot: true } : {}),
        ...(p.difficulty ? { difficulty: p.difficulty } : {}),
      })),
    );
    return () => clearRoster();
  }, [load, setMembers, clearRoster]);

  if (load.kind === 'loading') return <div className="card">{t('connecting')}</div>;
  if (load.kind === 'error') {
    return (
      <div className="card replay-error">
        <p>{t(load.msgKey)}</p>
      </div>
    );
  }

  return (
    <SandboxProvider>
      <AdminReplayStage
        board={load.board}
        config={load.config}
        actions={load.actions}
        players={load.payload.players}
        finalDigest={load.payload.finalDigest}
        status={load.payload.status}
      />
    </SandboxProvider>
  );
}

function AdminReplayStage({
  board,
  config,
  actions,
  players,
  finalDigest,
  status,
}: {
  board: Board;
  config: GameConfig;
  actions: Action[];
  players: AdminReplayPayload['players'];
  finalDigest: string | undefined;
  status: 'COMPLETED' | 'TERMINATED';
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="replay-admin-notice">
        {status === 'TERMINATED'
          ? t('history.terminatedReplayNotice')
          : t('history.completedReplayNotice')}
      </p>
      <ReplayStage
        board={board}
        config={config}
        actions={actions}
        players={players}
        finalDigest={finalDigest}
        initialViewer={null}
      />
    </>
  );
}
```

`ReplayStage` sources its own `useReplayPlayer`/`useGameStoreApi`/`useLogStoreApi` internally (per `ReplayScreen.tsx`'s existing implementation) — `AdminReplayStage` only needs to add the status notice around it, nothing else.

- [ ] **Step 7: Wire the lazy route in `App.tsx`**

In `apps/web/src/App.tsx`:

```tsx
const AdminReplayScreen = lazy(() => import('./screens/AdminReplayScreen'));
```

```tsx
{
  view === 'adminReplay' && (
    <Suspense fallback={<div className="card">{t('connecting')}</div>}>
      <AdminReplayScreen />
    </Suspense>
  );
}
```

- [ ] **Step 8: Add i18n keys**

In `apps/web/src/i18n/index.ts`, add to the `history` namespace in both locale tables:

zh-Hant: `terminatedReplayNotice: '此對局已被管理員強制終止;回放僅顯示到終止當下的進度,無最終比分。'`, `completedReplayNotice: '此為已完成對局的管理檢視。'`
en: `terminatedReplayNotice: 'This game was force-terminated by a maintainer — the replay only shows progress up to that point, with no final score.'`, `completedReplayNotice: 'Maintainer view of a completed game.'`

- [ ] **Step 9: Run test to verify it passes**

Run: `yarn workspace @trm/web test AdminReplayScreen`
Expected: PASS.

- [ ] **Step 10: Typecheck + lint**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint`
Expected: PASS.

- [ ] **Step 11: Run the full web test suite (guards against the `ReplayStage` extraction breaking `ReplayScreen`)**

Run: `yarn workspace @trm/web test`
Expected: PASS, including any existing `ReplayScreen`-related tests.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/store/ui.ts apps/web/src/screens/ReplayScreen.tsx apps/web/src/screens/AdminReplayScreen.tsx apps/web/src/screens/AdminReplayScreen.test.tsx apps/web/src/App.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web): ticket-authorized admin replay screen"
```

---

### Task 5: apps/admin — "View Replay" button

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/views/GamesView.tsx`
- Modify: `apps/admin/src/views/GamesView.test.tsx`
- Modify: `apps/admin/src/i18n/index.ts`

**Interfaces:**

- Consumes: `api.mintReplayTicket(gameId): Promise<{ticket, expiresIn}>` (new).

- [ ] **Step 1: Add the API client method**

Adding this before the test lets the test call a real (mocked-at-the-fetch-level) `api.mintReplayTicket`, matching the file's existing convention. In `apps/admin/src/net/rest.ts`, add to the `api` object near `getGameLog`:

```ts
  mintReplayTicket: (id: string) =>
    req<{ ticket: string; expiresIn: string }>(
      'POST',
      `/dashboard/games/${encodeURIComponent(id)}/replay-ticket`,
      {},
    ),
```

- [ ] **Step 2: Add the i18n key**

In `apps/admin/src/i18n/index.ts`, add to the `games` namespace in both locale tables:

zh-Hant: `viewReplay: '查看回放'`
en: `viewReplay: 'View Replay'`

- [ ] **Step 3: Write the failing test**

Append to `apps/admin/src/views/GamesView.test.tsx`, reusing the file's existing `stubFetch` helper and `GAME_DETAIL` fixture (both already defined at the top of the file) rather than mocking `../net/rest` — this file's established convention, like the rest of `apps/admin`, is `stubFetch` + real translated text:

```tsx
describe('GamesView view-replay button', () => {
  beforeEach(() => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['games.read', 'games.viewReplay']),
    });
  });

  it('opens a new tab to the web app admin-replay route with a minted ticket', async () => {
    useUi.setState({ view: 'games', param: 'g1' });
    stubFetch({
      '/dashboard/games/g1/replay-ticket': {
        status: 200,
        body: { ticket: 'tok', expiresIn: '5m' },
      },
      '/dashboard/games/g1': { status: 200, body: { ...GAME_DETAIL, status: 'COMPLETED' } },
      '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<GamesView />);
    fireEvent.click(await screen.findByText('查看回放'));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining('/admin-replay/g1?ticket=tok'),
        '_blank',
      ),
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `yarn workspace @trm/admin test GamesView`
Expected: FAIL — no "View Replay" button exists yet, `api.mintReplayTicket`'s route isn't called by anything.

- [ ] **Step 5: Add the button to `GameDrawer`**

In `apps/admin/src/views/GamesView.tsx`, add state + handler + button inside `GameDrawer`:

```tsx
const canViewReplay = useSession((s) => s.hasPermission('games.viewReplay'));
```

```tsx
const viewReplay = async () => {
  try {
    const { ticket } = await api.mintReplayTicket(id);
    window.open(
      `${window.location.origin}/admin-replay/${encodeURIComponent(id)}?ticket=${encodeURIComponent(ticket)}`,
      '_blank',
    );
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  }
};
```

```tsx
{
  canViewReplay && (detail.status === 'COMPLETED' || detail.status === 'TERMINATED') && (
    <section>
      <button className="oc-btn" onClick={() => void viewReplay()}>
        {t('games.viewReplay')}
      </button>
    </section>
  );
}
```

(Place this section anywhere alongside the existing `canReadLog`/`canTerminate`/`canDelete` sections — order doesn't matter functionally.)

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn workspace @trm/admin test GamesView`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Expected: PASS.

- [ ] **Step 8: Full verification sweep**

Run: `yarn typecheck && yarn lint && yarn workspace @trm/server test --run admin-replay && yarn workspace @trm/shared test --run dashboard && yarn workspace @trm/web test && yarn workspace @trm/admin test`
Expected: PASS across the board.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/views/GamesView.tsx apps/admin/src/views/GamesView.test.tsx apps/admin/src/i18n/index.ts
git commit -m "feat(admin): view-replay button on completed/terminated games"
```

---

## Self-Review Notes

- **Spec coverage:** `games.viewReplay` defaulting to viewer (Task 1), ticket mint + ticket-authorized fetch supporting COMPLETED+TERMINATED with divergent payload shapes (Tasks 2–3), `ReplayStage` reuse in a new admin route (Task 4), the admin-panel button (Task 5) — all covered. The player-facing replay path is never touched (verified by leaving `history.controller.ts`/`HistoryRepo.loadReplay` untouched in every task).
- **Placeholder scan:** none — every step has complete code.
- **Type consistency:** `AdminReplayTicketPayload` (Task 2) is the same shape consumed by `AdminReplayTicketGuard` (Task 3); `AdminReplayData` (Task 3, server) and `AdminReplayPayload` (Task 4, web) carry the same field set (`status`, optional `winners`/`completedAt` XOR `terminatedAt`/`terminatedBy`/`terminatedReason`).
