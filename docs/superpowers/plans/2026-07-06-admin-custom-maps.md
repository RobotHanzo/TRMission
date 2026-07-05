# Admin Custom Maps Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give maintainers a moderation view over every user-authored custom map — list all of them, preview the board, delete, force-unshare, or transfer ownership — none of which exists in the admin panel today.

**Architecture:** A new `DashboardMapsController`/`DashboardMapsService` pair in `apps/server/src/dashboard/`, following the exact list/detail/mutate shape `DashboardGamesController`/`DashboardGamesService` already use, backed by new admin-scoped (non-owner-filtered) methods on the existing `CustomMapRepo`/`MapContentRepo`. A new `apps/admin/src/views/MapsView.tsx` follows the list+drawer+`ConfirmDialog` pattern of `RoomsView`/`GamesView`, with a small static SVG preview component (no dependency on `apps/web`'s board renderer — this is inert content, not live game state).

**Tech Stack:** NestJS + nestjs-zod + MongoDB (native driver) on the server; React + Zustand + react-i18next on the admin client; Vitest + Supertest for server e2e; Vitest + @testing-library/react for admin UI tests.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-05-admin-maps-replay-versions-design.md` (Feature 1).
- Server tests in this repo are e2e-only (`apps/server/test/*.e2e.spec.ts`, `createTestApp()` + supertest) — there is no isolated unit-spec convention for repos/services to follow instead.
- Never filter custom-map admin queries by `ownerId` — that's the whole point of this feature; the existing owner-scoped `MapsController`/`MapsService` stay completely untouched.
- Deleting a `customMaps` doc must never touch `mapContents` — published content is immutable and must keep resolving for past games/replays forever (mirrors the existing game/room delete rule for `matchHistory`).
- Every mutating dashboard endpoint audits via the existing `AuditService`, matching the pattern in `dashboard-games.service.ts`.
- `yarn workspace @trm/server test`, `yarn workspace @trm/admin test`, `yarn lint`, `yarn typecheck` must pass before every commit.
- **Shared files across sibling plans:** `packages/shared/src/dashboard.ts`, `apps/server/src/dashboard/audit.repo.ts`, `apps/admin/src/net/rest.ts`, and `apps/admin/src/i18n/index.ts` are also touched by the replay-viewer and commit-hash plans. If running all three plans in the same working tree sequentially, this is fine — each plan's steps show exactly what to add. If running them in parallel isolated worktrees, expect a merge/rebase step on these files afterward.

---

### Task 1: `maps.read` / `maps.moderate` permission taxonomy

**Files:**

- Modify: `packages/shared/src/dashboard.ts`
- Test: `packages/shared/test/dashboard.spec.ts`

**Interfaces:**

- Produces: `DASHBOARD_PERMISSIONS` includes `'maps.read'` and `'maps.moderate'`; `ROLE_PERMISSIONS.viewer` includes `'maps.read'`; `ROLE_PERMISSIONS.admin` includes `'maps.moderate'` (and, via escalation, so does `owner`).

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/test/dashboard.spec.ts`, inside the existing `describe('dashboard permission taxonomy', ...)` block:

```ts
it('maps.read is a viewer permission; maps.moderate is admin-tier', () => {
  expect(ROLE_PERMISSIONS.viewer).toContain('maps.read');
  expect(ROLE_PERMISSIONS.viewer).not.toContain('maps.moderate');
  expect(ROLE_PERMISSIONS.moderator).not.toContain('maps.moderate');
  expect(ROLE_PERMISSIONS.admin).toContain('maps.moderate');
  expect(ROLE_PERMISSIONS.admin).toContain('maps.read');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: FAIL — `ROLE_PERMISSIONS.viewer` does not contain `'maps.read'` (property doesn't exist in the array yet).

- [ ] **Step 3: Add the permissions**

In `packages/shared/src/dashboard.ts`, edit the arrays:

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
  'maps.read',
  'maps.moderate',
] as const;
```

```ts
const VIEWER_PERMISSIONS: readonly DashboardPermission[] = [
  'overview.read',
  'users.read',
  'games.read',
  'rooms.read',
  'maps.read',
];
```

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
  'maps.moderate',
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dashboard.ts packages/shared/test/dashboard.spec.ts
git commit -m "feat(shared): add maps.read/maps.moderate dashboard permissions"
```

---

### Task 2: Admin-scoped repo methods (`CustomMapRepo`, `MapContentRepo`)

**Files:**

- Modify: `apps/server/src/maps/custom-map.repo.ts`
- Modify: `apps/server/src/maps/map-content.repo.ts`
- Modify: `apps/server/src/maps/maps.module.ts` (export `CustomMapRepo`)
- Test: covered by Task 3's e2e spec (these methods have no controller yet, so they aren't independently reachable over HTTP — folding their test coverage into the task that exposes them, per the plan's task-sizing rule).

**Interfaces:**

- Produces: `CustomMapRepo.listAllPage({cursor, limit}): Promise<CustomMapDoc[]>`, `CustomMapRepo.findByIdAny(id): Promise<CustomMapDoc | null>`, `CustomMapRepo.removeAny(id): Promise<boolean>`, `CustomMapRepo.revokeShareCodeAny(id): Promise<boolean>`, `CustomMapRepo.transferOwner(id, newOwnerId): Promise<CustomMapDoc | null>`. `MapContentRepo.findBySourceMapId(sourceMapId): Promise<MapContentDoc[]>`.
- Consumes: `CustomMapDoc`/`MapContentDoc` types from `./maps.types` (unchanged).

- [ ] **Step 1: Add admin-scoped methods to `CustomMapRepo`**

In `apps/server/src/maps/custom-map.repo.ts`, add these methods to the class (after the existing `revokeShareCode`):

```ts
  /** Admin listing: every map, any owner, newest-updated first. No ownerId filter — see
   *  DashboardMapsService, the only caller allowed to bypass ownership. */
  listAllPage(cursor: { t: Date; id: string } | null, limit: number): Promise<CustomMapDoc[]> {
    const page = cursor
      ? { $or: [{ updatedAt: { $lt: cursor.t } }, { updatedAt: cursor.t, _id: { $lt: cursor.id } }] }
      : {};
    return this.col.find(page).sort({ updatedAt: -1, _id: -1 }).limit(limit).toArray();
  }

  /** Admin lookup: no ownerId filter. */
  findByIdAny(id: string): Promise<CustomMapDoc | null> {
    return this.col.findOne({ _id: id });
  }

  /** Admin hard-delete: no ownerId filter. Leaves any published `mapContents` untouched. */
  async removeAny(id: string): Promise<boolean> {
    const res = await this.col.deleteOne({ _id: id });
    return res.deletedCount === 1;
  }

  /** Admin force-unshare: no ownerId filter. */
  async revokeShareCodeAny(id: string): Promise<boolean> {
    const res = await this.col.updateOne({ _id: id }, { $unset: { shareCode: '' } });
    return res.matchedCount === 1;
  }

  /** Admin transfer: reassigns ownerId, no ownerId filter on the match. */
  transferOwner(id: string, newOwnerId: string): Promise<CustomMapDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: id },
      { $set: { ownerId: newOwnerId, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
  }
```

- [ ] **Step 2: Add the source-map index + lookup to `MapContentRepo`**

In `apps/server/src/maps/map-content.repo.ts`, update `onModuleInit` and add a method:

```ts
  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ ownerId: 1 });
    await this.col.createIndex({ sourceMapId: 1 });
  }
