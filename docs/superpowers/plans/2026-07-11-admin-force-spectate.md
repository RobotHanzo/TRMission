# Admin dashboard: force-spectate a live game — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a permitted maintainer force-join a LIVE game as a spectator from the admin
dashboard, bypassing the room's `allowSpectating` setting — the live-game counterpart to the
existing "View Replay" action.

**Architecture:** Reuse the existing ws-game-ticket + WebSocket spectator path completely
unchanged. The dashboard mints a normal ws-game ticket (`TokenService.signWsTicket`, `seat: -1`)
through a new permission-gated endpoint that skips the room eligibility checks
`LobbyService.spectateTicket` enforces. A new ticket-only `apps/web` route
(`/admin-spectate/:gameId?ticket=...`, never auth-gated — parity with `/admin-replay`) fetches a
small roster payload with that same ticket, then opens a live WebSocket connection with it through
the ordinary `GameStage`/`connectGame` machinery. No changes to `apps/server/src/ws/hub.ts`, the
WebSocket protocol, or the redaction path.

**Tech Stack:** NestJS (server), React + Vite + Zustand (apps/web, apps/admin), vitest +
supertest (server e2e), vitest + @testing-library/react (web/admin unit tests). Yarn 4 /
Turborepo monorepo.

## Global Constraints

- Server `dev`/tests run through `@swc-node/register`/`unplugin-swc` — never introduce a
  tsx/esbuild-only construct in `apps/server`.
- Never touch `apps/server/src/ws/hub.ts`'s `ClientHello`/redaction path — the whole point of this
  design is that it needs no changes.
- `apps/web` and `apps/admin` both pin **Vite ^5** — do not bump either to Vite 6.
- UI ships **Traditional Chinese (primary) + English** — every new user-facing string is added to
  BOTH locale blocks in the relevant `i18n/index.ts`, same key, same nesting.
- Never stage files with `git add -A`/`git add .` — stage only the files each task actually
  touched (per root `CLAUDE.md`; other sessions may share this worktree).
- Commit once a task's tests pass — don't batch multiple tasks into one commit.
- Dashboard permissions/roles live once in `packages/shared/src/dashboard.ts`
  (`DASHBOARD_PERMISSIONS`/`ROLE_PERMISSIONS`/`effectivePermissions`) — the server guard and
  `apps/admin` UI both read this one source; never hardcode a permission string elsewhere.
- A LIVE game's hidden information (state, action log, seed) must never reach the dashboard or any
  new endpoint — this feature only ever exposes player ids/seats/display names/bot flags, never
  hands, tickets, or the seed.

---

### Task 1: Shared permission taxonomy

**Files:**

- Modify: `packages/shared/src/dashboard.ts`
- Modify: `apps/server/src/dashboard/audit.repo.ts`
- Create: `packages/shared/src/dashboard.test.ts`

**Interfaces:**

- Produces: `'games.spectateLive'` as a valid `DashboardPermission`, granted at the `viewer` role
  tier (same tier as `'games.viewReplay'`). Produces `'game.spectateLive'` as a valid
  `DashboardAuditAction`. Later tasks (2, 4) use both string literals directly.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/dashboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DASHBOARD_PERMISSIONS, ROLE_PERMISSIONS, effectivePermissions } from './dashboard';

