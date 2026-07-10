# End-Game Rating + Discord CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a five-star app-rating widget + submit button and an always-visible Discord-join
button to the post-game `ScoreBoard`, persist ratings server-side, and give maintainers a read-only
dashboard view over them.

**Architecture:** A new append-only `gameRatings` Mongo collection behind a small `RatingsModule`
(`POST /api/v1/ratings`, native `mongodb` driver, `nestjs-zod` validation) — mirroring the existing
`HistoryModule`/`MapsModule` shape exactly. A `DashboardRatingsController`/`Service` pair (mirroring
`DashboardMapsController`/`Service`) exposes a cursor-paginated read endpoint gated on a new
`ratings.read` permission. `apps/web`'s `ScoreBoard.tsx` gets a new `StarRating` component + a
shared `.discord-cta` button style (extracted from `WelcomeScreen`). `apps/admin` gets a new
`RatingsView` list page following the existing `AuditView` pattern.

**Tech Stack:** NestJS + nestjs-zod + MongoDB (native driver) on the server; React + Zustand +
react-i18next on both `apps/web` and `apps/admin`; Vitest + Supertest for server e2e; Vitest +
`@testing-library/react` for client UI tests.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-10-endgame-rating-discord-design.md`.
- Server tests in this repo are e2e-only (`apps/server/test/*.e2e.spec.ts`, `createTestApp()` +
  supertest) — there is no isolated unit-spec convention for repos/services to follow instead.
- `gameRatings` is **append-only**: every submission is a new document; nothing ever updates or
  overwrites an existing rating. A player may submit multiple ratings for the same `gameId`.
- No server-side verification that the caller actually played `gameId`/`roomId` — the client
  already reads both from its own session state; a spoofed value only pollutes analytics, not a
  security boundary (explicit YAGNI call in the spec).
- New permission `ratings.read` is **viewer-tier** (read-only), added to both
  `DASHBOARD_PERMISSIONS` and `VIEWER_PERMISSIONS` in `packages/shared/src/dashboard.ts`.
- The star widget renders at **32px** (roughly 2x the scoreboard's existing 13–15px icon glyphs),
  using `lucide-react`'s `Star` icon.
- The Discord button's visual style must exactly match `WelcomeScreen`'s existing button — extract
  it into a shared `.discord-cta` class in `app.css` rather than duplicating the CSS block.
- The Discord button is **always visible** on the end-game screen, regardless of rating state.
- `yarn workspace @trm/server test`, `yarn workspace @trm/web test`, `yarn workspace @trm/admin
test`, `yarn lint`, and `yarn typecheck` must pass before every commit.

---

### Task 1: `ratings.read` dashboard permission

**Files:**

- Modify: `packages/shared/src/dashboard.ts`

**Interfaces:**

- Produces: `DASHBOARD_PERMISSIONS` includes `'ratings.read'`; `ROLE_PERMISSIONS.viewer` (and
  therefore `moderator`/`admin`/`owner`, via escalation) includes `'ratings.read'`.

- [ ] **Step 1: Add the permission**

In `packages/shared/src/dashboard.ts`, edit `DASHBOARD_PERMISSIONS`:

```ts
export const DASHBOARD_PERMISSIONS = [
  'overview.read',
  'users.read',
  'users.ban',
  'users.delete',
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
  'maps.read',
  'maps.moderate',
  'ratings.read',
] as const;
```

And `VIEWER_PERMISSIONS`:

```ts
const VIEWER_PERMISSIONS: readonly DashboardPermission[] = [
  'overview.read',
  'users.read',
  'games.read',
  'rooms.read',
  'games.viewReplay',
  'maps.read',
  'ratings.read',
];
```

- [ ] **Step 2: Typecheck**

Run: `yarn workspace @trm/shared typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/dashboard.ts
git commit -m "feat(shared): add ratings.read dashboard permission"
```

---

### Task 2: Server — `POST /api/v1/ratings` (submit + persist)

**Files:**

- Create: `apps/server/src/ratings/ratings.types.ts`
- Create: `apps/server/src/ratings/ratings.repo.ts`
- Create: `apps/server/src/ratings/ratings.schemas.ts`
- Create: `apps/server/src/ratings/ratings.controller.ts`
- Create: `apps/server/src/ratings/ratings.module.ts`
- Modify: `apps/server/src/app.module.ts`
- Test: Create `apps/server/test/ratings.e2e.spec.ts`

**Interfaces:**

- Produces: `RatingsRepo` — `insert(userId, gameId, roomId, stars): Promise<GameRatingDoc>`,
  `listPage(cursor: {t: Date; id: string} | null, limit: number): Promise<GameRatingDoc[]>`,
  `summary(): Promise<{avgStars: number | null; totalCount: number}>`,
  `deleteByUser(userId: string): Promise<number>`. `POST /api/v1/ratings` (auth required) →
  `{id, stars, createdAt}`, 201.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/ratings.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('POST /ratings', () => {
  it('persists a star rating tagged with gameId/roomId/userId', async () => {
    const player = await guest('Rater');
    const res = await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g1', roomId: 'ABCDE', stars: 5 })
      .expect(201);
    expect(res.body.stars).toBe(5);
    expect(res.body.id).toBeTruthy();
    expect(res.body.createdAt).toBeTruthy();

    const doc = await t.db.collection('gameRatings').findOne({ _id: res.body.id } as never);
    expect(doc).toMatchObject({ userId: player.id, gameId: 'g1', roomId: 'ABCDE', stars: 5 });
  });

  it('rejects an out-of-range stars value', async () => {
    const player = await guest('Rater2');
    await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g1', roomId: 'ABCDE', stars: 6 })
      .expect(400);
  });

  it('allows a second, independent rating for the same game (append-only, never overwrites)', async () => {
    const player = await guest('Rater3');
    await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g2', roomId: 'FGHIJ', stars: 3 })
      .expect(201);
    await request(server())
      .post('/api/v1/ratings')
      .set(auth(player.token))
      .send({ gameId: 'g2', roomId: 'FGHIJ', stars: 5 })
      .expect(201);
    const count = await t.db
      .collection('gameRatings')
      .countDocuments({ userId: player.id, gameId: 'g2' } as never);
    expect(count).toBe(2);
  });

  it('401s without a token', async () => {
    await request(server())
      .post('/api/v1/ratings')
      .send({ gameId: 'g1', roomId: 'ABCDE', stars: 5 })
      .expect(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run ratings.e2e`
Expected: FAIL — `/api/v1/ratings` doesn't exist yet (connection/404 error).

- [ ] **Step 3: Write the doc type**

Create `apps/server/src/ratings/ratings.types.ts`:

```ts
export interface GameRatingDoc {
  _id: string; // randomUUID()
  userId: string;
  gameId: string;
  roomId: string;
  stars: number; // 1-5, integer
  createdAt: Date;
}
```

- [ ] **Step 4: Write `RatingsRepo`**

Create `apps/server/src/ratings/ratings.repo.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import type { GameRatingDoc } from './ratings.types';

@Injectable()
export class RatingsRepo implements OnModuleInit {
  private readonly col: Collection<GameRatingDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<GameRatingDoc>('gameRatings');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ gameId: 1 });
    await this.col.createIndex({ userId: 1, createdAt: -1 });
    await this.col.createIndex({ createdAt: -1 });
  }

  async insert(userId: string, gameId: string, roomId: string, stars: number): Promise<GameRatingDoc> {
    const doc: GameRatingDoc = {
      _id: randomUUID(),
      userId,
      gameId,
      roomId,
      stars,
      createdAt: new Date(),
    };
    await this.col.insertOne(doc);
    return doc;
  }

  /** Admin listing: newest first, cursor-paginated. */
  listPage(cursor: { t: Date; id: string } | null, limit: number): Promise<GameRatingDoc[]> {
    const filter = cursor
      ? {
          $or: [
            { createdAt: { $lt: cursor.t } },
            { createdAt: cursor.t, _id: { $lt: cursor.id } },
          ],
        }
      : {};
    return this.col.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray();
  }

  async summary(): Promise<{ avgStars: number | null; totalCount: number }> {
    const [agg] = await this.col
      .aggregate<{ _id: null; avg: number; count: number }>([
        { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
      ])
      .toArray();
    return { avgStars: agg ? agg.avg : null, totalCount: agg ? agg.count : 0 };
  }

  /** Account-deletion cascade — drops every rating a deleted user submitted. */
  async deleteByUser(userId: string): Promise<number> {
    const res = await this.col.deleteMany({ userId });
    return res.deletedCount;
  }
}
```

- [ ] **Step 5: Write the submit schema**

Create `apps/server/src/ratings/ratings.schemas.ts`:

```ts
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const SubmitRatingSchema = z.object({
  gameId: z.string().min(1),
  roomId: z.string().min(1),
  stars: z.number().int().min(1).max(5),
});
export class SubmitRatingDto extends createZodDto(SubmitRatingSchema) {}