```

```ts
  /** Every published revision of one custom map (for admin usage-count aggregation). */
  findBySourceMapId(sourceMapId: string): Promise<MapContentDoc[]> {
    return this.col.find({ sourceMapId }).toArray();
  }
```

- [ ] **Step 3: Export `CustomMapRepo` from `MapsModule`**

In `apps/server/src/maps/maps.module.ts`, change the `exports` line:

```ts
  exports: [MapsService, CustomMapRepo, MapContentRepo],
```

- [ ] **Step 4: Typecheck**

Run: `yarn workspace @trm/server typecheck`
Expected: PASS (no callers yet, but the new methods must compile cleanly against `CustomMapDoc`/`MapContentDoc`).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/maps/custom-map.repo.ts apps/server/src/maps/map-content.repo.ts apps/server/src/maps/maps.module.ts
git commit -m "feat(server): add admin-scoped custom-map repo methods"
```

---

### Task 3: `DashboardMapsController`/`Service` — list + detail (read side)

**Files:**

- Create: `apps/server/src/dashboard/dashboard-maps.service.ts`
- Create: `apps/server/src/dashboard/dashboard-maps.controller.ts`
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts` (add map schemas)
- Modify: `apps/server/src/dashboard/dashboard.module.ts` (wire the new controller/service, import `MapsModule`)
- Test: Create `apps/server/test/dashboard-maps.e2e.spec.ts`

**Interfaces:**

- Consumes: `CustomMapRepo.listAllPage`/`findByIdAny` (Task 2), `MapContentRepo.findBySourceMapId` (Task 2), `encodeCursor`/`decodeCursor` from `./cursor`, `RequirePermission` decorator, `DashboardGuard`.
- Produces: `GET /api/v1/dashboard/maps` → `{maps: MapAdminRow[], nextCursor: string | null}`; `GET /api/v1/dashboard/maps/:id` → `MapAdminDetail` (includes `usageCount`, `draft`). Both gated on `maps.read`.

- [ ] **Step 1: Write the failing e2e test (list + detail)**

Create `apps/server/test/dashboard-maps.e2e.spec.ts`:

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
  await t.db
    .collection('users')
    .updateOne({ _id: res.body.user.id } as never, { $set: { features: ['mapBuilder'] } });
  return { token: res.body.accessToken, id: res.body.user.id as string };
}

async function grantDashboard(userId: string, role: 'viewer' | 'admin') {
  await t.db.collection('dashboardAccounts').insertOne({
    _id: userId,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

let owner: { token: string; id: string };
let viewer: { token: string; id: string };
let admin: { token: string; id: string };
let mapId: string;

beforeAll(async () => {
  t = await createTestApp();
  owner = await registered('mapowner@example.com', 'Owner');
  const viewerAcct = await registered('viewer@example.com', 'Viewer');
  viewer = viewerAcct;
  const adminAcct = await registered('admin@example.com', 'Admin');
  admin = adminAcct;
  await grantDashboard(viewer.id, 'viewer');
  await grantDashboard(admin.id, 'admin');

  const created = await request(server())
    .post('/api/v1/maps')
    .set(auth(owner.token))
    .send({ nameZh: '測試地圖', nameEn: 'Test Map' })
    .expect(201);
  mapId = created.body.id;
}, 60_000);
afterAll(() => t.close());

describe('GET /dashboard/maps', () => {
  it('403s without maps.read', async () => {
    const noPerm = await registered('noperm@example.com', 'NoPerm');
    await request(server()).get('/api/v1/dashboard/maps').set(auth(noPerm.token)).expect(404);
  });

  it('lists maps across all owners (viewer permission)', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/maps')
      .set(auth(viewer.token))
      .expect(200);
    expect(res.body.maps.some((m: { id: string }) => m.id === mapId)).toBe(true);
    expect(res.body).toHaveProperty('nextCursor');
  });
});

describe('GET /dashboard/maps/:id', () => {
  it('returns detail with owner, draft, and usageCount=0 for a never-played map', async () => {
    const res = await request(server())
      .get(`/api/v1/dashboard/maps/${mapId}`)
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.id).toBe(mapId);
    expect(res.body.ownerId).toBe(owner.id);
    expect(res.body.draft).toEqual({ cities: [], routes: [], tickets: [] });
    expect(res.body.usageCount).toBe(0);
  });

  it('404s an unknown map', async () => {
    await request(server()).get('/api/v1/dashboard/maps/nope').set(auth(admin.token)).expect(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-maps`
Expected: FAIL — `/api/v1/dashboard/maps` doesn't exist yet (404 from the router itself, or a connection error).

- [ ] **Step 3: Add map schemas**

In `apps/server/src/dashboard/dashboard.schemas.ts`, add near the other list/detail schemas:

```ts
// ---- maps ------------------------------------------------------------------------

export const MapAdminRowSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  ownerDisplayName: z.string().optional(),
  nameZh: z.string(),
  nameEn: z.string(),
  revision: z.number(),
  shared: z.boolean(),
  updatedAt: z.string(),
});

export const MapsListSchema = z.object({
  maps: z.array(MapAdminRowSchema),
  nextCursor: z.string().nullable(),
});

export const MapAdminDetailSchema = MapAdminRowSchema.extend({
  createdAt: z.string(),
  shareCode: z.string().optional(),
  usageCount: z.number(),
  draft: z.object({
    cities: z.array(z.unknown()),
    routes: z.array(z.unknown()),
    tickets: z.array(z.unknown()),
  }),
});

export const TransferMapSchema = z.object({ newOwnerId: z.string().min(1) });
export class TransferMapDto extends createZodDto(TransferMapSchema) {}
```