describe('dashboard permission taxonomy', () => {
  it('includes games.spectateLive as a known permission', () => {
    expect(DASHBOARD_PERMISSIONS).toContain('games.spectateLive');
  });

  it('grants games.spectateLive at the viewer tier (same as games.viewReplay)', () => {
    expect(ROLE_PERMISSIONS.viewer).toContain('games.spectateLive');
    expect(effectivePermissions('viewer').has('games.spectateLive')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: FAIL — `DASHBOARD_PERMISSIONS` does not contain `'games.spectateLive'`.

- [ ] **Step 3: Add the permission to the taxonomy**

In `packages/shared/src/dashboard.ts`, add `'games.spectateLive'` to `DASHBOARD_PERMISSIONS` right
after `'games.viewReplay'`:

```ts
export const DASHBOARD_PERMISSIONS = [
  'overview.read',
  'users.read',
  'users.ban',
  'users.tutorialReset',
  'users.delete',
  'users.features',
  'games.read',
  'games.readLog',
  'games.terminate',
  'games.delete',
  'games.viewReplay',
  'games.spectateLive',
  'rooms.read',
  'rooms.close',
  'rooms.delete',
  'maintainers.read',
  'maintainers.write',
  'audit.read',
  'purge.read',
  'purge.run',
  'maps.read',
  'maps.moderate',
  'ratings.read',
  'config.features',
] as const;
```

And to `VIEWER_PERMISSIONS`, right after `'games.viewReplay'`:

```ts
const VIEWER_PERMISSIONS: readonly DashboardPermission[] = [
  'overview.read',
  'users.read',
  'games.read',
  'rooms.read',
  'games.viewReplay',
  'games.spectateLive',
  'maps.read',
  'ratings.read',
];
```

- [ ] **Step 4: Add the audit action**

In `apps/server/src/dashboard/audit.repo.ts`, add `'game.spectateLive'` to `DashboardAuditAction`
right after `'game.viewReplay'`:

```ts
export type DashboardAuditAction =
  | 'bootstrap.grant'
  | 'user.ban'
  | 'user.unban'
  | 'user.features'
  | 'user.tutorialReset'
  | 'user.delete'
  | 'game.terminate'
  | 'game.delete'
  | 'game.viewReplay'
  | 'game.spectateLive'
  | 'room.close'
  | 'room.delete'
  | 'purge.run'
  | 'maintainer.grant'
  | 'maintainer.update'
  | 'maintainer.revoke'
  | 'map.delete'
  | 'map.unshare'
  | 'map.transfer'
  | 'config.features';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: PASS (2 tests)

- [ ] **Step 6: Typecheck**

Run: `yarn workspace @trm/shared typecheck && yarn workspace @trm/server typecheck`
Expected: no errors (the server references `DashboardPermission`/`DashboardAuditAction` — this
confirms nothing downstream broke).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/dashboard.ts packages/shared/src/dashboard.test.ts apps/server/src/dashboard/audit.repo.ts
git commit -m "feat(shared): add games.spectateLive dashboard permission"
```

---

### Task 2: Mint-ticket endpoint (dashboard → ws-game ticket)

**Files:**

- Modify: `apps/server/src/dashboard/dashboard-games.service.ts`
- Modify: `apps/server/src/dashboard/dashboard-games.controller.ts`
- Create: `apps/server/test/admin-spectate.e2e.spec.ts`

**Interfaces:**

- Consumes: `TokenService.signWsTicket({gameId, playerId, seat}): string` (existing,
  `apps/server/src/auth/token.service.ts:34-37`); `AuditService.log(actor, action, target)`
  (existing); `env.wsTicketTtl` (existing, `apps/server/src/config/env.ts:21`); the
  `'games.spectateLive'` permission from Task 1.
- Produces: `DashboardGamesService.mintSpectateTicket(actor: AuthUser, gameId: string):
Promise<{ ticket: string; expiresIn: string }>`. `POST
/api/v1/dashboard/games/:gameId/spectate-ticket`. Task 3's e2e tests and Task 4's admin UI both
  call this route.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/admin-spectate.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

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

async function startedRoom(
  patch?: object,
): Promise<{ code: string; gameId: string; host: { token: string; id: string } }> {
  const a = await guest('Host');
  const b = await guest('Player');
  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(a.token))
    .send({})
    .expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
  if (patch) {
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send(patch)
      .expect(200);
  }
  await request(server())
    .post(`/api/v1/rooms/${code}/ready`)
    .set(auth(a.token))
    .send({ ready: true })
    .expect(200);
  await request(server())
    .post(`/api/v1/rooms/${code}/ready`)
    .set(auth(b.token))
    .send({ ready: true })
    .expect(200);
  const started = await request(server())
    .post(`/api/v1/rooms/${code}/start`)
    .set(auth(a.token))
    .expect(200);
  return { code, gameId: started.body.gameId, host: a };
}

let viewer: { token: string; id: string };
let noPerm: { token: string; id: string };

beforeAll(async () => {
  t = await createTestApp();
  viewer = await registered('spectate-viewer@example.com', 'Viewer');
  await grantDashboard(viewer.id, 'viewer');
  noPerm = await registered('spectate-noperm@example.com', 'NoPerm');
}, 60_000);
afterAll(() => t.close());

describe('POST /dashboard/games/:gameId/spectate-ticket', () => {
  it('404s (nondisclosing) without games.spectateLive', async () => {
    const { gameId } = await startedRoom();
    await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(noPerm.token))
      .expect(404);
  });

  it('404s an unknown game', async () => {
    await request(server())
      .post('/api/v1/dashboard/games/nope/spectate-ticket')
      .set(auth(viewer.token))
      .expect(404);
  });

  it('409s a game that is not LIVE', async () => {
    const { gameId } = await startedRoom();
    const admin = await registered('spectate-admin@example.com', 'Admin');
    await grantDashboard(admin.id, 'admin');
    await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/terminate`)
      .set(auth(admin.token))
      .send({ reason: 'test' })
      .expect(200);
    await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(409);
  });

  it('mints a ticket for a LIVE game', async () => {
    const { gameId } = await startedRoom();
    const res = await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    expect(typeof res.body.ticket).toBe('string');
    expect(typeof res.body.expiresIn).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run admin-spectate`
Expected: FAIL — `404` on `POST /dashboard/games/:gameId/spectate-ticket` (route doesn't exist
yet, Nest returns 404 for an unmatched route, so the "404s without permission"/"404s unknown
game" cases will pass by accident but "mints a ticket"/"409s" will FAIL since there is no 200/409
possible yet).

- [ ] **Step 3: Implement `mintSpectateTicket`**

In `apps/server/src/dashboard/dashboard-games.service.ts`, add this method right after
`mintReplayTicket` (which ends at the line `};` closing that method, just before the
`gameReplay` method):

```ts
  /** Mint a short-lived ws-game ticket that force-joins a maintainer as a spectator on a LIVE
   *  game — bypassing the room's allowSpectating setting and the "not already seated" check
   *  entirely, since the maintainer is never a room member. This is literally the SAME ws-game
   *  ticket kind (kind: 'ws-game', seat: -1) a normal spectator gets from
   *  LobbyService.spectateTicket; the hub's ClientHello path needs no changes at all. */
  async mintSpectateTicket(
    actor: AuthUser,
    gameId: string,
  ): Promise<{ ticket: string; expiresIn: string }> {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) throw new NotFoundException('game not found');
    if (game.status !== 'LIVE') {
      throw new ConflictException('spectating is only available for LIVE games');
    }
    await this.audit.log(actor, 'game.spectateLive', { type: 'game', id: gameId });
    return {
      ticket: this.tokens.signWsTicket({ gameId, playerId: actor.userId, seat: -1 }),
      expiresIn: env.wsTicketTtl,
    };
  }
```

- [ ] **Step 4: Wire the route**

In `apps/server/src/dashboard/dashboard-games.controller.ts`, add this route right after
`mintReplayTicket` (before `terminate`):

```ts
  @Post('games/:gameId/spectate-ticket')
  @HttpCode(200)
  @RequirePermission('games.spectateLive')
  @ApiOperation({
    summary: "Mint a short-lived ticket to force-join a LIVE game's live view in apps/web",
    description:
      "Bypasses the room's allowSpectating setting entirely — the maintainer is never a room " +
      'member. 409 unless the game is LIVE.',
  })
  mintSpectateTicket(@Param('gameId') gameId: string, @CurrentUser() actor: AuthUser) {
    return this.games.mintSpectateTicket(actor, gameId);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run admin-spectate`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/dashboard/dashboard-games.service.ts apps/server/src/dashboard/dashboard-games.controller.ts apps/server/test/admin-spectate.e2e.spec.ts
git commit -m "feat(server): mint a dashboard ticket to force-spectate a LIVE game"
```

---

### Task 3: Roster endpoint + end-to-end bypass proof

**Files:**

- Modify: `apps/server/src/history/history.repo.ts`
- Create: `apps/server/src/history/admin-spectate.guard.ts`
- Create: `apps/server/src/history/admin-spectate.controller.ts`
- Modify: `apps/server/src/history/history.module.ts`
- Modify: `apps/server/test/admin-spectate.e2e.spec.ts` (append)

**Interfaces:**

- Consumes: `TokenService.verifyWsTicket(token): WsTicketPayload | null` (existing,
  `apps/server/src/auth/token.service.ts:39-46`); `HistoryRepo.displayNames(userIds:
string[]): Promise<Map<string, string>>` (existing).
- Produces: `HistoryRepo.loadSpectateRoster(gameId: string): Promise<{ players: {id: string;
seat: number}[]; bots: BotProfile[] } | null>`. `GET /api/v1/history/:gameId/admin-spectate?
ticket=` returning `{ players: [{userId, seat, displayName?, isBot?, difficulty?}] }`. Task 6's
  `apps/web` screen calls this route.

- [ ] **Step 1: Write the failing e2e tests**

Append to `apps/server/test/admin-spectate.e2e.spec.ts` (add these imports at the top alongside
the existing ones, then the new `describe` blocks at the end of the file):

```ts
import type { ServerEnvelope } from '@trm/proto';
import { GameHub } from '../src/ws/hub';
import { encodeClient, decodeServer } from './helpers';
```

```ts
describe('force-spectating a LIVE game via the dashboard', () => {
  it('mints a ticket that joins even when the room disables spectating, and serves the roster', async () => {
    const { code, gameId } = await startedRoom({ allowSpectating: false });

    // A normal spectator is blocked by the room setting...
    const blocked = await guest('Blocked');
    await request(server())
      .post(`/api/v1/rooms/${code}/spectate`)
      .set(auth(blocked.token))
      .expect(403);

    // ...but the dashboard-minted ticket bypasses it entirely.
    const mint = await request(server())
      .post(`/api/v1/dashboard/games/${gameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    const ticket: string = mint.body.ticket;

    // Roster fetch, authorized solely by that same ticket.
    const roster = await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .query({ ticket })
      .expect(200);
    expect(roster.body.players.map((p: { displayName?: string }) => p.displayName)).toContain(
      'Host',
    );

    // The ws-game ticket itself binds a live spectator connection exactly like a real one.
    const hub = t.app.get(GameHub);
    const frames: ServerEnvelope[] = [];
    hub.openConnection('admin-spectate-conn', (bytes) => frames.push(decodeServer(bytes)));
    await hub.receive(
      'admin-spectate-conn',
      encodeClient(1, { case: 'hello', value: { ticket, protocolVersion: 1 } }),
    );
    expect(frames.some((f) => f.event.case === 'welcome')).toBe(true);
    const snap = frames.find((f) => f.event.case === 'snapshot');
    expect(snap).toBeTruthy();
    expect(snap!.event.case === 'snapshot' && snap!.event.value.snapshot?.you).toBeFalsy();
  });

  it('roster fetch 404s with no ticket, a garbage ticket, or a ticket scoped to a different game', async () => {
    const { gameId } = await startedRoom();
    const { gameId: otherGameId } = await startedRoom();
    const mintOther = await request(server())
      .post(`/api/v1/dashboard/games/${otherGameId}/spectate-ticket`)
      .set(auth(viewer.token))
      .expect(200);
    await request(server()).get(`/api/v1/history/${gameId}/admin-spectate`).expect(404);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .query({ ticket: 'garbage' })
      .expect(404);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .query({ ticket: mintOther.body.ticket })
      .expect(404);
  });

  it('roster fetch 404s a seated players own (non-spectator) ticket', async () => {
    const { code, gameId, host } = await startedRoom();
    const seatTicket = await request(server())
      .post(`/api/v1/rooms/${code}/ticket`)
      .set(auth(host.token))
      .expect(200);
    await request(server())
      .get(`/api/v1/history/${gameId}/admin-spectate`)
      .query({ ticket: seatTicket.body.ticket })
      .expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run admin-spectate`
Expected: FAIL — `GET /api/v1/history/:gameId/admin-spectate` doesn't exist yet (404 from Nest's
router on the "should be 200" case, and the "should 404" cases pass by accident).

- [ ] **Step 3: Add `HistoryRepo.loadSpectateRoster`**

In `apps/server/src/history/history.repo.ts`, add this method right after `loadReplayForAdmin`
(right before the class's closing `}`):

```ts
  /**
   * Player roster (ids + seats, no hidden info) for the ticket-authorized /admin-spectate live
   * view. No status filter: the caller already proved a valid spectator ws-game ticket scoped
   * to this exact gameId (AdminSpectateTicketGuard), and display names/bot flags are never
   * hidden information regardless of the game's current status.
   */
  async loadSpectateRoster(
    gameId: string,
  ): Promise<{ players: StoredConfig['players']; bots: BotProfile[] } | null> {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) return null;
    return { players: game.config.players, bots: game.bots ?? [] };
  }
```

- [ ] **Step 4: Add the ticket guard**

Create `apps/server/src/history/admin-spectate.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../auth/token.service';
import type { WsTicketPayload } from '../auth/auth.types';

/**
 * Verifies a `?ticket=` query param against the SAME ws-game ticket kind a real spectator gets
 * (kind: 'ws-game', seat: -1) — reused here purely to resolve player display names for the
 * ticket-only /admin-spectate web route; the live game state itself streams over the WebSocket
 * using this identical ticket. Any valid spectator ticket for this game passes (not
 * dashboard-exclusive): display names are not hidden information, so there is nothing to gate
 * more tightly than "holds a valid spectator ticket for this exact game".
 */
@Injectable()
export class AdminSpectateTicketGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { spectateTicket?: WsTicketPayload }>();
    const ticket = req.query.ticket;
    if (typeof ticket !== 'string') throw new NotFoundException('spectate info not available');
    const payload = this.tokens.verifyWsTicket(ticket);
    if (!payload || payload.gameId !== req.params.gameId || payload.seat !== -1) {
      throw new NotFoundException('spectate info not available');
    }
    req.spectateTicket = payload;
    return true;
  }
}
```

- [ ] **Step 5: Add the controller**

Create `apps/server/src/history/admin-spectate.controller.ts`:

```ts
import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HistoryRepo } from './history.repo';
import { AdminSpectateTicketGuard } from './admin-spectate.guard';

@ApiTags('history')
@Controller('api/v1/history')
export class AdminSpectateController {
  constructor(private readonly repo: HistoryRepo) {}

  @Get(':gameId/admin-spectate')
  @UseGuards(AdminSpectateTicketGuard)
  @ApiOperation({
    summary: 'Ticket-authorized player roster for the live /admin-spectate web route',
    description:
      'Authorized solely by a valid spectator ws-game ticket for this game — resolves display ' +
      'names/bot flags only; the live game state itself streams over the WebSocket using the ' +
      'same ticket.',
  })
  async adminSpectate(@Param('gameId') gameId: string) {
    const data = await this.repo.loadSpectateRoster(gameId);
    if (!data) throw new NotFoundException('spectate info not available');
    const names = await this.repo.displayNames(data.players.map((p) => p.id));
    const botsById = new Map(data.bots.map((b) => [b.playerId, b]));
    return {
      players: data.players.map((p) => ({
        userId: p.id,
        seat: p.seat,
        ...(names.has(p.id) ? { displayName: names.get(p.id) } : {}),
        ...(botsById.has(p.id) ? { isBot: true, difficulty: botsById.get(p.id)!.difficulty } : {}),
      })),
    };
  }
}
```

- [ ] **Step 6: Register in the module**

In `apps/server/src/history/history.module.ts`, add the new controller and guard:

```ts
import { Module } from '@nestjs/common';
import { HistoryController } from './history.controller';
import { AdminReplayController } from './admin-replay.controller';
import { AdminReplayTicketGuard } from './admin-replay.guard';
import { AdminSpectateController } from './admin-spectate.controller';
import { AdminSpectateTicketGuard } from './admin-spectate.guard';
import { HistoryRepo } from './history.repo';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [HistoryController, AdminReplayController, AdminSpectateController],
  providers: [HistoryRepo, AdminReplayTicketGuard, AdminSpectateTicketGuard],
  exports: [HistoryRepo],
})
export class HistoryModule {}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run admin-spectate`
Expected: PASS (7 tests total in the file)

- [ ] **Step 8: Run the full server test suite**

Run: `yarn workspace @trm/server test`
Expected: PASS — confirms nothing in `history.module.ts`/the dashboard module broke.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/history/history.repo.ts apps/server/src/history/admin-spectate.guard.ts apps/server/src/history/admin-spectate.controller.ts apps/server/src/history/history.module.ts apps/server/test/admin-spectate.e2e.spec.ts
git commit -m "feat(server): serve a ticket-authorized roster for live spectating"
```

---

### Task 4: Admin dashboard UI — Spectate button

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/views/GamesView.tsx`
- Modify: `apps/admin/src/i18n/index.ts`
- Modify: `apps/admin/src/views/GamesView.test.tsx`

**Interfaces:**

- Consumes: `POST /dashboard/games/:gameId/spectate-ticket` from Task 2; `webOrigin()` (existing,
  `apps/admin/src/lib/mainApp.ts`); `useSession((s) => s.hasPermission('games.spectateLive'))`
  (existing hook, now resolves truthy because of Task 1).
- Produces: `api.mintSpectateTicket(id: string): Promise<{ ticket: string; expiresIn: string }>`.
  A "Spectate" button in `GamesView`'s game drawer, visible for `status === 'LIVE'` +
  `games.spectateLive`, opening `${webOrigin()}/admin-spectate/:gameId?ticket=...` in a new tab.

- [ ] **Step 1: Write the failing test**

In `apps/admin/src/views/GamesView.test.tsx`, add this `describe` block at the end of the file
(after the existing `describe('GamesView view-replay button'` block):

```tsx
describe('GamesView spectate button', () => {
  beforeEach(() => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['games.read', 'games.spectateLive']),
    });
  });

  it('opens a new tab to the web app admin-spectate route with a minted ticket', async () => {
    useUi.setState({ view: 'games', param: 'g1' });
    stubFetch({
      '/dashboard/games/g1/spectate-ticket': {
        status: 200,
        body: { ticket: 'tok', expiresIn: '45s' },
      },
      '/dashboard/games/g1': { status: 200, body: { ...GAME_DETAIL, status: 'LIVE' } },
      '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<GamesView />);
    fireEvent.click(await screen.findByText('強制觀戰'));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'http://localhost:5173/admin-spectate/g1?ticket=tok',
        '_blank',
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test GamesView`
Expected: FAIL — `screen.findByText('強制觀戰')` times out (no such button/i18n key yet).

- [ ] **Step 3: Add the API call**

In `apps/admin/src/net/rest.ts`, add this right after `mintReplayTicket`:

```ts
  mintSpectateTicket: (id: string) =>
    req<{ ticket: string; expiresIn: string }>(
      'POST',
      `/dashboard/games/${encodeURIComponent(id)}/spectate-ticket`,
      {},
    ),
```

- [ ] **Step 4: Add the i18n keys**

In `apps/admin/src/i18n/index.ts`, zh-Hant block: add `spectate: '強制觀戰',` right after
`viewReplay: '查看回放',` (in the `games` namespace, ~line 177); add `'games.spectateLive':
'強制觀戰對局',` right after `'games.viewReplay': '檢視回放',` (in the `perm` namespace, ~line
358); add `'game.spectateLive': '強制觀戰對局',` right after `'game.viewReplay': '檢視回放',` (in
the `audit.action` namespace, ~line 318).

English block: add `spectate: 'Spectate',` right after `viewReplay: 'View Replay',` (~line 569);
add `'games.spectateLive': 'Force-spectate live games',` right after `'games.viewReplay': 'View
replays',` (~line 753); add `'game.spectateLive': 'Force-spectated a live game',` right after
`'game.viewReplay': 'Viewed replay',` (~line 712).

- [ ] **Step 5: Add the button**

In `apps/admin/src/views/GamesView.tsx`, add the permission hook right after `canViewReplay`
(line 35):

```ts
const canSpectateLive = useSession((s) => s.hasPermission('games.spectateLive'));
```

Add the handler right after the `viewReplay` function (which ends at its closing `};`, before
`del`):

```ts
const spectate = async () => {
  try {
    const { ticket } = await api.mintSpectateTicket(id);
    window.open(
      `${webOrigin()}/admin-spectate/${encodeURIComponent(id)}?ticket=${encodeURIComponent(ticket)}`,
      '_blank',
    );
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  }
};
```

Add the button JSX right after the `canViewReplay` section (which closes with `</section>\n
)}`, right before the `canTerminate` section):

```tsx
{
  canSpectateLive && detail.status === 'LIVE' && (
    <section>
      <button className="oc-btn" onClick={() => void spectate()}>
        {t('games.spectate')}
      </button>
    </section>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn workspace @trm/admin test GamesView`
Expected: PASS

- [ ] **Step 7: Run typecheck + full admin test suite**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/views/GamesView.tsx apps/admin/src/i18n/index.ts apps/admin/src/views/GamesView.test.tsx
git commit -m "feat(admin): add a Spectate button for LIVE games"
```

---

### Task 5: `apps/web` routing for `/admin-spectate/:gameId`

**Files:**

- Modify: `apps/web/src/store/ui.ts`
- Modify: `apps/web/src/store/ui.test.ts`

**Interfaces:**

- Produces: `View` gains `'adminSpectate'`. `adminSpectateFromPath(): { id: string; ticket:
string | null } | null`. `UiState` gains `adminSpectateGameId: string | null` and
  `adminSpectateTicket: string | null`. `syncFromUrl` recognizes `/admin-spectate/:gameId` and is
  never auth-gated for it. Task 6's `AdminSpectateScreen` and `App.tsx` consume these fields/the
  `'adminSpectate'` view.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/store/ui.test.ts`, add these two tests inside the existing `describe('ui store
routing'` block, right after the `'syncFromUrl(not authed) on /replay/:id is NOT gated —
view-by-link replays'` test:

```ts
it('syncFromUrl(authed) on /admin-spectate/:id restores the adminSpectate view with the ticket', () => {
  window.history.replaceState(null, '', '/admin-spectate/game-1?ticket=tok');
  useUi.getState().syncFromUrl(true);
  expect(useUi.getState().view).toBe('adminSpectate');
  expect(useUi.getState().adminSpectateGameId).toBe('game-1');
  expect(useUi.getState().adminSpectateTicket).toBe('tok');
});

it('syncFromUrl(not authed) on /admin-spectate/:id is NOT gated — the ticket is the sole authority', () => {
  window.history.replaceState(null, '', '/admin-spectate/game-1?ticket=tok');
  useUi.getState().syncFromUrl(false);
  expect(useUi.getState().view).toBe('adminSpectate');
  expect(useUi.getState().adminSpectateGameId).toBe('game-1');
});
```

Also add this new `describe` block at the end of the file, after `describe('roomCodeFromPath'`:

```ts
describe('adminSpectateFromPath', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('reads the game id and ticket from /admin-spectate/:id?ticket=...', () => {
    window.history.replaceState(null, '', '/admin-spectate/game-1?ticket=tok');
    expect(adminSpectateFromPath()).toEqual({ id: 'game-1', ticket: 'tok' });
  });

  it('returns a null ticket when the query param is missing', () => {
    window.history.replaceState(null, '', '/admin-spectate/game-1');
    expect(adminSpectateFromPath()).toEqual({ id: 'game-1', ticket: null });
  });

  it('returns null when not on an admin-spectate path', () => {
    window.history.replaceState(null, '', '/');
    expect(adminSpectateFromPath()).toBeNull();
  });
});
```

And add `adminSpectateFromPath` to the import at the top of the file:

```ts
import { useUi, roomCodeFromPath, adminSpectateFromPath } from './ui';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test ui.test`
Expected: FAIL — `adminSpectateFromPath` is not exported yet; the `syncFromUrl` tests get `view`
`'login'` or `'home'` instead of `'adminSpectate'`.

- [ ] **Step 3: Implement the routing**

In `apps/web/src/store/ui.ts`:

Add `'adminSpectate'` to the `View` union, right after `'adminReplay'`:

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
  | 'adminSpectate'
  | 'maps'
  | 'mapEditor';
```

Add the path constant right after `ADMIN_REPLAY_PATH`:

```ts
const ADMIN_SPECTATE_PATH = /^\/admin-spectate\/([^/]+)$/;
```

Add the parser right after `adminReplayFromPath`:

```ts
/** Parses `/admin-spectate/:gameId?ticket=...` — the ticket-authorized maintainer route for
 *  force-joining a LIVE game as a spectator, reachable only by loading the URL directly (the
 *  dashboard mints it into a fresh tab). */
export const adminSpectateFromPath = (): { id: string; ticket: string | null } | null => {
  const id = ADMIN_SPECTATE_PATH.exec(window.location.pathname)?.[1];
  if (!id) return null;
  const ticket = new URLSearchParams(window.location.search).get('ticket');
  return { id: decodeURIComponent(id), ticket };
};
```

Add the state fields to `UiState`, right after `adminReplayTicket`:

```ts
/** The ticket-authorized /admin-spectate/:gameId route — game id + ticket parsed from the URL. */
adminSpectateGameId: string | null;
adminSpectateTicket: string | null;
```

Add the initial state, right after `adminReplayTicket: null,`:

```ts
  adminSpectateGameId: null,
  adminSpectateTicket: null,
```

Add the `syncFromUrl` branch, right after the existing `adminReplay` branch's closing `return;\n
}` (before the "Replays are NOT auth-gated" comment/`replayId` branch):

```ts
// Ticket-authorized maintainer view — never auth-gated (the ticket is the sole authority),
// reachable from a fresh tab with no prior session in this app. Force-joins a LIVE game as
// a spectator, bypassing the room's allowSpectating setting.
const adminSpectate = adminSpectateFromPath();
if (adminSpectate) {
  disconnectGame();
  set({
    view: 'adminSpectate',
    adminSpectateGameId: adminSpectate.id,
    adminSpectateTicket: adminSpectate.ticket,
    roomCode: null,
    gameId: null,
    ticket: null,
    replayGameId: null,
  });
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test ui.test`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors (App.tsx doesn't reference `'adminSpectate'` yet, so this only confirms
`ui.ts` itself is sound — Task 6 wires the render branch).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store/ui.ts apps/web/src/store/ui.test.ts
git commit -m "feat(web): route /admin-spectate/:gameId, never auth-gated"
```

---

### Task 6: `AdminSpectateScreen` — live connection + roster

**Files:**

- Modify: `apps/web/src/net/rest.ts`
- Create: `apps/web/src/screens/AdminSpectateScreen.tsx`
- Create: `apps/web/src/screens/AdminSpectateScreen.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/i18n/index.ts`

**Interfaces:**

- Consumes: `GET /history/:gameId/admin-spectate?ticket=` from Task 3; `connectGame(ticket:
string): GameSocket` / `disconnectGame(): void` / `getSocket(): GameSocket | null` (existing,
  `apps/web/src/net/connection.ts`); `useRoster((s) => s.setMembers)` (existing); `GameStage`
  (existing, `apps/web/src/screens/GameStage.tsx`); `useUi((s) => s.adminSpectateGameId /
adminSpectateTicket)` from Task 5.
- Produces: default-exported `AdminSpectateScreen` React component, rendered by `App.tsx` for
  `view === 'adminSpectate'`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/screens/AdminSpectateScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type * as RestModule from '../net/rest';
import '../i18n';
import AdminSpectateScreen from './AdminSpectateScreen';
import { useUi } from '../store/ui';
import { useGame } from '../store/game';
import { useRoster } from '../store/roster';
import { api, type AdminSpectatePayload } from '../net/rest';

vi.mock('../net/connection', () => ({
  disconnectGame: vi.fn(),
  connectGame: vi.fn(),
  getSocket: vi.fn(() => null),
}));
vi.mock('../net/rest', async (importOriginal) => {
  const actual = await importOriginal<typeof RestModule>();
  return { ...actual, api: { ...actual.api, adminSpectate: vi.fn() } };
});

const payload: AdminSpectatePayload = {
  players: [
    { userId: 'u1', seat: 0, displayName: 'Tester' },
    { userId: 'u2', seat: 1, displayName: 'Other' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({
    view: 'adminSpectate',
    adminSpectateGameId: 'game-1',
    adminSpectateTicket: 'tok',
  } as never);
  useGame.setState({ snapshot: null } as never);
  useRoster.getState().clear();
});

describe('AdminSpectateScreen', () => {
  it('shows the load-failed card when the roster fetch fails', async () => {
    vi.mocked(api.adminSpectate).mockRejectedValue(new Error('nope'));
    render(<AdminSpectateScreen />);
    await waitFor(() => expect(screen.getByText('無法載入對局')).toBeInTheDocument());
  });

  it('seeds the roster and connects the socket once the ticket-authorized roster loads', async () => {
    vi.mocked(api.adminSpectate).mockResolvedValue(payload);
    const { connectGame } = await import('../net/connection');
    render(<AdminSpectateScreen />);
    await waitFor(() => expect(connectGame).toHaveBeenCalledWith('tok'));
    expect(useRoster.getState().byId['u1']).toMatchObject({ displayName: 'Tester', seat: 0 });
  });

  it('shows the missing-ticket error card when the URL has no ticket', async () => {
    useUi.setState({
      view: 'adminSpectate',
      adminSpectateGameId: 'game-1',
      adminSpectateTicket: null,
    } as never);
    render(<AdminSpectateScreen />);
    await waitFor(() => expect(screen.getByText('無法載入對局')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test AdminSpectateScreen`
Expected: FAIL — `../screens/AdminSpectateScreen` does not exist yet.

- [ ] **Step 3: Add the REST client pieces**

In `apps/web/src/net/rest.ts`, add this interface right after `AdminReplayPayload` (after its
closing `}`):

```ts
/** Roster (ids/seats/names/bot flags) for the ticket-authorized maintainer live-spectate route —
 *  no normal auth involved, the ticket minted by the dashboard is the sole authority. The live
 *  game state itself streams over the WebSocket using this same ticket. */
export interface AdminSpectatePayload {
  players: ReplayPlayerMeta[];
}
```

Add the API function right after `adminReplay`:

```ts
  adminSpectate: (gameId: string, ticket: string) =>
    req<AdminSpectatePayload>(
      'GET',
      `/history/${encodeURIComponent(gameId)}/admin-spectate?ticket=${encodeURIComponent(ticket)}`,
    ),
```

- [ ] **Step 4: Add the i18n key**

In `apps/web/src/i18n/index.ts`, zh-Hant `history` namespace: add `spectateEndedNotice:
'已停止觀戰。',` right after `completedReplayNotice: '此為已完成對局的管理檢視。',`.

English `history` namespace: add `spectateEndedNotice: 'You stopped spectating.',` right after
`completedReplayNotice: 'Maintainer view of a completed game.',`.

- [ ] **Step 5: Implement `AdminSpectateScreen`**

Create `apps/web/src/screens/AdminSpectateScreen.tsx`:

```tsx
// The ticket-authorized live-spectate viewer for maintainers (/admin-spectate/:gameId?ticket=...).
// Never auth-gated — the ticket minted by the dashboard is the sole authority. Connects the same
// WebSocket path a real spectator uses (connectGame/GameStage); only the ticket's origin (a
// dashboard mint that bypasses the room's allowSpectating setting) differs.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../store/ui';
import { useGame } from '../store/game';
import { useRoster } from '../store/roster';
import { api } from '../net/rest';
import { connectGame, disconnectGame, getSocket } from '../net/connection';
import { useActiveContent } from '../game/useActiveContent';
import { GameStage } from './GameStage';

type LoadState = { kind: 'loading' } | { kind: 'error'; msgKey: string } | { kind: 'ready' };

export default function AdminSpectateScreen() {
  const { t } = useTranslation();
  const gameId = useUi((s) => s.adminSpectateGameId);
  const ticket = useUi((s) => s.adminSpectateTicket);
  const setMembers = useRoster((s) => s.setMembers);
  const clearRoster = useRoster((s) => s.clear);
  const snapshot = useGame((s) => s.snapshot);
  const contentStatus = useActiveContent(snapshot?.contentHash);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [left, setLeft] = useState(false);

  useEffect(() => {
    if (!gameId || !ticket) {
      setLoad({ kind: 'error', msgKey: 'history.loadFailed' });
      return;
    }
    let cancelled = false;
    setLoad({ kind: 'loading' });
    api
      .adminSpectate(gameId, ticket)
      .then((payload) => {
        if (cancelled) return;
        setMembers(
          payload.players.map((p) => ({
            userId: p.userId,
            displayName: p.displayName ?? '',
            isGuest: false,
            seat: p.seat,
            ready: true,
            ...(p.isBot ? { isBot: true } : {}),
            ...(p.difficulty ? { difficulty: p.difficulty } : {}),
          })),
        );
        connectGame(ticket);
        setLoad({ kind: 'ready' });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error', msgKey: 'history.loadFailed' });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, ticket, setMembers]);

  useEffect(
    () => () => {
      disconnectGame();
      clearRoster();
    },
    [clearRoster],
  );

  const leave = () => {
    disconnectGame();
    setLeft(true);
  };

  if (left) return <div className="card">{t('history.spectateEndedNotice')}</div>;
  if (load.kind === 'loading') return <div className="card">{t('connecting')}</div>;
  if (load.kind === 'error') {
    return (
      <div className="card replay-error">
        <p>{t(load.msgKey)}</p>
      </div>
    );
  }
  if (!snapshot || contentStatus === 'loading') {
    return <div className="card">{t('connecting')}</div>;
  }
  if (contentStatus === 'error') {
    return <div className="card">{t('history.unknownMap')}</div>;
  }

  return <GameStage snapshot={snapshot} commands={getSocket()} onLeave={leave} />;
}
```

- [ ] **Step 6: Wire it into `App.tsx`**

In `apps/web/src/App.tsx`, add the lazy import right after `AdminReplayScreen`:

```ts
const AdminSpectateScreen = lazy(() => import('./screens/AdminSpectateScreen'));
```

Add `'adminSpectate'` to `isGameLayout`, right after `view === 'adminReplay'`:

```ts
const isGameLayout =
  view === 'game' ||
  view === 'tutorial' ||
  view === 'replay' ||
  view === 'adminReplay' ||
  view === 'adminSpectate' ||
  view === 'mapEditor';
```

Add the render branch, right after the `view === 'adminReplay'` block:

```tsx
{
  view === 'adminSpectate' && (
    <Suspense fallback={<div className="card">{t('connecting')}</div>}>
      <AdminSpectateScreen />
    </Suspense>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn workspace @trm/web test AdminSpectateScreen`
Expected: PASS (3 tests)

- [ ] **Step 8: Run typecheck + the full web test suite**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/screens/AdminSpectateScreen.tsx apps/web/src/screens/AdminSpectateScreen.test.tsx apps/web/src/App.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web): add the live force-spectate screen for maintainers"
```

---

## Self-Review

**Spec coverage:**

- New `games.spectateLive` permission at the viewer tier → Task 1.
- Mint endpoint bypassing `allowSpectating`/eligibility, reusing `signWsTicket` → Task 2.
- Roster endpoint reusing `verifyWsTicket`, permissive to any valid spectator ticket → Task 3.
- End-to-end proof that a `allowSpectating: false` room is still joinable via the ticket → Task 3
  (the `'force-spectating a LIVE game via the dashboard'` test hits the real hub `ClientHello`
  path and asserts a null-viewer snapshot arrives).
- Dashboard "Spectate" button, LIVE-only, permission-gated → Task 4.
- Ticket-only `/admin-spectate` web route, never auth-gated → Task 5.
- Live screen: roster seed, `connectGame`, `GameStage` render, non-navigating "leave" → Task 6.
- Non-goals (no player-facing indicator, no reconnect/re-mint path, no new listing) — nothing
  further to build; confirmed no task introduces any of them.

**Placeholder scan:** No TBD/"add error handling"/"similar to Task N" — every step has literal
code and exact file anchors.

**Type consistency:** `mintSpectateTicket` (Task 2) → `TokenService.signWsTicket({gameId,
playerId, seat})` (existing, unchanged signature) throughout. `AdminSpectateTicketGuard` (Task 3)
→ `TokenService.verifyWsTicket` (existing, unchanged) → `WsTicketPayload {kind, gameId, playerId,
seat}` (existing). Roster shape `{userId, seat, displayName?, isBot?, difficulty?}` matches from
server response (Task 3) → `AdminSpectatePayload`/`ReplayPlayerMeta` (Task 6) → the `setMembers`
call's mapped `RoomMember` shape (Task 6) — same field names end to end. `View` union
(`'adminSpectate'`, Task 5) matches the string used in `App.tsx`'s switch and `isGameLayout`
check (Task 6). `adminSpectateGameId`/`adminSpectateTicket` (Task 5's `UiState`) match the field
names read in `AdminSpectateScreen` (Task 6).