export const RatingResultSchema = z.object({
  id: z.string(),
  stars: z.number(),
  createdAt: z.string(),
});
```

- [ ] **Step 6: Write `RatingsController`**

Create `apps/server/src/ratings/ratings.controller.ts`:

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RatingsRepo } from './ratings.repo';
import { RatingResultSchema, SubmitRatingDto, SubmitRatingSchema } from './ratings.schemas';

@ApiTags('ratings')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/ratings')
export class RatingsController {
  constructor(private readonly ratings: RatingsRepo) {}

  @Post()
  @ApiOperation({
    summary: 'Submit a 1-5 star app rating, tagged with the game/room it was submitted from',
  })
  @ApiBody({ schema: apiSchema(SubmitRatingSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(RatingResultSchema) })
  async submit(@CurrentUser() user: AuthUser, @Body() body: SubmitRatingDto) {
    const doc = await this.ratings.insert(user.userId, body.gameId, body.roomId, body.stars);
    return { id: doc._id, stars: doc.stars, createdAt: doc.createdAt.toISOString() };
  }
}
```

- [ ] **Step 7: Write `RatingsModule`**

Create `apps/server/src/ratings/ratings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RatingsController } from './ratings.controller';
import { RatingsRepo } from './ratings.repo';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RatingsController],
  providers: [RatingsRepo],
  exports: [RatingsRepo],
})
export class RatingsModule {}
```

- [ ] **Step 8: Register the module**

In `apps/server/src/app.module.ts`, add the import:

```ts
import { RatingsModule } from './ratings/ratings.module';
```

And add `RatingsModule` to the `imports` array:

```ts
@Module({
  imports: [
    ObservabilityModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 240 }]),
    DatabaseModule,
    AuthModule,
    MapsModule,
    GameModule,
    LobbyModule,
    HistoryModule,
    RatingsModule,
    DashboardModule,
    OgModule,
  ],
  controllers: [HealthController, DocsController],
  providers: [
    OpenApiHolder,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run ratings.e2e`
Expected: PASS.