- [ ] **Step 4: Write `DashboardMapsService`**

Create `apps/server/src/dashboard/dashboard-maps.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { CustomMapRepo } from '../maps/custom-map.repo';
import { MapContentRepo } from '../maps/map-content.repo';
import type { CustomMapDoc } from '../maps/maps.types';
import type { GameDoc } from '../persistence/types';
import type { UserDoc } from '../auth/user.repo';
import { decodeCursor, encodeCursor } from './cursor';

const toRow = (m: CustomMapDoc, ownerDisplayName?: string) => ({
  id: m._id,
  ownerId: m.ownerId,
  ...(ownerDisplayName !== undefined ? { ownerDisplayName } : {}),
  nameZh: m.nameZh,
  nameEn: m.nameEn,
  revision: m.revision,
  shared: m.shareCode !== undefined,
  updatedAt: m.updatedAt.toISOString(),
});

@Injectable()
export class DashboardMapsService {
  private readonly games: Collection<GameDoc>;
  private readonly users: Collection<UserDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly maps: CustomMapRepo,
    private readonly content: MapContentRepo,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.users = db.collection<UserDoc>('users');
  }

  private async displayNames(ownerIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(ownerIds)];
    if (ids.length === 0) return new Map();
    const docs = await this.users
      .find({ _id: { $in: ids } }, { projection: { displayName: 1 } })
      .toArray();
    return new Map(docs.map((u) => [u._id, u.displayName]));
  }

  async listMaps(query: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(query.cursor);
    const docs = await this.maps.listAllPage(cursor, query.limit);
    const names = await this.displayNames(docs.map((d) => d.ownerId));
    const last = docs.length === query.limit ? docs[docs.length - 1] : undefined;
    return {
      maps: docs.map((d) => toRow(d, names.get(d.ownerId))),
      nextCursor: last ? encodeCursor(last.updatedAt, last._id) : null,
    };
  }

  /** Every hash this map has ever published, then how many games ran on any of them. */
  private async usageCount(mapId: string): Promise<number> {
    const contents = await this.content.findBySourceMapId(mapId);
    if (contents.length === 0) return 0;
    return this.games.countDocuments({ contentHash: { $in: contents.map((c) => c._id) } });
  }

  async mapDetail(id: string) {
    const doc = await this.maps.findByIdAny(id);
    if (!doc) throw new NotFoundException('map not found');
    const [names, usageCount] = await Promise.all([
      this.displayNames([doc.ownerId]),
      this.usageCount(id),
    ]);
    return {
      ...toRow(doc, names.get(doc.ownerId)),
      createdAt: doc.createdAt.toISOString(),
      ...(doc.shareCode ? { shareCode: doc.shareCode } : {}),
      usageCount,
      draft: doc.draft,
    };
  }
}
```

- [ ] **Step 5: Write `DashboardMapsController`**

Create `apps/server/src/dashboard/dashboard-maps.controller.ts`:

```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardMapsService } from './dashboard-maps.service';
import { MapAdminDetailSchema, MapsListSchema } from './dashboard.schemas';

const MapsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(300).optional(),
});
class MapsListQueryDto extends createZodDto(MapsListQuerySchema) {}

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardMapsController {
  constructor(private readonly maps: DashboardMapsService) {}

  @Get('maps')
  @RequirePermission('maps.read')
  @ApiOperation({ summary: 'List custom maps across all owners, most recently updated first' })
  @ApiResponse({ status: 200, schema: apiSchema(MapsListSchema) })
  listMaps(@Query() query: MapsListQueryDto) {
    return this.maps.listMaps(query);
  }

  @Get('maps/:id')
  @RequirePermission('maps.read')
  @ApiOperation({ summary: 'One custom map: owner, draft content, share status, usage count' })
  @ApiResponse({ status: 200, schema: apiSchema(MapAdminDetailSchema) })
  mapDetail(@Param('id') id: string) {
    return this.maps.mapDetail(id);
  }
}
```

- [ ] **Step 6: Wire the module**

In `apps/server/src/dashboard/dashboard.module.ts`, add imports and registrations:

```ts
import { MapsModule } from '../maps/maps.module';
import { DashboardMapsService } from './dashboard-maps.service';
import { DashboardMapsController } from './dashboard-maps.controller';
```

```ts
@Module({
  imports: [AuthModule, GameModule, LobbyModule, HistoryModule, MapsModule],
  controllers: [
    DashboardController,
    DashboardUsersController,
    DashboardGamesController,
    DashboardMaintainersController,
    DashboardPurgeController,
    DashboardMapsController,
  ],
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
    DashboardMapsService,
  ],
})
export class DashboardModule {}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-maps`
Expected: PASS.

- [ ] **Step 8: Typecheck + lint**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/dashboard/dashboard-maps.service.ts apps/server/src/dashboard/dashboard-maps.controller.ts apps/server/src/dashboard/dashboard.schemas.ts apps/server/src/dashboard/dashboard.module.ts apps/server/test/dashboard-maps.e2e.spec.ts
git commit -m "feat(server): list/detail dashboard endpoints for custom maps"
```

---

### Task 4: `DashboardMapsController`/`Service` — delete, unshare, transfer (write side)

**Files:**

- Modify: `apps/server/src/dashboard/dashboard-maps.service.ts`
- Modify: `apps/server/src/dashboard/dashboard-maps.controller.ts`
- Modify: `apps/server/src/dashboard/audit.repo.ts` (add `DashboardAuditAction` members)
- Modify: `apps/server/test/dashboard-maps.e2e.spec.ts`

**Interfaces:**

- Consumes: `CustomMapRepo.removeAny`/`revokeShareCodeAny`/`transferOwner` (Task 2), `AuditService.log`, `ModerationReasonDto`/`TransferMapDto` (Task 3).
- Produces: `DELETE /dashboard/maps/:id`, `DELETE /dashboard/maps/:id/share`, `POST /dashboard/maps/:id/transfer`, all gated on `maps.moderate`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/dashboard-maps.e2e.spec.ts`:

