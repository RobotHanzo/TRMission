# Delete-user Dashboard Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an irreversible "delete account" action to the maintainer dashboard's Users view, distinct from the existing reversible "disable" (ban) action.

**Architecture:** A new admin-tier `users.delete` permission gates a `DELETE /api/v1/dashboard/users/:id` endpoint. The server hard-deletes the `users` doc, its refresh sessions, and its owned custom-map drafts; force-terminates any LIVE game the user is seated in and closes their rooms (reusing `PurgeService`'s existing terminate/evict machinery); and leaves `matchHistory` + published `mapContents` as the anonymised archive. The admin SPA adds a danger button in the user drawer that goes through the existing `ConfirmDialog`.

**Tech Stack:** TypeScript, NestJS (server), MongoDB (native driver), React + Vite (admin SPA), Vitest + supertest (server e2e) + @testing-library/react (web), zod DTOs, i18next.

## Global Constraints

- **Monorepo build order:** `packages/shared → apps/server` / `apps/admin`. `@trm/shared` changes must land before server/admin consume them.
- **swc, not tsx:** server runs via `@swc-node/register`; tests via `unplugin-swc`. Do not change the runtime.
- **Permission taxonomy lives once** in `packages/shared/src/dashboard.ts` — server guard and admin UI both read it; never hardcode a permission string list elsewhere.
- **i18n dual-table discipline:** `apps/admin/src/i18n/index.ts` has zh-Hant (primary) + en (fallback) with the **same key tree**. Every new key goes in **both** objects.
- **`oc-`-prefixed class names** for any admin UI; reuse `oc-btn` / `oc-btn danger`.
- **Hidden-info invariant:** unchanged here — a deleted user's game secrets are never surfaced; the endpoint only removes/terminates.
- **Commit discipline:** stage only files this work changes (`git add <explicit paths>`). Never `git add -A`/`.` — other sessions share this worktree. Stay on `main`.
- **Vite pinned at ^5** in `apps/admin` — do not bump.

---

## File Structure

**Create:**
- `apps/server/test/dashboard-delete-user.e2e.spec.ts` — e2e coverage for the new endpoint.

**Modify:**
- `packages/shared/src/dashboard.ts` — add `users.delete` permission (+ `ADMIN_PERMISSIONS`).
- `packages/shared/test/dashboard.spec.ts` — assert the new permission's tier.
- `apps/server/src/dashboard/audit.repo.ts` — add `'user.delete'` to the action union.
- `apps/server/src/auth/user.repo.ts` — `deleteById`.
- `apps/server/src/maps/custom-map.repo.ts` — `deleteByOwner`.
- `apps/server/src/dashboard/purge.service.ts` — public `terminateActiveForMember`.
- `apps/server/src/dashboard/dashboard-users.service.ts` — `delete` method (+ 2 injected deps).
- `apps/server/src/dashboard/dashboard-users.controller.ts` — `DELETE :id` route.
- `apps/admin/src/net/rest.ts` — `deleteUser`.
- `apps/admin/src/i18n/index.ts` — new keys in both locale tables.
- `apps/admin/src/views/UsersView.tsx` — delete button + confirm + handler.
- `apps/admin/src/views/UsersView.test.tsx` — two new tests.

---

## Task 1: Add the `users.delete` permission to `@trm/shared`

**Files:**
- Modify: `packages/shared/src/dashboard.ts`
- Test: `packages/shared/test/dashboard.spec.ts`

**Interfaces:**
- Produces: a new `DashboardPermission` literal `'users.delete'`, present in `ADMIN_PERMISSIONS` and `owner`'s set. Consumed by the server guard (`@RequirePermission('users.delete')`) and the admin UI (`hasPermission('users.delete')`) in later tasks.

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the existing `describe('dashboard permission taxonomy', ...)` in `packages/shared/test/dashboard.spec.ts` (after the `maps.read` test near the end):

```ts
  it('users.delete is admin-tier, above the moderator-tier users.ban', () => {
    expect(ROLE_PERMISSIONS.viewer).not.toContain('users.delete');
    expect(ROLE_PERMISSIONS.moderator).toContain('users.ban');
    expect(ROLE_PERMISSIONS.moderator).not.toContain('users.delete');
    expect(ROLE_PERMISSIONS.admin).toContain('users.delete');
    expect(ROLE_PERMISSIONS.owner).toContain('users.delete');
    expect(DASHBOARD_PERMISSIONS).toContain('users.delete');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: FAIL — the new `it` fails (e.g. `expected [ ... ] to contain 'users.delete'`), because `users.delete` doesn't exist yet.

- [ ] **Step 3: Add the permission**

In `packages/shared/src/dashboard.ts`, add `'users.delete'` to the `DASHBOARD_PERMISSIONS` array immediately after `'users.features'`:

```ts
  'users.read',
  'users.ban',
  'users.delete',
  'users.features',
```

Then add it to `ADMIN_PERMISSIONS` (after `'users.features'`):

```ts
const ADMIN_PERMISSIONS: readonly DashboardPermission[] = [
  ...MODERATOR_PERMISSIONS,
  'users.features',
  'users.delete',
  'maintainers.read',
  'audit.read',
  'games.delete',
  'rooms.delete',
  'purge.read',
  'purge.run',
  'maps.moderate',
];
```

(`owner: DASHBOARD_PERMISSIONS` picks it up automatically.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: PASS — all `dashboard permission taxonomy` tests green (the escalation-chain test still holds: `admin.size > moderator.size`, `owner === DASHBOARD_PERMISSIONS`).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dashboard.ts packages/shared/test/dashboard.spec.ts
git commit -m "feat(shared): add admin-tier users.delete dashboard permission"
```

---

## Task 2: Server DELETE endpoint (repos → purge → service → controller), driven by an e2e spec

This is one vertical slice: the e2e spec is the failing test; the implementation steps build bottom-up until it passes.

**Files:**
- Create: `apps/server/test/dashboard-delete-user.e2e.spec.ts`
- Modify: `apps/server/src/dashboard/audit.repo.ts`
- Modify: `apps/server/src/auth/user.repo.ts`
- Modify: `apps/server/src/maps/custom-map.repo.ts`
- Modify: `apps/server/src/dashboard/purge.service.ts`
- Modify: `apps/server/src/dashboard/dashboard-users.service.ts`
- Modify: `apps/server/src/dashboard/dashboard-users.controller.ts`

**Interfaces:**
- Consumes: `PurgeService` (private `terminateIfLive`, injected `rooms`), `RoomRepo.findActiveByMember`/`closeLobby`, `SessionRepo.revokeAllForUser`, `DashboardAccountRepo.findById`, `AuditService.log`, `ModerationReasonDto`.
- Produces:
  - `UserRepo.deleteById(userId: string): Promise<boolean>`
  - `CustomMapRepo.deleteByOwner(ownerId: string): Promise<number>`
  - `PurgeService.terminateActiveForMember(terminatedBy: string, userId: string, reason: string): Promise<{ gamesTerminated: number; roomsClosed: number }>`
  - `DashboardUsersService.delete(actor: AuthUser, userId: string, reason?: string): Promise<void>`
  - `DELETE /api/v1/dashboard/users/:id` → `204`.

- [ ] **Step 1: Write the failing e2e spec**

Create `apps/server/test/dashboard-delete-user.e2e.spec.ts`:

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
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

async function grant(userId: string, role: string) {
  await t.db.collection('dashboardAccounts').insertOne({
    _id: userId,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

let admin: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  admin = await registered('admin@example.com', 'Admin');
  await grant(admin.userId, 'admin');
}, 60_000);

afterAll(() => t.close());

describe('delete user', () => {
  it('hard-deletes an account: terminates its live game, closes its room, drops owned maps and sessions, keeps match history, audits', async () => {
    const victim = await registered('victim@example.com', 'Vic');

    // An owned custom-map draft (minimal doc — only ownerId matters to deleteByOwner).
    await t.db
      .collection('customMaps')
      .insertOne({ _id: 'cm-victim', ownerId: victim.userId, updatedAt: new Date() } as never);

    // A completed-game archive row referencing the victim — must survive the delete.
    await t.db
      .collection('matchHistory')
      .insertOne({ _id: 'mh-old', gameId: 'g-old', winners: [victim.userId], completedAt: new Date() } as never);

    // Put the victim in a LIVE game as host (mirrors dashboard-ban.e2e setup).
    const other = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Other' })
      .expect(201);
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(victim.token))
      .send({})
      .expect(201);
    const code = room.body.code as string;
    await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(other.body.accessToken))
      .expect(200);
    for (const tok of [victim.token, other.body.accessToken]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(tok))
        .send({ ready: true })
        .expect(200);
    }
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(victim.token)).expect(200);
    const roomDoc = (await t.db.collection('rooms').findOne({ _id: code })) as { gameId: string };
    const gameId = roomDoc.gameId;
    expect((await t.db.collection('games').findOne({ _id: gameId }))?.status).toBe('LIVE');

    // Delete.
    await request(server())
      .delete(`/api/v1/dashboard/users/${victim.userId}`)
      .set(auth(admin.token))
      .send({ reason: 'cleanup' })
      .expect(204);

    // The account is gone.
    expect(await t.db.collection('users').findOne({ _id: victim.userId })).toBeNull();
    await request(server())
      .get(`/api/v1/dashboard/users/${victim.userId}`)
      .set(auth(admin.token))
      .expect(404);

    // The live game was terminated and its room closed.
    expect((await t.db.collection('games').findOne({ _id: gameId }))?.status).toBe('TERMINATED');
    expect((await t.db.collection('rooms').findOne({ _id: code }))?.status).toBe('CLOSED');

    // Owned maps dropped; the archive kept.
    expect(await t.db.collection('customMaps').countDocuments({ ownerId: victim.userId } as never)).toBe(0);
    expect(await t.db.collection('matchHistory').countDocuments({ _id: 'mh-old' } as never)).toBe(1);

    // Audited with counts.
    const entry = await t.db
      .collection('dashboardAudit')
      .findOne({ action: 'user.delete', 'target.id': victim.userId } as never);
    expect(entry).toBeTruthy();
    expect((entry as { params: { gamesTerminated: number } }).params.gamesTerminated).toBe(1);
  }, 60_000);

  it('refuses self-delete (403) and deleting a maintainer (409)', async () => {
    await request(server())
      .delete(`/api/v1/dashboard/users/${admin.userId}`)
      .set(auth(admin.token))
      .send({})
      .expect(403);

    const peer = await registered('peer@example.com', 'Peer');
    await grant(peer.userId, 'viewer');
    await request(server())
      .delete(`/api/v1/dashboard/users/${peer.userId}`)
      .set(auth(admin.token))
      .send({})
      .expect(409);
  });

  it('a moderator (no users.delete) gets 403 on the delete route', async () => {
    const mod = await registered('mod@example.com', 'Mod');
    await grant(mod.userId, 'moderator');
    const target = await registered('target@example.com', 'Tg');
    await request(server())
      .delete(`/api/v1/dashboard/users/${target.userId}`)
      .set(auth(mod.token))
      .send({})
      .expect(403);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-delete-user`
Expected: FAIL — the `DELETE` route doesn't exist, so the first test gets `404` (not `204`). (`user.delete` is also not yet a valid audit action.)

- [ ] **Step 3: Add `'user.delete'` to the audit action union**

In `apps/server/src/dashboard/audit.repo.ts`, add the member after `'user.features'`:

```ts
export type DashboardAuditAction =
  | 'bootstrap.grant'
  | 'user.ban'
  | 'user.unban'
  | 'user.features'
  | 'user.delete'
  | 'game.terminate'
```

- [ ] **Step 4: Add `UserRepo.deleteById`**

In `apps/server/src/auth/user.repo.ts`, add this method (e.g. right after `clearDisabled`):

```ts
  /**
   * Hard-delete an account (dashboard `users.delete`). Session revocation and owned-map
   * cleanup are the caller's job; `matchHistory` is intentionally retained as the
   * anonymised archive — same posture as a TTL-expired guest.
   */
  async deleteById(userId: string): Promise<boolean> {
    const res = await this.col.deleteOne({ _id: userId });
    return res.deletedCount === 1;
  }
```

- [ ] **Step 5: Add `CustomMapRepo.deleteByOwner`**

In `apps/server/src/maps/custom-map.repo.ts`, add this method (e.g. right after `remove`):

```ts
  /**
   * Delete every draft owned by a user (account deletion). The immutable published
   * `mapContents` store is separate and untouched — past games/replays keep resolving.
   * Returns the number of drafts removed.
   */
  async deleteByOwner(ownerId: string): Promise<number> {
    const res = await this.col.deleteMany({ ownerId });
    return res.deletedCount;
  }
```

- [ ] **Step 6: Add `PurgeService.terminateActiveForMember`**

In `apps/server/src/dashboard/purge.service.ts`, add this **public** method (e.g. right after `deleteRoom`). It reuses the existing private `terminateIfLive` and the injected `rooms`:

```ts
  /**
   * Terminate every LIVE game and close every LOBBY room the user is currently seated in —
   * the teardown half of a maintainer account deletion. `findActiveByMember` already returns
   * only LOBBY rooms + STARTED rooms whose game is still LIVE. `terminateIfLive` also closes
   * the STARTED room (via `closeByGameId`), so a STARTED entry needs no extra close here.
   * Returns counts for the audit trail.
   */
  async terminateActiveForMember(
    terminatedBy: string,
    userId: string,
    reason: string,
  ): Promise<{ gamesTerminated: number; roomsClosed: number }> {
    const active = await this.rooms.findActiveByMember(userId, 100);
    let gamesTerminated = 0;
    let roomsClosed = 0;
    for (const room of active) {
      if (room.status === 'STARTED' && room.gameId) {
        await this.terminateIfLive(room.gameId, terminatedBy, reason);
        gamesTerminated++;
      } else if (room.status === 'LOBBY') {
        await this.rooms.closeLobby(room._id);
        roomsClosed++;
      }
    }
    return { gamesTerminated, roomsClosed };
  }
```

- [ ] **Step 7: Add `DashboardUsersService.delete` and inject its two new deps**

In `apps/server/src/dashboard/dashboard-users.service.ts`:

Add imports at the top (alongside the existing repo imports):

```ts
import { CustomMapRepo } from '../maps/custom-map.repo';
import { PurgeService } from './purge.service';
```

Add the two constructor parameters (append to the existing list):

```ts
  constructor(
    private readonly users: UserRepo,
    private readonly sessions: SessionRepo,
    private readonly rooms: RoomRepo,
    private readonly history: HistoryRepo,
    private readonly accounts: DashboardAccountRepo,
    private readonly audit: AuditService,
    private readonly maps: CustomMapRepo,
    private readonly purge: PurgeService,
  ) {}
```

Add the method (e.g. right after `enable`):

```ts
  /**
   * Hard-delete an account (dashboard `users.delete`). Force-terminates any LIVE game the
   * user is seated in and closes their rooms, revokes sessions, drops owned map drafts, then
   * removes the `users` doc. `matchHistory` + published `mapContents` are kept as the archive.
   * Refused while the target still holds dashboard access (mirrors the ban guard — keeps the
   * maintainer/owner lockout protections authoritative).
   */
  async delete(actor: AuthUser, userId: string, reason?: string) {
    if (userId === actor.userId) throw new ForbiddenException('you cannot delete yourself');
    const target = await this.users.findById(userId);
    if (!target) throw new NotFoundException('user not found');
    if (await this.accounts.findById(userId)) {
      throw new ConflictException('target holds dashboard access — revoke it first');
    }
    const { gamesTerminated, roomsClosed } = await this.purge.terminateActiveForMember(
      actor.userId,
      userId,
      reason ?? 'account deleted by a maintainer',
    );
    await this.sessions.revokeAllForUser(userId);
    await this.maps.deleteByOwner(userId);
    await this.users.deleteById(userId);
    await this.audit.log(
      actor,
      'user.delete',
      { type: 'user', id: userId },
      { ...(reason ? { reason } : {}), gamesTerminated, roomsClosed },
    );
  }
```

(`ForbiddenException`, `NotFoundException`, `ConflictException` are already imported in this file.)

- [ ] **Step 8: Add the `DELETE :id` controller route**

In `apps/server/src/dashboard/dashboard-users.controller.ts`:

Add `Delete` to the `@nestjs/common` import:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
```

Add the route (e.g. right after the `enable` handler, before `setFeatures`):

```ts
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('users.delete')
  @ApiOperation({
    summary: 'Permanently delete an account',
    description:
      'Irreversible. Terminates any LIVE game the user is seated in (no scores, not ' +
      'replayable) and closes their rooms, revokes all sessions, deletes their owned ' +
      'custom-map drafts, then removes the account. Completed-game match history and ' +
      'published map content are retained as an anonymised archive. Refused (409) while ' +
      'the target still holds dashboard access.',
  })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  @ApiResponse({ status: 204, description: 'Account deleted' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.users.delete(actor, id, body.reason);
  }
```

(`ModerationReasonSchema`, `ModerationReasonDto`, `apiSchema`, `ApiBody`, `ApiOperation`, `ApiResponse` are already imported.)

- [ ] **Step 9: Run the spec to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-delete-user`
Expected: PASS — all three tests green.

- [ ] **Step 10: Guard against regressions and type errors**

Run: `yarn workspace @trm/server test --run dashboard-ban` (the neighbouring ban/guard suite still passes) and `yarn workspace @trm/server typecheck`.
Expected: PASS / no type errors (the added constructor deps resolve — `CustomMapRepo` is exported by `MapsModule`, `PurgeService` is a `DashboardModule` provider, both already in scope).

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/dashboard/audit.repo.ts apps/server/src/auth/user.repo.ts apps/server/src/maps/custom-map.repo.ts apps/server/src/dashboard/purge.service.ts apps/server/src/dashboard/dashboard-users.service.ts apps/server/src/dashboard/dashboard-users.controller.ts apps/server/test/dashboard-delete-user.e2e.spec.ts
git commit -m "feat(server): DELETE dashboard/users/:id — hard-delete an account"
```

---

## Task 3: Admin SPA — delete button, REST client, i18n

**Files:**
- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/i18n/index.ts`
- Modify: `apps/admin/src/views/UsersView.tsx`
- Test: `apps/admin/src/views/UsersView.test.tsx`

**Interfaces:**
- Consumes: `DELETE /dashboard/users/:id` (Task 2), `users.delete` permission (Task 1), `ConfirmDialog`, `useSession().hasPermission`, `useToast().push`.
- Produces: `api.deleteUser(id: string, reason?: string): Promise<void>`; a `users.delete`-gated danger button in `UserDrawer`.

- [ ] **Step 1: Write the failing web tests**

Add this `describe` block to the end of `apps/admin/src/views/UsersView.test.tsx`:

```ts
describe('UsersView delete account', () => {
  it('hides the delete button without users.delete permission', async () => {
    stubFetch({
      '/dashboard/users/u1': { status: 200, body: USER_DETAIL },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(<UsersView />);
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    // Disable IS available (users.ban is in the default perms); delete is NOT.
    expect(within(drawer).getByText('停權')).toBeInTheDocument();
    expect(within(drawer).queryByText('刪除帳號')).toBeNull();
  });

  it('deletes a user: confirm issues DELETE and closes the drawer', async () => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'admin1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['users.read', 'users.ban', 'users.delete']),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'DELETE' && url.includes('/dashboard/users/u1')) {
          return new Response(null, { status: 204 });
        }
        if (url.includes('/dashboard/users/u1')) {
          return new Response(JSON.stringify(USER_DETAIL), { status: 200 });
        }
        if (url.includes('/dashboard/users?')) {
          return new Response(JSON.stringify({ users: [], nextCursor: null }), { status: 200 });
        }
        return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
      }),
    );
    render(
      <>
        <UsersView />
        <ToastStack />
      </>,
    );
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    fireEvent.click(within(drawer).getByText('刪除帳號'));
    const dialog = await screen.findByRole('dialog', { name: '永久刪除此帳號?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除帳號' }));

    expect(await screen.findByText('帳號已刪除')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alice' })).toBeNull());
    expect(
      vi.mocked(fetch).mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE'),
    ).toBe(true);
  });
});
```

Add `waitFor` to the testing-library import at the top of the file:

```ts
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/admin test --run UsersView`
Expected: FAIL — no `刪除帳號` button exists yet (first new test's `getByText('停權')` passes but the button assertions/second test fail; the second test can't find the delete button).

- [ ] **Step 3: Add the `deleteUser` REST call**

In `apps/admin/src/net/rest.ts`, add to the `api` object right after the `putUserFeatures` entry:

```ts
  deleteUser: (id: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/users/${encodeURIComponent(id)}`, { reason }),
```

- [ ] **Step 4: Add the i18n keys (both locale tables)**

In `apps/admin/src/i18n/index.ts`:

In the **zh-Hant** `toast` object, after `userUnbanned: '已解除停權',` add:

```ts
    userDeleted: '帳號已刪除',
```

In the **zh-Hant** `users` object, after the `disabledReason: '停權原因',` line add:

```ts
    delete: '刪除帳號',
    deleteConfirmTitle: '永久刪除此帳號?',
    deleteConfirmBody:
      '此操作無法復原。將終止此使用者所在的進行中對局(不計分、無法回放)並關閉其房間,撤銷所有登入工作階段,刪除其自訂地圖草稿,然後永久移除此帳號。已完成對局的紀錄與已發布的地圖內容會保留為封存。',
```

In the **zh-Hant** `perm` object, after `'users.ban': '停權使用者',` add:

```ts
    'users.delete': '刪除使用者',
```

In the **zh-Hant** `audit.action` object, after `'user.unban': '解除停權',` add:

```ts
      'user.delete': '刪除使用者',
```

Then the matching **en** entries:

In the **en** `toast` object, after `userUnbanned: 'Account re-enabled',` add:

```ts
    userDeleted: 'Account deleted',
```

In the **en** `users` object, after the `disabledReason: 'Reason',` line add:

```ts
    delete: 'Delete account',
    deleteConfirmTitle: 'Permanently delete this account?',
    deleteConfirmBody:
      'This cannot be undone. It terminates any in-progress game this user is seated in (no ' +
      'scores, not replayable) and closes their rooms, revokes all sessions, deletes their ' +
      'custom-map drafts, then permanently removes the account. Completed-game history and ' +
      'published map content are kept as an archive.',
```

In the **en** `perm` object, after `'users.ban': 'Ban users',` add:

```ts
    'users.delete': 'Delete users',
```

In the **en** `audit.action` object, after `'user.unban': 'Re-enabled user',` add:

```ts
      'user.delete': 'Deleted user',
```

- [ ] **Step 5: Add the delete button, confirm state, and handler to `UserDrawer`**

In `apps/admin/src/views/UsersView.tsx`:

Add the permission read next to `canBan` (near line 45):

```ts
  const canBan = useSession((s) => s.hasPermission('users.ban'));
  const canDelete = useSession((s) => s.hasPermission('users.delete'));
```

Add a confirm-state flag next to the existing `confirming` state (near line 49):

```ts
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
```

Add the delete handler right after the `toggleBan` function (after line 80). On success it unmounts the drawer via `onClose`, so it does not touch state afterward:

```ts
  const removeUser = async (reason?: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.deleteUser(detail.id, reason);
      pushToast('success', t('toast.userDeleted'));
      onClose();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
      setBusy(false);
      setConfirmingDelete(false);
    }
  };
```

Add the button block immediately after the existing `{canBan && !detail.isMaintainer && ( ... )}` section (after line 220):

```tsx
          {canDelete && !detail.isMaintainer && (
            <section>
              <button
                className="oc-btn danger"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                {t('users.delete')}
              </button>
            </section>
          )}
```

Add the confirm dialog immediately after the existing `{confirming && ( ... )}` block (after line 233):

```tsx
          {confirmingDelete && (
            <ConfirmDialog
              title={t('users.deleteConfirmTitle')}
              body={t('users.deleteConfirmBody')}
              confirmLabel={t('users.delete')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void removeUser(reason)}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace @trm/admin test --run UsersView`
Expected: PASS — the delete-button tests pass and the existing ban/columns/debounce tests stay green.

- [ ] **Step 7: Typecheck and lint the admin app**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/i18n/index.ts apps/admin/src/views/UsersView.tsx apps/admin/src/views/UsersView.test.tsx
git commit -m "feat(admin): delete-account button in the Users drawer"
```

---

## Task 4: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the affected workspaces' checks**

Run:
```bash
yarn workspace @trm/shared test --run
yarn workspace @trm/server test --run dashboard
yarn workspace @trm/admin test --run
yarn typecheck
yarn lint
```
Expected: all PASS / no errors. If anything fails, fix within the owning task's files and re-run before proceeding.

- [ ] **Step 2: Manual smoke (optional, if a dev stack is running)**

With `docker compose up -d mongo`, the server (`yarn workspace @trm/server dev`), and the admin app (`yarn workspace @trm/admin dev`): sign in as an owner/admin, open Users, open a non-maintainer account's drawer, confirm the **Delete account** button appears alongside **Disable**, and that deleting closes the drawer and removes the row on reload. Confirm the button is absent for a maintainer target and for a moderator-role dashboard account.

- [ ] **Step 3: No commit** (verification only; any fixes were committed under their task).

---

## Self-Review Notes

- **Spec coverage:** permission (Task 1) ✓; endpoint + service + force-through teardown + keep-archive + guards + audit (Task 2) ✓; repo helpers `deleteById`/`deleteByOwner` (Task 2) ✓; web button + rest client + i18n + labels (Task 3) ✓; server + web tests (Tasks 2–3) ✓; full verification (Task 4) ✓.
- **Type consistency:** `terminateActiveForMember(terminatedBy, userId, reason)` returns `{ gamesTerminated, roomsClosed }`, consumed verbatim by `DashboardUsersService.delete`; `deleteUser(id, reason?)` on the client matches `DELETE :id` + `ModerationReasonDto`; `users.delete` string identical across shared/server/admin.
- **No placeholders:** every code step shows the actual content.