- [ ] **Step 10: Typecheck + lint**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/ratings apps/server/src/app.module.ts apps/server/test/ratings.e2e.spec.ts
git commit -m "feat(server): POST /api/v1/ratings — submit a star rating"
```

---

### Task 3: Server — `GET /api/v1/dashboard/ratings` (read surface)

**Files:**

- Modify: `apps/server/src/dashboard/dashboard.schemas.ts`
- Create: `apps/server/src/dashboard/dashboard-ratings.service.ts`
- Create: `apps/server/src/dashboard/dashboard-ratings.controller.ts`
- Modify: `apps/server/src/dashboard/dashboard.module.ts`
- Test: Create `apps/server/test/dashboard-ratings.e2e.spec.ts`

**Interfaces:**

- Consumes: `RatingsRepo.listPage`/`summary` (Task 2), `encodeCursor`/`decodeCursor` from
  `./cursor`, `RequirePermission`/`DashboardGuard` (existing).
- Produces: `GET /api/v1/dashboard/ratings?cursor&limit` → `{ratings: RatingRow[], nextCursor,
avgStars, totalCount}`, gated on `ratings.read`.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/dashboard-ratings.e2e.spec.ts`:

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

async function grantDashboard(userId: string, role: 'viewer' | 'admin') {
  await t.db.collection('dashboardAccounts').insertOne({
    _id: userId,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
}

let viewer: { token: string; id: string };
let rater: { token: string; id: string };

beforeAll(async () => {
  t = await createTestApp();
  viewer = await registered('rviewer@example.com', 'Viewer');
  await grantDashboard(viewer.id, 'viewer');
  rater = await registered('rater@example.com', 'Rater');

  await request(server())
    .post('/api/v1/ratings')
    .set(auth(rater.token))
    .send({ gameId: 'g1', roomId: 'ABCDE', stars: 4 })
    .expect(201);
  await request(server())
    .post('/api/v1/ratings')
    .set(auth(rater.token))
    .send({ gameId: 'g2', roomId: 'FGHIJ', stars: 2 })
    .expect(201);
}, 60_000);
afterAll(() => t.close());

describe('GET /dashboard/ratings', () => {
  it('403s without ratings.read', async () => {
    const noPerm = await registered('rnoperm@example.com', 'NoPerm');
    await request(server()).get('/api/v1/dashboard/ratings').set(auth(noPerm.token)).expect(404);
  });

  it('lists ratings with display names, average, and total count (viewer permission)', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/ratings')
      .set(auth(viewer.token))
      .expect(200);
    expect(res.body.ratings.length).toBeGreaterThanOrEqual(2);
    expect(res.body.totalCount).toBeGreaterThanOrEqual(2);
    expect(res.body.avgStars).toBe(3);
    const row = res.body.ratings.find((r: { gameId: string }) => r.gameId === 'g1');
    expect(row.userDisplayName).toBe('Rater');
    expect(row.stars).toBe(4);
    expect(res.body).toHaveProperty('nextCursor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-ratings.e2e`
Expected: FAIL — `/api/v1/dashboard/ratings` doesn't exist yet.

- [ ] **Step 3: Add dashboard schemas**

In `apps/server/src/dashboard/dashboard.schemas.ts`, add near the other list-query DTOs:

```ts
export const RatingsListQuerySchema = z.object({ limit, cursor });
export class RatingsListQueryDto extends createZodDto(RatingsListQuerySchema) {}
```

And add a new section near the end (after the `---- maps ----` section):

```ts
// ---- ratings --------------------------------------------------------------------

export const RatingRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userDisplayName: z.string().optional(),
  gameId: z.string(),
  roomId: z.string(),
  stars: z.number(),
  createdAt: z.string(),
});

export const RatingsListSchema = z.object({
  ratings: z.array(RatingRowSchema),
  nextCursor: z.string().nullable(),
  avgStars: z.number().nullable(),
  totalCount: z.number(),
});
```

- [ ] **Step 4: Write `DashboardRatingsService`**

Create `apps/server/src/dashboard/dashboard-ratings.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { RatingsRepo } from '../ratings/ratings.repo';
import type { GameRatingDoc } from '../ratings/ratings.types';
import type { UserDoc } from '../auth/user.repo';
import { decodeCursor, encodeCursor } from './cursor';

const toRow = (r: GameRatingDoc, userDisplayName?: string) => ({
  id: r._id,
  userId: r.userId,
  ...(userDisplayName !== undefined ? { userDisplayName } : {}),
  gameId: r.gameId,
  roomId: r.roomId,
  stars: r.stars,
  createdAt: r.createdAt.toISOString(),
});

@Injectable()
export class DashboardRatingsService {
  private readonly users: Collection<UserDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly ratings: RatingsRepo,
  ) {
    this.users = db.collection<UserDoc>('users');
  }

  private async displayNames(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const docs = await this.users
      .find({ _id: { $in: ids } }, { projection: { displayName: 1 } })
      .toArray();
    return new Map(docs.map((u) => [u._id, u.displayName]));
  }

  async list(query: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(query.cursor);
    const [docs, summary] = await Promise.all([
      this.ratings.listPage(cursor, query.limit),
      this.ratings.summary(),
    ]);
    const names = await this.displayNames(docs.map((d) => d.userId));
    const last = docs.length === query.limit ? docs[docs.length - 1] : undefined;
    return {
      ratings: docs.map((d) => toRow(d, names.get(d.userId))),
      nextCursor: last ? encodeCursor(last.createdAt, last._id) : null,
      avgStars: summary.avgStars,
      totalCount: summary.totalCount,
    };
  }
}
```

- [ ] **Step 5: Write `DashboardRatingsController`**

Create `apps/server/src/dashboard/dashboard-ratings.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardRatingsService } from './dashboard-ratings.service';
import { RatingsListQueryDto, RatingsListSchema } from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardRatingsController {
  constructor(private readonly ratings: DashboardRatingsService) {}

  @Get('ratings')
  @RequirePermission('ratings.read')
  @ApiOperation({ summary: 'List submitted app ratings, most recent first, with average/total' })
  @ApiResponse({ status: 200, schema: apiSchema(RatingsListSchema) })
  list(@Query() query: RatingsListQueryDto) {
    return this.ratings.list(query);
  }
}
```

- [ ] **Step 6: Wire the module**

In `apps/server/src/dashboard/dashboard.module.ts`, add imports:

```ts
import { RatingsModule } from '../ratings/ratings.module';
import { DashboardRatingsService } from './dashboard-ratings.service';
import { DashboardRatingsController } from './dashboard-ratings.controller';
```

And update the `@Module` decorator:

```ts
@Module({
  imports: [AuthModule, GameModule, LobbyModule, HistoryModule, MapsModule, RatingsModule],
  controllers: [
    DashboardController,
    DashboardUsersController,
    DashboardGamesController,
    DashboardMaintainersController,
    DashboardPurgeController,
    DashboardMapsController,
    DashboardRatingsController,
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
    DashboardRatingsService,
  ],
})
export class DashboardModule {}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-ratings.e2e`
Expected: PASS.

- [ ] **Step 8: Typecheck + lint**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/dashboard/dashboard-ratings.service.ts apps/server/src/dashboard/dashboard-ratings.controller.ts apps/server/src/dashboard/dashboard.schemas.ts apps/server/src/dashboard/dashboard.module.ts apps/server/test/dashboard-ratings.e2e.spec.ts
git commit -m "feat(server): GET /api/v1/dashboard/ratings — read surface for maintainers"
```

---

### Task 4: Server — account-deletion cascade

**Files:**

- Modify: `apps/server/src/dashboard/dashboard-users.service.ts`
- Modify: `apps/server/test/dashboard-delete-user.e2e.spec.ts`

**Interfaces:**

- Consumes: `RatingsRepo.deleteByUser` (Task 2), already available to `DashboardModule` via
  `RatingsModule` (imported in Task 3).

- [ ] **Step 1: Write the failing test extension**

In `apps/server/test/dashboard-delete-user.e2e.spec.ts`, add a `ratings` collection helper near
the existing `rooms`/`games`/`users`/`audit` helpers:

```ts
const ratings = () => t.db.collection<{ userId: string }>('gameRatings');
```

Then, inside the `'hard-deletes an account: ...'` test, add a rating for the victim right after
the `customMaps` insert:

```ts
    // A rating the victim submitted — must be dropped on account deletion.
    await ratings().insertOne({
      _id: 'rate-victim' as never,
      userId: victim.userId,
      gameId: 'g-old',
      roomId: 'ABCDE',
      stars: 4,
      createdAt: new Date(),
    } as never);
```

And after the existing `customMaps`/`matchHistory` assertions (right before the audit assertion),
add:

```ts
    // Ratings dropped too.
    expect(await ratings().countDocuments({ userId: victim.userId } as never)).toBe(0);
```

Finally, extend the audit assertion to also check the new count:

```ts
    const entry = await audit().findOne({ action: 'user.delete', 'target.id': victim.userId } as never);
    expect(entry).toBeTruthy();
    expect(entry?.params.gamesTerminated).toBe(1);
    expect(entry?.params.ratingsDeleted).toBe(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-delete-user.e2e`
Expected: FAIL — `ratingsDeleted` is `undefined` (the rating document still exists after deletion,
since nothing removes it yet).

- [ ] **Step 3: Wire the cascade**

In `apps/server/src/dashboard/dashboard-users.service.ts`, add the import and constructor
parameter:

```ts
import { RatingsRepo } from '../ratings/ratings.repo';
```

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
    private readonly ratings: RatingsRepo,
  ) {}
```

Then update the `delete()` method:

```ts
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
    const ratingsDeleted = await this.ratings.deleteByUser(userId);
    await this.users.deleteById(userId);
    await this.audit.log(
      actor,
      'user.delete',
      { type: 'user', id: userId },
      { ...(reason ? { reason } : {}), gamesTerminated, roomsClosed, ratingsDeleted },
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-delete-user.e2e`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint, full server suite**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint && yarn workspace
@trm/server test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/dashboard/dashboard-users.service.ts apps/server/test/dashboard-delete-user.e2e.spec.ts
git commit -m "feat(server): drop a deleted account's ratings too"
```

---

### Task 5: Web — `StarRating` component

**Files:**

- Create: `apps/web/src/components/StarRating.tsx`
- Create: `apps/web/src/components/StarRating.test.tsx`
- Modify: `apps/web/src/i18n/index.ts`

**Interfaces:**

- Produces: `<StarRating value={number} onChange={(n: number) => void} size?={number}
disabled?={boolean} />` — five `role="radio"` buttons, `aria-checked` on the selected star,
  `onChange` fires with 1-5 on click.

- [ ] **Step 1: Add the i18n keys the component needs**

In `apps/web/src/i18n/index.ts`, add to the top-level `translation` object of the `'zh-Hant'`
block (near `close: '關閉',`):

```ts
      rateAppPrompt: '這場遊戲玩得如何？',
      starRatingValue: '{{n}} 顆星',
```

And the matching keys in the `'en'` block, at the same tree position (find the English
`translation` object further down the file and add next to its `close:` key):

```ts
      rateAppPrompt: 'How was this game?',
      starRatingValue: '{{n}} star(s)',
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/components/StarRating.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import i18n from '../i18n';
import { StarRating } from './StarRating';

describe('StarRating', () => {
  beforeEach(() => {
    void i18n.changeLanguage('zh-Hant');
  });

  it('renders five star buttons and reports the clicked value', () => {
    const onChange = vi.fn();
    render(<StarRating value={0} onChange={onChange} />);
    const stars = screen.getAllByRole('radio');
    expect(stars).toHaveLength(5);
    fireEvent.click(stars[2]!);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('marks the selected star as checked', () => {
    render(<StarRating value={4} onChange={() => {}} />);
    const stars = screen.getAllByRole('radio');
    expect(stars[3]!).toHaveAttribute('aria-checked', 'true');
    expect(stars[4]!).toHaveAttribute('aria-checked', 'false');
  });

  it('disables all stars when disabled', () => {
    render(<StarRating value={0} onChange={() => {}} disabled />);
    for (const star of screen.getAllByRole('radio')) {
      expect(star).toBeDisabled();
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn workspace @trm/web test StarRating`
Expected: FAIL — `./StarRating` module doesn't exist.

- [ ] **Step 4: Write `StarRating`**

Create `apps/web/src/components/StarRating.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange: (stars: number) => void;
  size?: number;
  disabled?: boolean;
}

/** Five-star picker. `value` is 0-5 (0 = none selected yet). */
export function StarRating({ value, onChange, size = 32, disabled = false }: StarRatingProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(0);
  const display = hovered || value;

  return (
    <div className="star-rating" role="radiogroup" aria-label={t('rateAppPrompt')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="star-rating-star"
          role="radio"
          aria-checked={value === n}
          aria-label={t('starRatingValue', { n })}
          disabled={disabled}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(n)}
        >
          <Star size={size} fill={n <= display ? 'currentColor' : 'none'} aria-hidden />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/web test StarRating`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/StarRating.tsx apps/web/src/components/StarRating.test.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web): add the StarRating picker component"
```

---

### Task 6: Web — shared `.discord-cta` button style

**Files:**

- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/styles/home.css`
- Modify: `apps/web/src/screens/WelcomeScreen.tsx`

**Interfaces:**

- Produces: a `.discord-cta` class in `app.css` (global stylesheet), replacing the
  `.welcome-discord-cta` rule previously local to `home.css`. Visual output is unchanged.

- [ ] **Step 1: Add the shared class to `app.css`**

In `apps/web/src/styles/app.css`, right after the existing `.modal { ... }` block (ends around
line 343, just before the `/* ── Settings modal ── */` comment), add:

```css
/* ── Discord CTA (shared: welcome screen + end-game scoreboard) ──────────────── */
.discord-cta {
  display: inline-flex;
  align-items: center;
  gap: var(--tr-space-2);
  padding: 11px 22px;
  font-weight: 600;
  font-size: 14.5px;
  background: #5865f2;
  border-color: #5865f2;
  color: #fff;
}
```

- [ ] **Step 2: Remove the now-duplicate rule from `home.css`**

In `apps/web/src/styles/home.css`, delete the `.welcome-discord-cta` block (currently lines
380–390):

```css
.welcome-discord-cta {
  display: inline-flex;
  align-items: center;
  gap: var(--tr-space-2);
  padding: 11px 22px;
  font-weight: 600;
  font-size: 14.5px;
  background: #5865f2;
  border-color: #5865f2;
  color: #fff;
}
```

Leave `.welcome-discord` (the centered layout wrapper, lines 375–379) untouched.

- [ ] **Step 3: Point `WelcomeScreen` at the shared class**

In `apps/web/src/screens/WelcomeScreen.tsx`, change:

```tsx
        <button className="welcome-discord-cta" onClick={openDiscord}>
```

to:

```tsx
        <button className="discord-cta" onClick={openDiscord}>
```

- [ ] **Step 4: Run the web test suite**

Run: `yarn workspace @trm/web test`
Expected: PASS (no test references the old class name — verified no `WelcomeScreen.test.tsx`
exists and no other file greps for `welcome-discord-cta`).

- [ ] **Step 5: Typecheck + lint**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/styles/app.css apps/web/src/styles/home.css apps/web/src/screens/WelcomeScreen.tsx
git commit -m "refactor(web): extract a shared .discord-cta button class"
```

---

### Task 7: Web — REST client + remaining i18n keys

**Files:**

- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/i18n/index.ts`

**Interfaces:**

- Produces: `api.submitRating({gameId, roomId, stars}): Promise<RatingResult>` where
  `RatingResult = {id: string; stars: number; createdAt: string}`.

- [ ] **Step 1: Add the type + method to `rest.ts`**

In `apps/web/src/net/rest.ts`, add near the other small result interfaces (after
`PracticeResult`):

```ts
export interface RatingResult {
  id: string;
  stars: number;
  createdAt: string;
}
```

Add to the `api` object, near the `rematch: (code: string) => ...` line:

```ts
  submitRating: (payload: { gameId: string; roomId: string; stars: number }) =>
    req<RatingResult>('POST', '/ratings', payload),
```

- [ ] **Step 2: Add the remaining i18n keys**

In `apps/web/src/i18n/index.ts`, add to the `'zh-Hant'` `translation` object, next to the
`rateAppPrompt`/`starRatingValue` keys added in Task 5:

```ts
      submitRating: '送出評分',
      ratingThanks: '感謝你的評分！',
      ratingSubmitError: '評分送出失敗，請再試一次。',
```

And the matching English keys, at the same tree position:

```ts
      submitRating: 'Submit rating',
      ratingThanks: 'Thanks for rating!',
      ratingSubmitError: 'Could not submit your rating — please try again.',
```

- [ ] **Step 3: Typecheck + lint**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/i18n/index.ts
git commit -m "feat(web): submitRating REST call + rating i18n strings"
```

---

### Task 8: Web — `ScoreBoard` integration

**Files:**

- Modify: `apps/web/src/components/ScoreBoard.tsx`
- Modify: `apps/web/src/styles/game.css`
- Modify: `apps/web/src/components/ScoreBoard.test.tsx`

**Interfaces:**

- Consumes: `StarRating` (Task 5), `.discord-cta` (Task 6), `api.submitRating` (Task 7),
  `useUi((s) => s.gameId)` / `useUi((s) => s.roomCode)` (existing `store/ui.ts`), `DiscordGlyph` +
  `openDiscord` (existing `components/icons/DiscordGlyph.tsx` + `discord.ts`).
- Produces: `ScoreBoard` renders a rating section + a Discord button; no prop changes (gameId/
  roomCode are read from the store, not passed in).

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/ScoreBoard.test.tsx`, add the import for `useUi` and `api` near the
top (alongside the existing imports):

```tsx
import { useUi } from '../store/ui';
import { api } from '../net/rest';
```

Then append a new `describe` block at the end of the file (after the existing `describe('ScoreBoard
rematch', ...)` block):

```tsx
describe('ScoreBoard rating + Discord', () => {
  beforeEach(() => {
    useAnimations.getState().reset();
    void i18n.changeLanguage('zh-Hant');
    localStorage.clear();
    useUi.setState({ gameId: 'g1', roomCode: 'ABCDE' });
  });

  it('disables submit until a star is picked, then submits and shows thanks', async () => {
    const submitRating = vi
      .spyOn(api, 'submitRating')
      .mockResolvedValue({ id: 'r1', stars: 4, createdAt: '2026-01-01T00:00:00.000Z' });
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);

    const submit = screen.getByRole('button', { name: '送出評分' });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getAllByRole('radio')[3]!);
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    await screen.findByText('感謝你的評分！');
    expect(submitRating).toHaveBeenCalledWith({ gameId: 'g1', roomId: 'ABCDE', stars: 4 });
  });

  it('remembers a rated game across remounts via localStorage', () => {
    localStorage.setItem('trm.ratedGameIds', JSON.stringify(['g1']));
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    expect(screen.getByText('感謝你的評分！')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('always shows a Discord join button', () => {
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    expect(screen.getByRole('button', { name: /加入 Discord 社群/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test ScoreBoard`
Expected: FAIL — no `role="radio"` elements, no "送出評分"/"感謝你的評分！" text, no Discord button
render yet.

- [ ] **Step 3: Add the CSS**

In `apps/web/src/styles/game.css`, right after the existing `.scoreboard-actions button { ... }`
block (ends around line 1451, just before `.cell-value`), add:

```css
.scoreboard-rating {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--tr-space-2);
  padding: var(--tr-space-3) 0;
  border-top: 1px solid var(--tr-line);
}
.scoreboard-rating-label {
  font-weight: 600;
  font-size: 14px;
}
.scoreboard-rating-thanks {
  color: var(--tr-ok);
  font-weight: 600;
}
.star-rating {
  display: flex;
  gap: var(--tr-space-1);
}
.star-rating-star {
  display: inline-flex;
  padding: 2px;
  border: none;
  background: transparent;
  color: var(--tr-ember, #c0392b);
  cursor: pointer;
}
.star-rating-star:disabled {
  cursor: default;
  opacity: 0.7;
}
.scoreboard-discord {
  display: flex;
  justify-content: center;
  padding-bottom: var(--tr-space-2);
}
```

- [ ] **Step 4: Wire `ScoreBoard.tsx`**

In `apps/web/src/components/ScoreBoard.tsx`, update the imports at the top of the file:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown, Bot, Eye, Map as MapIcon, X } from 'lucide-react';
import type { GameSnapshot, PlayerFinal } from '@trm/proto';
import type { RoomMember } from '../net/rest';
import { api } from '../net/rest';
import { SEAT_COLORS } from '../theme/colors';
import { seatByPlayer } from '../game/view';
import { usePlayerName } from '../game/playerName';
import { ticketById } from '../game/content';
import { useAnimationsStore } from '../store/animations';
import { useConfetti } from '../hooks/useConfetti';
import { useUi } from '../store/ui';
import { TicketCard } from './TicketCard';
import { StarRating } from './StarRating';
import { DiscordGlyph } from './icons/DiscordGlyph';
import { openDiscord } from '../discord';
```

Add these module-level helpers right after the existing `ticketValue` function (before
`ticketSplit`):

```ts
const RATED_GAMES_KEY = 'trm.ratedGameIds';

function getRatedGameIds(): Set<string> {
  try {
    const raw = localStorage.getItem(RATED_GAMES_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function markGameRated(gameId: string): void {
  try {
    const ids = getRatedGameIds();
    ids.add(gameId);
    localStorage.setItem(RATED_GAMES_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage unavailable */
  }
}
```

Inside the `ScoreBoard` function body, add these hooks right after the existing
`const clearRouteReveal = useAnimationsStore((s) => s.clearRouteReveal);` line:

```ts
  const gameId = useUi((s) => s.gameId);
  const roomCode = useUi((s) => s.roomCode);
```

And add this state + handler right after the existing `const [dismissed, setDismissed] =
useState(false);` line:

```ts
  const [stars, setStars] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(
    () => !!gameId && getRatedGameIds().has(gameId),
  );

  const submitRating = async (): Promise<void> => {
    if (!gameId || !roomCode || stars === 0) return;
    setSubmitting(true);
    setRatingError(false);
    try {
      await api.submitRating({ gameId, roomId: roomCode, stars });
      markGameRated(gameId);
      setAlreadyRated(true);
    } catch {
      setRatingError(true);
    } finally {
      setSubmitting(false);
    }
  };
```

Finally, insert the new render block between the existing rematch-row block and the
`.scoreboard-actions` div. Find this in the current file:

```tsx
        {members && snapshot.you && (onVote || onPlayAgain) && (
          <div className="row between rematch-row">
            {/* ...unchanged... */}
          </div>
        )}
        <div className="scoreboard-actions">
```

Change it to:

```tsx
        {members && snapshot.you && (onVote || onPlayAgain) && (
          <div className="row between rematch-row">
            {/* ...unchanged... */}
          </div>
        )}
        {gameId && roomCode && (
          <div className="scoreboard-rating">
            <span className="scoreboard-rating-label">{t('rateAppPrompt')}</span>
            {alreadyRated ? (
              <span className="scoreboard-rating-thanks">{t('ratingThanks')}</span>
            ) : (
              <>
                <StarRating value={stars} onChange={setStars} size={32} disabled={submitting} />
                <button
                  className="primary"
                  disabled={stars === 0 || submitting}
                  onClick={() => void submitRating()}
                >
                  {t('submitRating')}
                </button>
                {ratingError && <p className="error">{t('ratingSubmitError')}</p>}
              </>
            )}
          </div>
        )}
        <div className="scoreboard-discord">
          <button className="discord-cta" onClick={openDiscord}>
            <DiscordGlyph size={18} /> {t('home.welcome.discordCta')}
          </button>
        </div>
        <div className="scoreboard-actions">
```

(Only the content between the rematch-row block and `.scoreboard-actions` changes — everything
else in the file, including the `.scoreboard-actions` div itself and everything after it, stays
exactly as-is.)

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/web test ScoreBoard`
Expected: PASS — all tests in the file (the three new ones plus every pre-existing `ScoreBoard`
test, since none of them set `gameId`/`roomCode` and the new sections are conditionally gated on
both being non-null).

- [ ] **Step 6: Typecheck + lint**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ScoreBoard.tsx apps/web/src/styles/game.css apps/web/src/components/ScoreBoard.test.tsx
git commit -m "feat(web): star rating + Discord CTA on the end-game screen"
```

---

### Task 9: Admin — REST client + i18n + permission label

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/i18n/index.ts`

**Interfaces:**

- Produces: `api.listRatings(opts?: {cursor?: string}): Promise<RatingsPage>` where
  `RatingsPage = {ratings: RatingRow[]; nextCursor: string | null; avgStars: number | null;
totalCount: number}`.

- [ ] **Step 1: Add types + the API call**

In `apps/admin/src/net/rest.ts`, add near the other row/page types (after the `AuditPage` type
alias):

```ts
export interface RatingRow {
  id: string;
  userId: string;
  userDisplayName?: string;
  gameId: string;
  roomId: string;
  stars: number;
  createdAt: string;
}
export type RatingsPage = {
  ratings: RatingRow[];
  nextCursor: string | null;
  avgStars: number | null;
  totalCount: number;
};
```

Add to the `api` object, near `listAudit`:

```ts
  listRatings: (opts: { cursor?: string } = {}) =>
    req<RatingsPage>('GET', `/dashboard/ratings${qs(opts)}`),
```

- [ ] **Step 2: Add i18n keys**

In `apps/admin/src/i18n/index.ts`, add `ratings: '評分'` to the `nav` object in the `zhHant` table
(next to `maps: '地圖',`):

```ts
  nav: {
    overview: '總覽',
    users: '使用者',
    features: '功能開通',
    games: '對局',
    rooms: '房間',
    maps: '地圖',
    ratings: '評分',
    maintainers: '維護者',
    audit: '稽核',
    purge: '清理',
    logout: '登出',
    collapse: '收合選單',
    theme: '切換主題',
    language: '切換語言',
  },
```

Add a new `ratings` namespace to the `zhHant` table, right after the existing `maps: { ... }`
block:

```ts
  ratings: {
    title: '玩家評分',
    colStars: '星等',
    colUser: '使用者',
    colGame: '對局',
    colRoom: '房間',
    colSubmitted: '提交時間',
    summary: '平均 {{avg}} 顆星．共 {{count}} 筆',
  },
```

Add `'ratings.read': '檢視玩家評分',` to the `perm` object in `zhHant` (next to
`'maps.moderate': '管理地圖',`):

```ts
    'maps.read': '檢視地圖',
    'maps.moderate': '管理地圖',
    'ratings.read': '檢視玩家評分',
  },
```

Now mirror all three additions in the `en` table (which is typed as `typeof zhHant`, so every key
added above must have a matching entry here too):

```ts
  nav: {
    overview: 'Overview',
    users: 'Users',
    features: 'Feature access',
    games: 'Games',
    rooms: 'Rooms',
    maps: 'Maps',
    ratings: 'Ratings',
    maintainers: 'Maintainers',
    audit: 'Audit',
    purge: 'Purge',
    logout: 'Log out',
    collapse: 'Collapse menu',
    theme: 'Toggle theme',
    language: 'Switch language',
  },
```

```ts
  ratings: {
    title: 'Player Ratings',
    colStars: 'Stars',
    colUser: 'User',
    colGame: 'Game',
    colRoom: 'Room',
    colSubmitted: 'Submitted',
    summary: 'Avg {{avg}} stars · {{count}} total',
  },
```

```ts
    'maps.read': 'View maps',
    'maps.moderate': 'Moderate maps',
    'ratings.read': 'View player ratings',
  },
```

(Insert each block at the position matching its `zhHant` counterpart — the two tables must share
the exact same key tree, or TypeScript's `typeof zhHant` annotation on `en` will fail to compile.)

- [ ] **Step 3: Typecheck + lint**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/i18n/index.ts
git commit -m "feat(admin): listRatings REST call + ratings i18n strings"
```

---

### Task 10: Admin — `RatingsView` + nav wiring

**Files:**

- Create: `apps/admin/src/views/RatingsView.tsx`
- Create: `apps/admin/src/views/RatingsView.test.tsx`
- Modify: `apps/admin/src/store/ui.ts`
- Modify: `apps/admin/src/App.tsx`

**Interfaces:**

- Consumes: `api.listRatings` (Task 9), `useSession().hasPermission('ratings.read')` (existing),
  `fmtDateTime`/`shortId` (existing `lib/fmt.ts`).
- Produces: a `ratings` nav entry rendering a paginated table with an average/total summary line.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/views/RatingsView.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../i18n';
import { RatingsView } from './RatingsView';
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
      return new Response(JSON.stringify(route.body), { status: route.status });
    }),
  );
}

const RATING_ROW = {
  id: 'r1',
  userId: 'u1',
  userDisplayName: 'Alice',
  gameId: 'game-1',
  roomId: 'ABCDE',
  stars: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'ratings', param: null });
  stubFetch({
    '/dashboard/ratings': {
      status: 200,
      body: { ratings: [RATING_ROW], nextCursor: null, avgStars: 4, totalCount: 1 },
    },
  });
});

describe('RatingsView', () => {
  it('lists ratings with the average/total summary', async () => {
    render(<RatingsView />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText('平均 4.0 顆星．共 1 筆')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test RatingsView`
Expected: FAIL — `./RatingsView` module doesn't exist.

- [ ] **Step 3: Wire routing**

In `apps/admin/src/store/ui.ts`, add `'ratings'` to `AdminView`:

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
  | 'maps'
  | 'ratings';
```

And update the path regex in `parsePath`:

```ts
  const m =
    /^\/(users|features|games|rooms|maintainers|audit|purge|maps|ratings)(?:\/([^/]+))?\/?$/.exec(
      p,
    );
```

(`RatingsView` has no drawer, so `openDetail`'s view union and `closeDetail`'s check are left
unchanged — `ratings` never appears there.)

- [ ] **Step 4: Write `RatingsView`**

Create `apps/admin/src/views/RatingsView.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type RatingRow } from '../net/rest';
import { useUi } from '../store/ui';
import { fmtDateTime, shortId } from '../lib/fmt';

export function RatingsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [avgStars, setAvgStars] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (append: string | null) => {
    setLoading(true);
    try {
      const page = await api.listRatings(append ? { cursor: append } : {});
      setRows((prev) => (append ? [...prev, ...page.ratings] : page.ratings));
      setCursor(page.nextCursor);
      setAvgStars(page.avgStars);
      setTotalCount(page.totalCount);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <div>
      <h1 className="oc-page-title">{t('ratings.title')}</h1>
      <p className="oc-muted">
        {t('ratings.summary', {
          avg: avgStars !== null ? avgStars.toFixed(1) : '—',
          count: totalCount,
        })}
      </p>
      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('ratings.colStars')}</th>
              <th>{t('ratings.colUser')}</th>
              <th>{t('ratings.colGame')}</th>
              <th>{t('ratings.colRoom')}</th>
              <th className="num">{t('ratings.colSubmitted')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {'★'.repeat(r.stars)}
                  {'☆'.repeat(5 - r.stars)}
                </td>
                <td>
                  {r.userDisplayName ?? shortId(r.userId)}{' '}
                  <span className="oc-mono oc-muted">{shortId(r.userId)}</span>
                </td>
                <td className="oc-mono">{shortId(r.gameId)}</td>
                <td className="oc-mono">{r.roomId}</td>
                <td className="num">{fmtDateTime(r.createdAt, locale)}</td>
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

- [ ] **Step 5: Add the nav entry**

In `apps/admin/src/App.tsx`, add `Star` to the `lucide-react` import:

```tsx
import {
  Activity,
  ClipboardList,
  DoorOpen,
  Languages,
  LogOut,
  Map as MapIcon,
  Moon,
  ShieldCheck,
  Star,
  Sun,
  Swords,
  ToggleRight,
  Trash2,
  Users,
} from 'lucide-react';
```

Add the `RatingsView` import next to the other view imports:

```tsx
import { RatingsView } from './views/RatingsView';
```

Add the nav entry to the `NAV` array, right after `maps`:

```tsx
const NAV: { view: AdminView; permission: DashboardPermission; icon: typeof Users }[] = [
  { view: 'overview', permission: 'overview.read', icon: Activity },
  { view: 'users', permission: 'users.read', icon: Users },
  { view: 'features', permission: 'users.features', icon: ToggleRight },
  { view: 'games', permission: 'games.read', icon: Swords },
  { view: 'rooms', permission: 'rooms.read', icon: DoorOpen },
  { view: 'maps', permission: 'maps.read', icon: MapIcon },
  { view: 'ratings', permission: 'ratings.read', icon: Star },
  { view: 'maintainers', permission: 'maintainers.read', icon: ShieldCheck },
  { view: 'audit', permission: 'audit.read', icon: ClipboardList },
  { view: 'purge', permission: 'purge.read', icon: Trash2 },
];
```

Add the case to `ActiveView`:

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
    case 'maps':
      return <MapsView />;
    case 'ratings':
      return <RatingsView />;
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

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn workspace @trm/admin test RatingsView`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint, full admin suite**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint && yarn workspace
@trm/admin test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/views/RatingsView.tsx apps/admin/src/views/RatingsView.test.tsx apps/admin/src/store/ui.ts apps/admin/src/App.tsx
git commit -m "feat(admin): Ratings nav view"
```

---

### Task 11: Full-repo verification

**Files:** none (verification only).

- [ ] **Step 1: Full build + test + lint + typecheck**

Run: `yarn build && yarn typecheck && yarn lint && yarn test`
Expected: PASS across every workspace.

- [ ] **Step 2: Manual smoke check**

Start the dev stack (`docker compose up -d mongo`, `yarn workspace @trm/server dev`, `yarn
workspace @trm/web dev`, `yarn workspace @trm/admin dev`) and:

1. Play a practice-with-bots game to completion; on the end-game screen, confirm the 32px star
   widget renders, submit is disabled until a star is picked, submitting shows the "感謝你的評分！"
   state, and the Discord button is visible throughout.
2. Refresh the page mid-scoreboard (or reconnect) — confirm the same game still shows the "thanks"
   state instead of the widget.
3. Grant your dashboard account the `ratings.read` permission (or `viewer` role) and open
   `/admin/ratings` — confirm the submitted rating appears with the correct average/total.

- [ ] **Step 3: No commit for this task** — it's verification only; any issue found sends you back
      to the relevant task above to fix and re-commit there.