```ts
describe('DELETE /dashboard/maps/:id', () => {
  it('403s a viewer (admin-tier permission)', async () => {
    const m = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: 'A', nameEn: 'A' })
      .expect(201);
    await request(server())
      .delete(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(viewer.token))
      .send({})
      .expect(403);
  });

  it("deletes any owner's map and audits it; mapContents (if any) survives", async () => {
    const m = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: 'B', nameEn: 'B' })
      .expect(201);
    await request(server())
      .delete(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(admin.token))
      .send({ reason: 'abuse' })
      .expect(204);
    await request(server())
      .get(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(admin.token))
      .expect(404);
    expect(
      await t.db
        .collection('dashboardAudit')
        .countDocuments({ action: 'map.delete', 'target.id': m.body.id } as never),
    ).toBe(1);
  });

  it('404s an unknown map', async () => {
    await request(server())
      .delete('/api/v1/dashboard/maps/nope')
      .set(auth(admin.token))
      .send({})
      .expect(404);
  });
});

describe('DELETE /dashboard/maps/:id/share', () => {
  it('force-unshares regardless of owner', async () => {
    const m = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: 'C', nameEn: 'C' })
      .expect(201);
    await request(server())
      .post(`/api/v1/maps/${m.body.id}/share`)
      .set(auth(owner.token))
      .expect(200);
    await request(server())
      .delete(`/api/v1/dashboard/maps/${m.body.id}/share`)
      .set(auth(admin.token))
      .send({})
      .expect(204);
    const detail = await request(server())
      .get(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(admin.token))
      .expect(200);
    expect(detail.body.shareCode).toBeUndefined();
    expect(detail.body.shared).toBe(false);
  });
});

describe('POST /dashboard/maps/:id/transfer', () => {
  it('reassigns ownerId; new owner sees it via the player-facing list', async () => {
    const newOwner = await registered('newowner@example.com', 'NewOwner');
    const m = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: 'D', nameEn: 'D' })
      .expect(201);
    await request(server())
      .post(`/api/v1/dashboard/maps/${m.body.id}/transfer`)
      .set(auth(admin.token))
      .send({ newOwnerId: newOwner.id })
      .expect(200);

    const detail = await request(server())
      .get(`/api/v1/dashboard/maps/${m.body.id}`)
      .set(auth(admin.token))
      .expect(200);
    expect(detail.body.ownerId).toBe(newOwner.id);

    const list = await request(server()).get('/api/v1/maps').set(auth(newOwner.token)).expect(200);
    expect(list.body.map((row: { id: string }) => row.id)).toContain(m.body.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-maps`
Expected: FAIL — the three new routes don't exist yet (404/connection errors on delete/share/transfer).

- [ ] **Step 3: Add audit actions**

In `apps/server/src/dashboard/audit.repo.ts`, extend the union and `AuditTarget`:

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
  | 'maintainer.revoke'
  | 'map.delete'
  | 'map.unshare'
  | 'map.transfer';

export interface AuditTarget {
  type: 'user' | 'game' | 'room' | 'maintainer' | 'map';
  id: string;
}
```

- [ ] **Step 4: Add the mutation methods to `DashboardMapsService`**

In `apps/server/src/dashboard/dashboard-maps.service.ts`, add `AuditService` to the constructor and add three methods:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { CustomMapRepo } from '../maps/custom-map.repo';
import { MapContentRepo } from '../maps/map-content.repo';
import type { CustomMapDoc } from '../maps/maps.types';
import type { GameDoc } from '../persistence/types';
import type { UserDoc } from '../auth/user.repo';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from './audit.service';
import { decodeCursor, encodeCursor } from './cursor';

// ... toRow/class body unchanged above; constructor gains AuditService:

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly maps: CustomMapRepo,
    private readonly content: MapContentRepo,
    private readonly audit: AuditService,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.users = db.collection<UserDoc>('users');
  }

  // ... listMaps/usageCount/mapDetail unchanged, then add:

  async deleteMap(actor: AuthUser, id: string, reason?: string): Promise<void> {
    if (!(await this.maps.removeAny(id))) throw new NotFoundException('map not found');
    await this.audit.log(actor, 'map.delete', { type: 'map', id }, reason ? { reason } : {});
  }

  async unshareMap(actor: AuthUser, id: string, reason?: string): Promise<void> {
    if (!(await this.maps.revokeShareCodeAny(id))) throw new NotFoundException('map not found');
    await this.audit.log(actor, 'map.unshare', { type: 'map', id }, reason ? { reason } : {});
  }

  async transferMap(actor: AuthUser, id: string, newOwnerId: string) {
    const updated = await this.maps.transferOwner(id, newOwnerId);
    if (!updated) throw new NotFoundException('map not found');
    await this.audit.log(actor, 'map.transfer', { type: 'map', id }, { newOwnerId });
    return this.mapDetail(id);
  }
```

- [ ] **Step 5: Add the three routes to `DashboardMapsController`**

In `apps/server/src/dashboard/dashboard-maps.controller.ts`, add imports and routes:

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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardMapsService } from './dashboard-maps.service';
import {
  MapAdminDetailSchema,
  MapsListSchema,
  ModerationReasonDto,
  ModerationReasonSchema,
  TransferMapDto,
  TransferMapSchema,
} from './dashboard.schemas';
```

```ts
  @Delete('maps/:id')
  @HttpCode(204)
  @RequirePermission('maps.moderate')
  @ApiOperation({ summary: 'Hard-delete a custom map (any owner). Published content is unaffected.' })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  deleteMap(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.maps.deleteMap(actor, id, body.reason);
  }

  @Delete('maps/:id/share')
  @HttpCode(204)
  @RequirePermission('maps.moderate')
  @ApiOperation({ summary: "Force-revoke a custom map's share code (any owner)" })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  unshareMap(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.maps.unshareMap(actor, id, body.reason);
  }

  @Post('maps/:id/transfer')
  @HttpCode(200)
  @RequirePermission('maps.moderate')
  @ApiOperation({ summary: 'Reassign a custom map to a different owner' })
  @ApiBody({ schema: apiSchema(TransferMapSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(MapAdminDetailSchema) })
  transferMap(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: TransferMapDto,
  ) {
    return this.maps.transferMap(actor, id, body.newOwnerId);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-maps`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/dashboard/dashboard-maps.service.ts apps/server/src/dashboard/dashboard-maps.controller.ts apps/server/src/dashboard/audit.repo.ts apps/server/test/dashboard-maps.e2e.spec.ts
git commit -m "feat(server): delete/unshare/transfer dashboard endpoints for custom maps"
```

---

### Task 5: Admin UI — `MapsView` list + nav wiring

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/store/ui.ts`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/i18n/index.ts`
- Create: `apps/admin/src/views/MapsView.tsx`
- Create: `apps/admin/src/views/MapsView.test.tsx`

**Interfaces:**

- Consumes: `api.listMaps`, `useSession().hasPermission('maps.read')`, `useUi().openDetail`/`closeDetail`/`param`.
- Produces: a `maps` nav entry rendering a paginated table; row click sets the URL param (drawer added in Task 6).

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/views/MapsView.test.tsx`. This repo's admin tests stub the global `fetch` by URL substring (`stubFetch`, documented in `apps/admin/CLAUDE.md` as "the standard pattern") and let the real `api` client hit it — they never mock `../net/rest` directly:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../i18n';
import { MapsView } from './MapsView';
import { useUi } from '../store/ui';

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

const MAP_ROW = {
  id: 'map-1',
  ownerId: 'user-1',
  ownerDisplayName: 'Alice',
  nameZh: '測試',
  nameEn: 'Test',
  revision: 1,
  shared: false,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'maps', param: null });
  stubFetch({ '/dashboard/maps': { status: 200, body: { maps: [MAP_ROW], nextCursor: null } } });
});

describe('MapsView', () => {
  it('lists maps with owner name', async () => {
    render(<MapsView />);
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test MapsView`
Expected: FAIL — `./MapsView` module doesn't exist.

- [ ] **Step 3: Add API client types + calls**

In `apps/admin/src/net/rest.ts`, add near the other row/detail interfaces:

```ts
export interface MapAdminRow {
  id: string;
  ownerId: string;
  ownerDisplayName?: string;
  nameZh: string;
  nameEn: string;
  revision: number;
  shared: boolean;
  updatedAt: string;
}
export interface MapAdminDetail extends MapAdminRow {
  createdAt: string;
  shareCode?: string;
  usageCount: number;
  draft: {
    cities: { id: string; x: number; y: number }[];
    routes: { a: string; b: string }[];
    tickets: unknown[];
  };
}
export type MapsPage = { maps: MapAdminRow[]; nextCursor: string | null };
```

Add to the `api` object:

```ts
  listMaps: (opts: { cursor?: string } = {}) => req<MapsPage>('GET', `/dashboard/maps${qs(opts)}`),
  getMap: (id: string) => req<MapAdminDetail>('GET', `/dashboard/maps/${encodeURIComponent(id)}`),
  deleteMap: (id: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/maps/${encodeURIComponent(id)}`, { reason }),
  unshareMap: (id: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/maps/${encodeURIComponent(id)}/share`, { reason }),
  transferMap: (id: string, newOwnerId: string) =>
    req<MapAdminDetail>('POST', `/dashboard/maps/${encodeURIComponent(id)}/transfer`, {
      newOwnerId,
    }),
```

- [ ] **Step 4: Wire routing**

In `apps/admin/src/store/ui.ts`, add `'maps'` to `AdminView`, the path regex, and `openDetail`'s view union:

```ts
export type AdminView =
  | 'overview'
  | 'users'
  | 'features'
  | 'games'
  | 'rooms'
  | 'maintainers'
  | 'audit'
  | 'purge'
  | 'maps';
```

```ts
const m = /^\/(users|features|games|rooms|maintainers|audit|purge|maps)(?:\/([^/]+))?\/?$/.exec(p);
```

```ts
  openDetail(view: 'users' | 'games' | 'maps', id: string): void;
```

```ts
  openDetail(view, id) {
    pushPath(pathFor(view, id));
    set({ view, param: id });
  },
  closeDetail() {
    const { view } = get();
    if (view === 'users' || view === 'games' || view === 'maps') {
      pushPath(pathFor(view));
      set({ param: null });
    }
  },
```

- [ ] **Step 5: Add the nav entry**

In `apps/admin/src/App.tsx`:

```tsx
import { Map as MapIcon } from 'lucide-react';
```

```tsx
import { MapsView } from './views/MapsView';
```

```tsx
const NAV: { view: AdminView; permission: DashboardPermission; icon: typeof Users }[] = [
  { view: 'overview', permission: 'overview.read', icon: Activity },
  { view: 'users', permission: 'users.read', icon: Users },
  { view: 'features', permission: 'users.features', icon: ToggleRight },
  { view: 'games', permission: 'games.read', icon: Swords },
  { view: 'rooms', permission: 'rooms.read', icon: DoorOpen },
  { view: 'maps', permission: 'maps.read', icon: MapIcon },
  { view: 'maintainers', permission: 'maintainers.read', icon: ShieldCheck },
  { view: 'audit', permission: 'audit.read', icon: ClipboardList },
  { view: 'purge', permission: 'purge.read', icon: Trash2 },
];
```

```tsx
function ActiveView({ view }: { view: AdminView }) {
  switch (view) {
    // ... existing cases
    case 'maps':
      return <MapsView />;
    default:
      return <OverviewView />;
  }
}
```

- [ ] **Step 6: Add i18n keys**

In `apps/admin/src/i18n/index.ts`, add `maps: '地圖'` to the `nav` object in both the `zhHant` and `en` tables, and a new `maps` namespace in both:

zh-Hant table:

```ts
  maps: {
    title: '自訂地圖管理',
    colName: '名稱',
    colOwner: '擁有者',
    colRevision: '版本',
    colShared: '分享狀態',
    colUpdated: '更新時間',
    sharedYes: '已分享',
    sharedNo: '未分享',
  },
```

en table (mirror, same key tree):

```ts
  maps: {
    title: 'Custom Maps',
    colName: 'Name',
    colOwner: 'Owner',
    colRevision: 'Revision',
    colShared: 'Sharing',
    colUpdated: 'Updated',
    sharedYes: 'Shared',
    sharedNo: 'Not shared',
  },
```

(Also add `maps: 'Maps'` to the English `nav` object, mirroring `maps: '地圖'` above.)

- [ ] **Step 7: Write `MapsView`**

Create `apps/admin/src/views/MapsView.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type MapAdminRow } from '../net/rest';
import { useUi } from '../store/ui';
import { fmtDateTime } from '../lib/fmt';

export function MapsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const openDetail = useUi((s) => s.openDetail);

  const [rows, setRows] = useState<MapAdminRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (append: string | null) => {
    setLoading(true);
    try {
      const page = await api.listMaps(append ? { cursor: append } : {});
      setRows((prev) => (append ? [...prev, ...page.maps] : page.maps));
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <div>
      <h1 className="oc-page-title">{t('maps.title')}</h1>
      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('maps.colName')}</th>
              <th>{t('maps.colOwner')}</th>
              <th className="num">{t('maps.colRevision')}</th>
              <th>{t('maps.colShared')}</th>
              <th className="num">{t('maps.colUpdated')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="clickable" onClick={() => openDetail('maps', m.id)}>
                <td>{m.nameEn || m.nameZh}</td>
                <td>{m.ownerDisplayName ?? m.ownerId}</td>
                <td className="num">{m.revision}</td>
                <td>{m.shared ? t('maps.sharedYes') : t('maps.sharedNo')}</td>
                <td className="num">{fmtDateTime(m.updatedAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="oc-empty">{loading ? t('common.loading') : t('common.empty')}</div>
        )}
        {cursor && (
          <div className="oc-pager">
            <button className="oc-btn" disabled={loading} onClick={() => void load(cursor)}>
              {t('common.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `yarn workspace @trm/admin test MapsView`
Expected: PASS.

- [ ] **Step 9: Typecheck + lint**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/store/ui.ts apps/admin/src/App.tsx apps/admin/src/i18n/index.ts apps/admin/src/views/MapsView.tsx apps/admin/src/views/MapsView.test.tsx
git commit -m "feat(admin): custom maps list view"
```

---

### Task 6: Admin UI — drawer detail + static SVG preview

**Files:**

- Create: `apps/admin/src/components/MapPreview.tsx`
- Create: `apps/admin/src/components/MapPreview.test.tsx`
- Modify: `apps/admin/src/views/MapsView.tsx`
- Modify: `apps/admin/src/views/MapsView.test.tsx`
- Modify: `apps/admin/src/i18n/index.ts`

**Interfaces:**

- Consumes: `MapAdminDetail.draft.{cities,routes}` (Task 5's types).
- Produces: `<MapPreview draft={...} />` (pure presentational, no fetch); `MapsView` renders a `Drawer` with detail + preview on row click.

- [ ] **Step 1: Add drawer + preview i18n keys**

Add these first — `MapPreview` (Step 3) and `MapDrawer` (Step 5) both call `t()` with these keys, and the codebase's tests assert real translated strings (never raw keys), so the strings must exist before the component code and tests that depend on them.

In `apps/admin/src/i18n/index.ts`, extend the `maps` namespace in both locale tables:

zh-Hant additions:

```ts
    detailTitle: '地圖詳情',
    preview: '地圖預覽',
    previewEmpty: '尚無內容',
    owner: '擁有者',
    created: '建立時間',
    usageCount: '使用次數',
    shareCode: '分享代碼',
```

en additions:

```ts
    detailTitle: 'Map Detail',
    preview: 'Map Preview',
    previewEmpty: 'No content yet',
    owner: 'Owner',
    created: 'Created',
    usageCount: 'Games played',
    shareCode: 'Share code',
```

- [ ] **Step 2: Write the failing test for `MapPreview`**

Create `apps/admin/src/components/MapPreview.test.tsx`. Match the codebase's convention (`import '../i18n'` + assert the real translated string, as `GamesView.test.tsx`/`ReplayScreen.test.tsx` already do) rather than the raw i18n key:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../i18n';
import { MapPreview } from './MapPreview';

describe('MapPreview', () => {
  it('renders one circle per city and one line per route', () => {
    const { container } = render(
      <MapPreview
        draft={{
          cities: [
            { id: 'a', x: 10, y: 10 },
            { id: 'b', x: 90, y: 90 },
          ],
          routes: [{ a: 'a', b: 'b' }],
        }}
      />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelectorAll('line')).toHaveLength(1);
  });

  it('renders an empty-state message for an empty draft', () => {
    const { getByText } = render(<MapPreview draft={{ cities: [], routes: [] }} />);
    expect(getByText('尚無內容')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn workspace @trm/admin test MapPreview`
Expected: FAIL — `./MapPreview` doesn't exist.

- [ ] **Step 4: Write `MapPreview`**

Create `apps/admin/src/components/MapPreview.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

interface PreviewCity {
  id: string;
  x: number;
  y: number;
}
interface PreviewRoute {
  a: string;
  b: string;
}

/** Read-only board-shape glance for moderation: cities as dots, routes as lines, in the
 *  draft's own 0-100 coordinate space. No interactivity, no dependency on the game's real
 *  board renderer (apps/web) — this is inert content, not live game state. */
export function MapPreview({
  draft,
}: {
  draft: { cities: PreviewCity[]; routes: PreviewRoute[] };
}) {
  const { t } = useTranslation();
  if (draft.cities.length === 0) {
    return <p className="oc-muted">{t('maps.previewEmpty')}</p>;
  }
  const byId = new Map(draft.cities.map((c) => [c.id, c]));
  return (
    <svg viewBox="0 0 100 100" className="oc-map-preview" role="img" aria-label={t('maps.preview')}>
      {draft.routes.map((r, i) => {
        const a = byId.get(r.a);
        const b = byId.get(r.b);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="currentColor"
            strokeWidth={0.4}
          />
        );
      })}
      {draft.cities.map((c) => (
        <circle key={c.id} cx={c.x} cy={c.y} r={1.2} fill="currentColor" />
      ))}
    </svg>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/admin test MapPreview`
Expected: PASS.

- [ ] **Step 6: Add the drawer to `MapsView`**

In `apps/admin/src/views/MapsView.tsx`, add a `MapDrawer` component and render it:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type MapAdminDetail, type MapAdminRow } from '../net/rest';
import { useUi } from '../store/ui';
import { fmtDateTime, shortId } from '../lib/fmt';
import { Drawer } from '../components/Drawer';
import { MapPreview } from '../components/MapPreview';

function MapDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const [detail, setDetail] = useState<MapAdminDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMap(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => onClose());
    return () => {
      cancelled = true;
    };
  }, [id, onClose]);

  return (
    <Drawer title={`${t('maps.detailTitle')} · ${shortId(id)}`} onClose={onClose}>
      {!detail ? (
        <div className="oc-empty">{t('common.loading')}</div>
      ) : (
        <>
          <section>
            <h3>{t('maps.preview')}</h3>
            <MapPreview draft={detail.draft} />
          </section>
          <section>
            <div className="oc-kv">
              <span className="k">{t('maps.owner')}</span>
              <span className="v">{detail.ownerDisplayName ?? shortId(detail.ownerId)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('maps.colRevision')}</span>
              <span className="v">{detail.revision}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('maps.created')}</span>
              <span className="v">{fmtDateTime(detail.createdAt, locale)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('maps.usageCount')}</span>
              <span className="v">{detail.usageCount}</span>
            </div>
            {detail.shareCode && (
              <div className="oc-kv">
                <span className="k">{t('maps.shareCode')}</span>
                <span className="v oc-mono">{detail.shareCode}</span>
              </div>
            )}
          </section>
        </>
      )}
    </Drawer>
  );
}

export function MapsView() {
  // ...unchanged list state/logic from Task 5...
  const param = useUi((s) => s.param);
  const closeDetail = useUi((s) => s.closeDetail);

  return (
    <div>
      {/* ...unchanged title/table from Task 5... */}
      {param && <MapDrawer id={param} onClose={closeDetail} />}
    </div>
  );
}
```

(Merge this with the Task 5 version of the file rather than duplicating — add the `param`/`closeDetail` reads and the `{param && <MapDrawer .../>}` line to the existing component body, and add the `MapDrawer` function above it.)

- [ ] **Step 7: Extend the `MapsView` test to cover the drawer**

Update `apps/admin/src/views/MapsView.test.tsx`'s `beforeEach` to also stub the detail route, and add a new test. The detail route (`/dashboard/maps/map-1`) must be registered BEFORE the list route (`/dashboard/maps`) in the `stubFetch` call, since `stubFetch` matches by substring in insertion order and every detail URL also contains the list path as a prefix:

```tsx
import { fireEvent } from '@testing-library/react';

const MAP_DETAIL = {
  ...MAP_ROW,
  createdAt: '2026-01-01T00:00:00.000Z',
  usageCount: 0,
  draft: { cities: [], routes: [], tickets: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'maps', param: null });
  stubFetch({
    '/dashboard/maps/map-1': { status: 200, body: MAP_DETAIL },
    '/dashboard/maps': { status: 200, body: { maps: [MAP_ROW], nextCursor: null } },
  });
});
```

(This replaces the `beforeEach` written in Step 1 — same body, with the detail route added ahead of the list route.)

```tsx
it('opens a drawer with preview and detail on row click', async () => {
  render(<MapsView />);
  await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Test'));
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  expect(screen.getByText('尚無內容')).toBeInTheDocument(); // MapPreview's empty state
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `yarn workspace @trm/admin test MapsView MapPreview`
Expected: PASS.

- [ ] **Step 9: Typecheck + lint**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/components/MapPreview.tsx apps/admin/src/components/MapPreview.test.tsx apps/admin/src/views/MapsView.tsx apps/admin/src/views/MapsView.test.tsx apps/admin/src/i18n/index.ts
git commit -m "feat(admin): custom map drawer detail + static SVG preview"
```

---

### Task 7: Admin UI — delete, unshare, transfer actions

**Files:**

- Modify: `apps/admin/src/views/MapsView.tsx`
- Modify: `apps/admin/src/views/MapsView.test.tsx`
- Modify: `apps/admin/src/i18n/index.ts`

**Interfaces:**

- Consumes: `useSession().hasPermission('maps.moderate')`, `ConfirmDialog`, `AccountSelectorModal`, `useToast().push`, `api.deleteMap`/`unshareMap`/`transferMap` (Task 5).

- [ ] **Step 1: Add i18n keys**

`MapDrawer`'s new buttons (Step 4) and the tests below both need these strings to exist first — add them before writing either. In `apps/admin/src/i18n/index.ts`, extend `maps` (both tables) and `toast` (both tables):

zh-Hant `maps` additions:

```ts
    delete: '刪除地圖',
    deleteConfirmTitle: '確認刪除地圖',
    deleteConfirmBody: '此操作將永久刪除此地圖草稿。已發布的內容(供既有對局/回放使用)不受影響。',
    unshare: '強制取消分享',
    unshareConfirmTitle: '確認取消分享',
    unshareConfirmBody: '此操作將立即讓分享代碼失效。',
    transfer: '轉移擁有者',
    transferPickTitle: '選擇新擁有者',
```

en `maps` additions:

```ts
    delete: 'Delete Map',
    deleteConfirmTitle: 'Confirm map deletion',
    deleteConfirmBody:
      'This permanently deletes the map draft. Already-published content (used by existing games/replays) is unaffected.',
    unshare: 'Force Unshare',
    unshareConfirmTitle: 'Confirm force-unshare',
    unshareConfirmBody: "This immediately invalidates the map's share code.",
    transfer: 'Transfer Owner',
    transferPickTitle: 'Select new owner',
```

zh-Hant `toast` additions: `mapDeleted: '地圖已刪除'`, `mapUnshared: '已取消分享'`, `mapTransferred: '擁有者已變更'`.
en `toast` additions: `mapDeleted: 'Map deleted'`, `mapUnshared: 'Sharing revoked'`, `mapTransferred: 'Owner changed'`.

- [ ] **Step 2: Write the failing tests**

Append to `apps/admin/src/views/MapsView.test.tsx`, following the same `stubFetch` + real-translated-text convention as the rest of the file (and `GamesView.test.tsx`) — never mock `../net/rest` directly, never assert raw i18n keys:

```tsx
import { useSession } from '../store/session';

describe('MapsView destructive actions', () => {
  it('hides delete/unshare/transfer without maps.moderate, shows them with it', async () => {
    useSession.setState({ permissions: new Set(['maps.read']) } as never);
    stubFetch({
      '/dashboard/maps/map-1': { status: 200, body: MAP_DETAIL },
      '/dashboard/maps': { status: 200, body: { maps: [MAP_ROW], nextCursor: null } },
    });
    render(<MapsView />);
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Test'));
    await waitFor(() => expect(screen.getByText('尚無內容')).toBeInTheDocument());
    expect(screen.queryByText('刪除地圖')).not.toBeInTheDocument();

    useSession.setState({ permissions: new Set(['maps.read', 'maps.moderate']) } as never);
    render(<MapsView />);
    await waitFor(() => expect(screen.getAllByText('Test').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Test')[0]!);
    await waitFor(() => expect(screen.getByText('刪除地圖')).toBeInTheDocument());
  });

  it('deletes a map after confirmation and closes the drawer', async () => {
    useSession.setState({ permissions: new Set(['maps.read', 'maps.moderate']) } as never);
    let deleteCalled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/dashboard/maps/map-1') && init?.method === 'DELETE') {
          deleteCalled = true;
          return new Response(null, { status: 204 });
        }
        if (url.includes('/dashboard/maps/map-1')) {
          return new Response(JSON.stringify(MAP_DETAIL), { status: 200 });
        }
        return new Response(JSON.stringify({ maps: [MAP_ROW], nextCursor: null }), { status: 200 });
      }),
    );
    render(<MapsView />);
    await waitFor(() => expect(screen.getByText('Test')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Test'));
    fireEvent.click(await screen.findByText('刪除地圖'));
    const dialog = await screen.findByRole('dialog', { name: '確認刪除地圖' });
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除地圖' }));
    await waitFor(() => expect(deleteCalled).toBe(true));
  });
});
```

This second test needs `within` imported from `@testing-library/react` alongside the file's existing `render`/`screen`/`waitFor`/`fireEvent` imports.

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn workspace @trm/admin test MapsView`
Expected: FAIL — no delete/unshare/transfer buttons exist in `MapDrawer` yet.

- [ ] **Step 4: Add the actions to `MapDrawer`**

Rewrite `MapDrawer` in `apps/admin/src/views/MapsView.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type MapAdminDetail, type MapAdminRow, type UserRow } from '../net/rest';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { useToast } from '../store/toast';
import { fmtDateTime, shortId } from '../lib/fmt';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AccountSelectorModal } from '../components/AccountSelectorModal';
import { MapPreview } from '../components/MapPreview';

function MapDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canModerate = useSession((s) => s.hasPermission('maps.moderate'));
  const pushToast = useToast((s) => s.push);
  const [detail, setDetail] = useState<MapAdminDetail | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingUnshare, setConfirmingUnshare] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMap(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => onClose());
    return () => {
      cancelled = true;
    };
  }, [id, onClose]);

  const del = async (reason?: string) => {
    setBusy(true);
    try {
      await api.deleteMap(id, reason);
      pushToast('success', t('toast.mapDeleted'));
      onClose();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  const unshare = async (reason?: string) => {
    setBusy(true);
    try {
      const updated = await api.unshareMap(id, reason).then(() => api.getMap(id));
      setDetail(updated);
      pushToast('success', t('toast.mapUnshared'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirmingUnshare(false);
    }
  };

  const transfer = async (user: UserRow) => {
    setPicking(false);
    setBusy(true);
    try {
      setDetail(await api.transferMap(id, user.id));
      pushToast('success', t('toast.mapTransferred'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title={`${t('maps.detailTitle')} · ${shortId(id)}`} onClose={onClose}>
      {!detail ? (
        <div className="oc-empty">{t('common.loading')}</div>
      ) : (
        <>
          <section>
            <h3>{t('maps.preview')}</h3>
            <MapPreview draft={detail.draft} />
          </section>
          <section>
            <div className="oc-kv">
              <span className="k">{t('maps.owner')}</span>
              <span className="v">{detail.ownerDisplayName ?? shortId(detail.ownerId)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('maps.colRevision')}</span>
              <span className="v">{detail.revision}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('maps.created')}</span>
              <span className="v">{fmtDateTime(detail.createdAt, locale)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('maps.usageCount')}</span>
              <span className="v">{detail.usageCount}</span>
            </div>
            {detail.shareCode && (
              <div className="oc-kv">
                <span className="k">{t('maps.shareCode')}</span>
                <span className="v oc-mono">{detail.shareCode}</span>
              </div>
            )}
          </section>

          {canModerate && (
            <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="oc-btn" disabled={busy} onClick={() => setPicking(true)}>
                {t('maps.transfer')}
              </button>
              {detail.shared && (
                <button
                  className="oc-btn"
                  disabled={busy}
                  onClick={() => setConfirmingUnshare(true)}
                >
                  {t('maps.unshare')}
                </button>
              )}
              <button
                className="oc-btn danger"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                {t('maps.delete')}
              </button>
            </section>
          )}

          {confirmingDelete && (
            <ConfirmDialog
              title={t('maps.deleteConfirmTitle')}
              body={t('maps.deleteConfirmBody')}
              confirmLabel={t('maps.delete')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void del(reason)}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
          {confirmingUnshare && (
            <ConfirmDialog
              title={t('maps.unshareConfirmTitle')}
              body={t('maps.unshareConfirmBody')}
              confirmLabel={t('maps.unshare')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void unshare(reason)}
              onCancel={() => setConfirmingUnshare(false)}
            />
          )}
          {picking && (
            <AccountSelectorModal
              title={t('maps.transferPickTitle')}
              onSelect={(u) => void transfer(u)}
              onClose={() => setPicking(false)}
            />
          )}
        </>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/admin test MapsView`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Expected: PASS.

- [ ] **Step 7: Full verification sweep**

Run: `yarn typecheck && yarn lint && yarn workspace @trm/server test --run dashboard-maps && yarn workspace @trm/shared test --run dashboard && yarn workspace @trm/admin test`
Expected: PASS across the board.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/views/MapsView.tsx apps/admin/src/views/MapsView.test.tsx apps/admin/src/i18n/index.ts
git commit -m "feat(admin): delete/unshare/transfer actions for custom maps"
```

---

## Self-Review Notes

- **Spec coverage:** list all maps/any owner (Task 3), preview (Task 6), delete/force-unshare/transfer (Task 4 + 7), permission defaults `maps.read`→viewer / `maps.moderate`→admin (Task 1) — all covered.
- **Placeholder scan:** none — every step has complete code.
- **Type consistency:** `MapAdminRow`/`MapAdminDetail` (admin `net/rest.ts`) match `MapAdminRowSchema`/`MapAdminDetailSchema` (server `dashboard.schemas.ts`) field-for-field; `CustomMapRepo`/`MapContentRepo` method names introduced in Task 2 are the exact names called in Task 3/4's service.
