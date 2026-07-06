# Mobile P6 — Compliance + Store Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **REGROUND BEFORE EXECUTING:** this plan was written at spec time (2026-07-06). Before executing, re-verify library versions, file anchors, and the Consumes list against the then-current repo — prior phases will have moved things. In particular: (a) `apps/mobile` and its CI/fastlane layout come from P1–P5 and are referenced here only as contracts; (b) the **preset-chat-messages** plan (`docs/superpowers/plans/2026-07-05-preset-chat-messages.md`) had **already landed** when this plan was written (commits `798c4ba`…`a0fec76`; `packages/shared/src/chat-presets.ts` exists) — re-verify with `rg CHAT_PRESET_IDS packages/shared/src` and treat it as a hard pre-submission dependency if it has somehow regressed; (c) the Play **closed test** (12 testers × 14 days on a personal account) is the calendar-critical path and per the spec timeline should ALREADY be running from P4–P5 — verify the account type and test status first, not last.

**Goal:** Everything between "the app works" and "the app is live in both stores": the UGC compliance package Apple 1.2 / Play UGC policy require (report player, block/mute player, report shared custom map, a dashboard moderation surface), the public web account-deletion page Play's Data-safety form requires, a public privacy-policy page, store listings (zh-Hant + en metadata, phone + tablet screenshots, age ratings, privacy/data-safety forms, EU DSA declaration), and the release-engineering runway (signing verification, build-number scheme tied to `MOBILE_MIN_BUILD`, TestFlight/Play test tracks, staged rollout, launch checklist, IP-risk sign-off).

**Architecture:** Server work is a small, self-contained `apps/server/src/moderation/` module (blocks live on `UserDoc` as a client-side mute list; reports are a new append-mostly `reports` collection) plus a dashboard surface following the existing `src/dashboard/` conventions (zod schemas, `RequirePermission`, `AuditService`, ObjectId cursor pagination). Blocking is **client-side mute only** — it filters chat display and masks the blocked player's name on the blocker's own devices; it never touches game state or the engine. The web gains two public compliance pages (`/account/delete`, `/privacy`) on the existing hand-rolled router, and a report button on the builder's shared-map peek (which also serves the mobile WebView builder). The mobile app consumes the new endpoints through its ported REST client. Store/release work is checklists plus committed artifacts (fastlane metadata, versioning doc, IP-risk sign-off template).

**Tech Stack:** NestJS 10 + nestjs-zod + native Mongo driver + vitest/supertest/mongodb-memory-server (server); React + Vite ^5 + zustand + react-i18next + vitest/@testing-library/react (web + admin); Expo/RN + jest-expo (mobile, contract-level here); fastlane metadata layout (store listings).

## Global Constraints

- Server runs via **swc, never tsx/esbuild**; tests via `yarn workspace @trm/server test --run <file-substring>`. NestJS DI depends on swc's decorator metadata.
- Request validation + OpenAPI come from **one zod source** (`createZodDto` + `apiSchema()`); never hand-write OpenAPI bodies.
- **Hidden-information invariant**: nothing in this plan may expose a LIVE game's hands/tickets/seed/log. Reports carry only what the reporter typed plus denormalized display names and opaque context ids (`gameId`/`roomCode`/`shareCode`); the dashboard already has sanctioned chat/detail views for context.
- The report-category catalog is exactly these 7 ids, in this order, defined once in `@trm/shared` and imported everywhere:
  `HARASSMENT`, `HATE_SPEECH`, `CHEATING`, `SPAM`, `INAPPROPRIATE_NAME`, `INAPPROPRIATE_CONTENT`, `OTHER`.
- New dashboard permissions are exactly `reports.read` and `reports.resolve`, both granted at the **moderator** tier.
- Load-bearing paths (mobile P1–P5 and the store forms reference them; do not rename): `GET/PUT/DELETE /api/v1/me/blocks[/:userId]`, `POST /api/v1/reports/player`, `POST /api/v1/reports/map`, `GET /api/v1/dashboard/reports`, `POST /api/v1/dashboard/reports/:id/resolve`, web `/account/delete` and `/privacy`.
- Every user-facing string ships **zh-Hant (primary) + en** — both locale tables, same key tree.
- Monorepo pins: Yarn 4 with `nodeLinker: node-modules`; `apps/web`/`apps/admin` pin **Vite ^5** (do not bump to 6); the 6th card colour is **PURPLE never PINK**; `@trm/engine` purity rules are untouched by this plan (no engine changes at all).
- Never `git add -A` / `git add .` — stage only files this plan touches (other agents may share the worktree).
- Admin UI: `oc-` class prefix, status always via `SignalBadge` + text (never colour alone), both i18n tables updated together.
- Store copy is **original wording only** — never mention "Ticket to Ride", Days of Wonder, or any of their trade dress in listings, screenshots, keywords, or review notes (clean-room posture, spec Risks).

---

### Task 1: `@trm/shared` — report categories + `reports.*` dashboard permissions

**Files:**
- Create: `packages/shared/src/reports.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/dashboard.ts`
- Create: `packages/shared/test/reports.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `REPORT_CATEGORIES: readonly [...]` (7-element const tuple), `type ReportCategory`, `isReportCategory(v: string): v is ReportCategory`; `DASHBOARD_PERMISSIONS` gains `'reports.read'` and `'reports.resolve'`; `MODERATOR_PERMISSIONS` includes both (and therefore admin/owner do too via escalation).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/reports.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { REPORT_CATEGORIES, isReportCategory } from '../src/reports';
import { ROLE_PERMISSIONS } from '../src/dashboard';

describe('report categories', () => {
  it('has exactly the 7 curated categories, in order', () => {
    expect(REPORT_CATEGORIES).toEqual([
      'HARASSMENT',
      'HATE_SPEECH',
      'CHEATING',
      'SPAM',
      'INAPPROPRIATE_NAME',
      'INAPPROPRIATE_CONTENT',
      'OTHER',
    ]);
  });

  it('isReportCategory accepts every catalog id and rejects anything else', () => {
    for (const c of REPORT_CATEGORIES) expect(isReportCategory(c)).toBe(true);
    expect(isReportCategory('NOT_A_CATEGORY')).toBe(false);
    expect(isReportCategory('')).toBe(false);
  });
});

describe('reports dashboard permissions', () => {
  it('moderator (and up) can read and resolve reports; viewer cannot', () => {
    expect(ROLE_PERMISSIONS.moderator).toContain('reports.read');
    expect(ROLE_PERMISSIONS.moderator).toContain('reports.resolve');
    expect(ROLE_PERMISSIONS.admin).toContain('reports.resolve');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('reports.read');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/shared test --run reports`
Expected: FAIL — `Cannot find module '../src/reports'`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/reports.ts`:

```ts
// Canonical catalog of UGC report categories (Apple 1.2 / Play UGC compliance).
// The wire carries only the id; every client resolves `report.category_<ID>` through
// its own i18n. Defined once here so server validation, the dashboard, the web app,
// and the mobile app can never drift.
export const REPORT_CATEGORIES = [
  'HARASSMENT',
  'HATE_SPEECH',
  'CHEATING',
  'SPAM',
  'INAPPROPRIATE_NAME',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const isReportCategory = (v: string): v is ReportCategory =>
  (REPORT_CATEGORIES as readonly string[]).includes(v);
```

In `packages/shared/src/index.ts`, add alongside the existing exports (next to the `chat-presets` export):

```ts
export * from './reports';
```

In `packages/shared/src/dashboard.ts`, append to `DASHBOARD_PERMISSIONS` (after `'maps.moderate'`, before the closing `] as const;`):

```ts
  'reports.read',
  'reports.resolve',
```

and append to `MODERATOR_PERMISSIONS` (after `'rooms.close'`):

```ts
  'reports.read',
  'reports.resolve',
```

(`ROLE_PERMISSIONS.owner` is the whole `DASHBOARD_PERMISSIONS` array, so owner picks both up automatically; `packages/shared/test/dashboard.spec.ts` line 39 asserts exactly that and keeps passing.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @trm/shared test --run reports`
Expected: PASS
Run: `yarn workspace @trm/shared test`
Expected: PASS (the existing `dashboard.spec.ts` invariants still hold).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/reports.ts packages/shared/src/index.ts packages/shared/src/dashboard.ts packages/shared/test/reports.spec.ts
git commit -m "feat(shared): UGC report categories + reports.* dashboard permissions"
```

---

### Task 2: Server — block list (client-side mute) on the account

**Files:**
- Modify: `apps/server/src/auth/user.repo.ts` (`UserDoc` + three methods after `extendGuestExpiry`)
- Create: `apps/server/src/moderation/moderation.schemas.ts`
- Create: `apps/server/src/moderation/blocks.controller.ts`
- Create: `apps/server/src/moderation/moderation.module.ts`
- Modify: `apps/server/src/app.module.ts`
- Create: `apps/server/test/moderation.e2e.spec.ts`

**Interfaces:**
- Consumes: `AccessTokenGuard`, `CurrentUser`, `UserRepo.findById`, `apiSchema()`.
- Produces:
  - `UserDoc.blockedUserIds?: string[]`
  - `UserRepo.listBlockedUsers(userId): Promise<string[]>`, `UserRepo.addBlockedUser(userId, targetId): Promise<boolean>` (false = cap hit), `UserRepo.removeBlockedUser(userId, targetId): Promise<void>`
  - `GET /api/v1/me/blocks` → `{ blockedUserIds: string[] }` (Bearer, guests included)
  - `PUT /api/v1/me/blocks/:userId` → 204 (400 self, 404 unknown target, 409 list full; idempotent)
  - `DELETE /api/v1/me/blocks/:userId` → 204 (idempotent)
  - `ModerationModule` registered in `AppModule`.

Blocking is a client-side mute list: the server stores it on the account so it follows the user across devices, and clients filter chat/names locally. It deliberately does **not** affect matchmaking, seating, or game state.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/moderation.e2e.spec.ts` (this file grows through Tasks 2–3):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('blocks: the client-side mute list', () => {
  it('starts empty, adds idempotently, lists, and removes', async () => {
    const a = await guest('Blocker');
    const b = await guest('Loudmouth');

    const empty = await request(server()).get('/api/v1/me/blocks').set(auth(a.token)).expect(200);
    expect(empty.body).toEqual({ blockedUserIds: [] });

    await request(server()).put(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(204);
    // Idempotent: re-blocking is a no-op success, not an error.
    await request(server()).put(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(204);

    const one = await request(server()).get('/api/v1/me/blocks').set(auth(a.token)).expect(200);
    expect(one.body.blockedUserIds).toEqual([b.userId]);

    await request(server()).delete(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(204);
    const gone = await request(server()).get('/api/v1/me/blocks').set(auth(a.token)).expect(200);
    expect(gone.body.blockedUserIds).toEqual([]);
  });

  it('rejects blocking yourself (400) and unknown users (404); requires auth (401)', async () => {
    const a = await guest('Selfish');
    await request(server()).put(`/api/v1/me/blocks/${a.userId}`).set(auth(a.token)).expect(400);
    await request(server()).put('/api/v1/me/blocks/no-such-user').set(auth(a.token)).expect(404);
    await request(server()).get('/api/v1/me/blocks').expect(401);
  });

  it('409s when the list is full (cap 500)', async () => {
    const a = await guest('Collector');
    const b = await guest('OneMore');
    await t.db
      .collection('users')
      .updateOne(
        { _id: a.userId as never },
        { $set: { blockedUserIds: Array.from({ length: 500 }, (_, i) => `padding-${i}`) } },
      );
    await request(server()).put(`/api/v1/me/blocks/${b.userId}`).set(auth(a.token)).expect(409);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/server test --run moderation`
Expected: FAIL — `GET /api/v1/me/blocks` 404 (route does not exist).

- [ ] **Step 3: Implement the repo methods**

In `apps/server/src/auth/user.repo.ts`, add to `UserDoc` (after `features?: UserFeature[];`):

```ts
  /** Client-side mute list: ids whose chat/name this account chooses not to see. Capped. */
  blockedUserIds?: string[];
```

Add a module-scope constant near the top of the file:

```ts
/** Upper bound on the mute list so the user doc stays small (compliance UX, not social graph). */
const BLOCK_LIST_MAX = 500;
```

Add after `extendGuestExpiry`:

```ts
  async listBlockedUsers(userId: string): Promise<string[]> {
    const doc = await this.col.findOne({ _id: userId }, { projection: { blockedUserIds: 1 } });
    return doc?.blockedUserIds ?? [];
  }

  /**
   * Adds to the mute list ($addToSet: idempotent). Returns false only when the cap is hit
   * for a NEW entry — re-blocking an existing entry at the cap still reports success.
   */
  async addBlockedUser(userId: string, targetId: string): Promise<boolean> {
    const res = await this.col.updateOne(
      {
        _id: userId,
        $expr: { $lt: [{ $size: { $ifNull: ['$blockedUserIds', []] } }, BLOCK_LIST_MAX] },
      },
      { $addToSet: { blockedUserIds: targetId } },
    );
    if (res.matchedCount > 0) return true;
    return (await this.listBlockedUsers(userId)).includes(targetId);
  }

  async removeBlockedUser(userId: string, targetId: string): Promise<void> {
    await this.col.updateOne({ _id: userId }, { $pull: { blockedUserIds: targetId } });
  }
```

- [ ] **Step 4: Implement schema, controller, module**

Create `apps/server/src/moderation/moderation.schemas.ts`:

```ts
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { REPORT_CATEGORIES } from '@trm/shared';

// zod is the single source for validation + OpenAPI (apiSchema()), per the auth/maps modules.

export const BlockListSchema = z.object({ blockedUserIds: z.array(z.string()) });

export const ReportCategorySchema = z.enum(REPORT_CATEGORIES);

export const ReportPlayerSchema = z.object({
  userId: z.string().min(1).max(100),
  category: ReportCategorySchema,
  message: z.string().trim().max(1000).optional(),
  /** Optional context the client attaches (never trusted for authorization, display only). */
  gameId: z.string().max(100).optional(),
  roomCode: z.string().max(20).optional(),
});
export class ReportPlayerDto extends createZodDto(ReportPlayerSchema) {}

export const ReportMapSchema = z.object({
  shareCode: z.string().trim().min(1).max(20),
  category: ReportCategorySchema,
  message: z.string().trim().max(1000).optional(),
});
export class ReportMapDto extends createZodDto(ReportMapSchema) {}

export const ReportCreatedSchema = z.object({ id: z.string() });
```

Create `apps/server/src/moderation/blocks.controller.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRepo } from '../auth/user.repo';
import { apiSchema } from '../openapi/openapi';
import { BlockListSchema } from './moderation.schemas';
import type { AuthUser } from '../auth/auth.types';

/**
 * The account's client-side mute list (Apple 1.2 / Play UGC "block abusive users").
 * Server-stored so it follows the user across devices; enforcement is client display
 * filtering only — blocking never alters seating, matchmaking, or game state.
 */
@ApiTags('moderation')
@Controller('api/v1/me/blocks')
@UseGuards(AccessTokenGuard)
@ApiBearerAuth('access-token')
export class BlocksController {
  constructor(private readonly users: UserRepo) {}

  @Get()
  @ApiOperation({ summary: "The signed-in account's blocked-user ids" })
  @ApiResponse({ status: 200, schema: apiSchema(BlockListSchema) })
  async list(@CurrentUser() user: AuthUser) {
    return { blockedUserIds: await this.users.listBlockedUsers(user.userId) };
  }

  @Put(':userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Block (mute) a user. Idempotent.' })
  async add(@CurrentUser() user: AuthUser, @Param('userId') targetId: string): Promise<void> {
    if (targetId === user.userId) throw new BadRequestException('cannot block yourself');
    if (!(await this.users.findById(targetId))) throw new NotFoundException('user not found');
    if (!(await this.users.addBlockedUser(user.userId, targetId))) {
      throw new ConflictException('block list full');
    }
  }

  @Delete(':userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unblock a user. Idempotent.' })
  async remove(@CurrentUser() user: AuthUser, @Param('userId') targetId: string): Promise<void> {
    await this.users.removeBlockedUser(user.userId, targetId);
  }
}
```

Create `apps/server/src/moderation/moderation.module.ts` (the reports controller/repo arrive in Task 3 — start with blocks only):

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlocksController } from './blocks.controller';

// UGC compliance surface (Apple 1.2 / Play UGC): block/mute lists + abuse reports.
@Module({
  imports: [AuthModule],
  controllers: [BlocksController],
  providers: [],
  exports: [],
})
export class ModerationModule {}
```

In `apps/server/src/app.module.ts`, add the import and register it in the `imports` array after `PushModule`:

```ts
import { ModerationModule } from './moderation/moderation.module';
```

```ts
    PushModule,
    ModerationModule,
```

- [ ] **Step 5: Run tests**

Run: `yarn workspace @trm/server test --run moderation`
Expected: PASS (the three `blocks` tests)
Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS (UserDoc widening is additive)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/auth/user.repo.ts apps/server/src/moderation/moderation.schemas.ts apps/server/src/moderation/blocks.controller.ts apps/server/src/moderation/moderation.module.ts apps/server/src/app.module.ts apps/server/test/moderation.e2e.spec.ts
git commit -m "feat(server): account-level block list for client-side muting"
```

---

### Task 3: Server — reports collection + report-player / report-map endpoints

**Files:**
- Create: `apps/server/src/moderation/report.repo.ts`
- Create: `apps/server/src/moderation/reports.controller.ts`
- Modify: `apps/server/src/moderation/moderation.module.ts`
- Test: `apps/server/test/moderation.e2e.spec.ts` (extend)

**Interfaces:**
- Consumes: `UserRepo.findById`, `CustomMapRepo.findByShareCode` (exported by `MapsModule`), Task 1's `ReportCategory`, Task 2's schemas file.
- Produces:
  - `reports` Mongo collection (`ReportDoc`; index `{ status: 1, _id: -1 }`)
  - `ReportRepo.create / list(status, limit, cursor) / resolve(id, actorId, actorName, note?)` (open→resolved CAS)
  - `POST /api/v1/reports/player` `{userId, category, message?, gameId?, roomCode?}` → 201 `{id}` (400 self, 404 unknown user)
  - `POST /api/v1/reports/map` `{shareCode, category, message?}` → 201 `{id}` (404 unknown/revoked code)
  - `ModerationModule` exports `ReportRepo` (the dashboard consumes it in Task 4).

Note: `POST /reports/map` deliberately lives **outside** the `mapBuilder` feature gate — anyone who received a share code must be able to report its content (the code itself is the capability, same posture as `GET /maps/content/:hash`). Reports store denormalized display names because reporters/targets can be TTL-expired guests or deleted accounts; the log must stay self-contained (same posture as `dashboardAudit.actorName`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/moderation.e2e.spec.ts`:

```ts
async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

describe('reports: player', () => {
  it('files a report with context and returns its id', async () => {
    const reporter = await guest('Reporter');
    const target = await guest('Menace');
    const res = await request(server())
      .post('/api/v1/reports/player')
      .set(auth(reporter.token))
      .send({
        userId: target.userId,
        category: 'HARASSMENT',
        message: 'said awful things in chat',
        roomCode: 'ABCD',
      })
      .expect(201);
    expect(res.body.id).toBeTruthy();

    const doc = await t.db.collection('reports').findOne({ reportedUserId: target.userId });
    expect(doc).toMatchObject({
      kind: 'player',
      status: 'open',
      category: 'HARASSMENT',
      reporterId: reporter.userId,
      reporterName: 'Reporter',
      reportedName: 'Menace',
      roomCode: 'ABCD',
    });
  });

  it('rejects self-reports (400), unknown targets (404), bad categories (400), anon (401)', async () => {
    const a = await guest('SoloReporter');
    await request(server())
      .post('/api/v1/reports/player')
      .set(auth(a.token))
      .send({ userId: a.userId, category: 'SPAM' })
      .expect(400);
    await request(server())
      .post('/api/v1/reports/player')
      .set(auth(a.token))
      .send({ userId: 'no-such-user', category: 'SPAM' })
      .expect(404);
    await request(server())
      .post('/api/v1/reports/player')
      .set(auth(a.token))
      .send({ userId: a.userId, category: 'NOT_A_CATEGORY' })
      .expect(400);
    await request(server())
      .post('/api/v1/reports/player')
      .send({ userId: 'x', category: 'SPAM' })
      .expect(401);
  });
});

describe('reports: custom map by share code', () => {
  it('resolves the code and snapshots the map identity onto the report', async () => {
    // A registered builder shares a map (mapBuilder feature granted straight in the DB —
    // the dashboard grant flow is already covered by its own suite).
    const owner = await registered('builder@example.com', 'Builder');
    await t.db
      .collection('users')
      .updateOne({ _id: owner.userId as never }, { $set: { features: ['mapBuilder'] } });
    const map = await request(server())
      .post('/api/v1/maps')
      .set(auth(owner.token))
      .send({ nameZh: '測試地圖', nameEn: 'Test Map' })
      .expect(201);
    const share = await request(server())
      .post(`/api/v1/maps/${map.body.id}/share`)
      .set(auth(owner.token))
      .expect(201);
    const code = share.body.shareCode as string;

    const reporter = await guest('MapWatcher');
    const res = await request(server())
      .post('/api/v1/reports/map')
      .set(auth(reporter.token))
      .send({ shareCode: code, category: 'INAPPROPRIATE_CONTENT' })
      .expect(201);
    expect(res.body.id).toBeTruthy();

    const doc = await t.db.collection('reports').findOne({ shareCode: code });
    expect(doc).toMatchObject({
      kind: 'map',
      status: 'open',
      mapId: map.body.id,
      mapOwnerId: owner.userId,
      mapNameZh: '測試地圖',
      mapNameEn: 'Test Map',
    });
  });

  it('404s an unknown share code', async () => {
    const reporter = await guest('LostCode');
    await request(server())
      .post('/api/v1/reports/map')
      .set(auth(reporter.token))
      .send({ shareCode: 'ZZZZZZZZ', category: 'SPAM' })
      .expect(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/server test --run moderation`
Expected: FAIL — `POST /api/v1/reports/player` 404.

- [ ] **Step 3: Create `apps/server/src/moderation/report.repo.ts`**

```ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ObjectId, type Collection, type Db, type Filter } from 'mongodb';
import type { ReportCategory } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';

export type ReportKind = 'player' | 'map';
export type ReportStatus = 'open' | 'resolved';

/**
 * A UGC abuse report (Apple 1.2 / Play UGC). Names are denormalized — reporters and
 * targets can be TTL-expired guests or deleted accounts, and the record must stay
 * self-contained (same posture as dashboardAudit.actorName). Context ids are opaque
 * display hints for moderators, never authorization inputs.
 */
export interface ReportDoc {
  /** Default ObjectId: time-ordered, so it doubles as the pagination cursor. */
  _id: ObjectId;
  kind: ReportKind;
  status: ReportStatus;
  category: ReportCategory;
  message?: string;
  reporterId: string;
  reporterName: string;
  // kind: 'player'
  reportedUserId?: string;
  reportedName?: string;
  gameId?: string;
  roomCode?: string;
  // kind: 'map'
  mapId?: string;
  mapOwnerId?: string;
  shareCode?: string;
  mapNameZh?: string;
  mapNameEn?: string;
  // resolution
  resolvedBy?: string;
  resolvedByName?: string;
  resolutionNote?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

@Injectable()
export class ReportRepo implements OnModuleInit {
  private readonly col: Collection<ReportDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<ReportDoc>('reports');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ status: 1, _id: -1 });
  }

  async create(entry: Omit<ReportDoc, '_id' | 'status' | 'createdAt'>): Promise<ReportDoc> {
    const doc: ReportDoc = { _id: new ObjectId(), status: 'open', createdAt: new Date(), ...entry };
    await this.col.insertOne(doc);
    return doc;
  }

  /** Reverse-chronological page; `cursor` is the `_id` of the prior page's last entry. */
  async list(status: ReportStatus | 'all', limit: number, cursor?: string): Promise<ReportDoc[]> {
    const filter: Filter<ReportDoc> = {};
    if (status !== 'all') filter.status = status;
    if (cursor) {
      try {
        filter._id = { $lt: new ObjectId(cursor) };
      } catch {
        /* malformed cursor → first page (cursors are a convenience, not state) */
      }
    }
    return this.col.find(filter).sort({ _id: -1 }).limit(limit).toArray();
  }

  /** open → resolved CAS; null when missing, malformed, or already resolved. */
  async resolve(
    id: string,
    actorId: string,
    actorName: string,
    note?: string,
  ): Promise<ReportDoc | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      return null;
    }
    return this.col.findOneAndUpdate(
      { _id: oid, status: 'open' },
      {
        $set: {
          status: 'resolved' as const,
          resolvedBy: actorId,
          resolvedByName: actorName,
          resolvedAt: new Date(),
          ...(note ? { resolutionNote: note } : {}),
        },
      },
      { returnDocument: 'after' },
    );
  }
}
```

- [ ] **Step 4: Create `apps/server/src/moderation/reports.controller.ts`**

```ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { UserRepo } from '../auth/user.repo';
import { CustomMapRepo } from '../maps/custom-map.repo';
import { apiSchema } from '../openapi/openapi';
import { ReportRepo } from './report.repo';
import {
  ReportCreatedSchema,
  ReportMapDto,
  ReportMapSchema,
  ReportPlayerDto,
  ReportPlayerSchema,
} from './moderation.schemas';
import type { AuthUser } from '../auth/auth.types';

/**
 * UGC abuse reporting (Apple 1.2 / Play UGC). Open to every authenticated account,
 * guests included. Map reporting is deliberately OUTSIDE the mapBuilder feature gate:
 * anyone holding a share code must be able to report its content — the code itself is
 * the capability, the same posture as GET /maps/content/:hash.
 */
@ApiTags('moderation')
@Controller('api/v1/reports')
@UseGuards(AccessTokenGuard)
@ApiBearerAuth('access-token')
export class ReportsController {
  constructor(
    private readonly reports: ReportRepo,
    private readonly users: UserRepo,
    private readonly maps: CustomMapRepo,
  ) {}

  @Post('player')
  @HttpCode(201)
  @ApiOperation({ summary: 'Report a player (harassment, cheating, inappropriate name, …)' })
  @ApiBody({ schema: apiSchema(ReportPlayerSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(ReportCreatedSchema) })
  async reportPlayer(@CurrentUser() user: AuthUser, @Body() body: ReportPlayerDto) {
    if (body.userId === user.userId) throw new BadRequestException('cannot report yourself');
    const target = await this.users.findById(body.userId);
    if (!target) throw new NotFoundException('user not found');
    const doc = await this.reports.create({
      kind: 'player',
      category: body.category,
      ...(body.message ? { message: body.message } : {}),
      reporterId: user.userId,
      reporterName: user.displayName,
      reportedUserId: target._id,
      reportedName: target.displayName,
      ...(body.gameId ? { gameId: body.gameId } : {}),
      ...(body.roomCode ? { roomCode: body.roomCode } : {}),
    });
    return { id: doc._id.toHexString() };
  }

  @Post('map')
  @HttpCode(201)
  @ApiOperation({ summary: 'Report a shared custom map by its share code' })
  @ApiBody({ schema: apiSchema(ReportMapSchema) })
  @ApiResponse({ status: 201, schema: apiSchema(ReportCreatedSchema) })
  async reportMap(@CurrentUser() user: AuthUser, @Body() body: ReportMapDto) {
    const map = await this.maps.findByShareCode(body.shareCode);
    if (!map) throw new NotFoundException('map not found');
    const doc = await this.reports.create({
      kind: 'map',
      category: body.category,
      ...(body.message ? { message: body.message } : {}),
      reporterId: user.userId,
      reporterName: user.displayName,
      mapId: map._id,
      mapOwnerId: map.ownerId,
      shareCode: body.shareCode,
      mapNameZh: map.nameZh,
      mapNameEn: map.nameEn,
    });
    return { id: doc._id.toHexString() };
  }
}
```

- [ ] **Step 5: Wire the module**

Update `apps/server/src/moderation/moderation.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MapsModule } from '../maps/maps.module';
import { BlocksController } from './blocks.controller';
import { ReportsController } from './reports.controller';
import { ReportRepo } from './report.repo';

// UGC compliance surface (Apple 1.2 / Play UGC): block/mute lists + abuse reports.
// The dashboard surfaces + resolves reports (DashboardModule imports ReportRepo).
@Module({
  imports: [AuthModule, MapsModule],
  controllers: [BlocksController, ReportsController],
  providers: [ReportRepo],
  exports: [ReportRepo],
})
export class ModerationModule {}
```

- [ ] **Step 6: Run tests**

Run: `yarn workspace @trm/server test --run moderation`
Expected: PASS (blocks + both report describes)
Run: `yarn workspace @trm/server test --run maps.e2e`
Expected: PASS (feature-gated maps routes untouched)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/moderation/report.repo.ts apps/server/src/moderation/reports.controller.ts apps/server/src/moderation/moderation.module.ts apps/server/test/moderation.e2e.spec.ts
git commit -m "feat(server): UGC report endpoints for players and shared custom maps"
```

---

### Task 4: Server — dashboard reports surface (+ audit + docs)

**Files:**
- Modify: `apps/server/src/dashboard/audit.repo.ts` (action + target unions)
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts`
- Create: `apps/server/src/dashboard/dashboard-reports.service.ts`
- Create: `apps/server/src/dashboard/dashboard-reports.controller.ts`
- Modify: `apps/server/src/dashboard/dashboard.module.ts`
- Modify: `apps/server/CLAUDE.md`
- Create: `apps/server/test/dashboard-reports.e2e.spec.ts`

**Interfaces:**
- Consumes: `ReportRepo` (Task 3, exported by `ModerationModule`), `DashboardGuard` + `RequirePermission`, `AuditService.log`, Task 1's permissions.
- Produces:
  - `GET /api/v1/dashboard/reports?status=open|resolved|all&limit&cursor` → `{ reports: ReportRow[], nextCursor }` (permission `reports.read`)
  - `POST /api/v1/dashboard/reports/:id/resolve` `{note?}` → resolved `ReportRow` (permission `reports.resolve`; 404 unknown/already-resolved; audited as `report.resolve`)
  - `DashboardAuditAction` gains `'report.resolve'`; `AuditTarget.type` gains `'report'`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/dashboard-reports.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string) {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

async function maintainer(email: string, role: 'viewer' | 'moderator') {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName: role })
    .expect(201);
  await t.db.collection('dashboardAccounts').insertOne({
    _id: res.body.user.id,
    role,
    grantedBy: 'test',
    grantedAt: new Date(),
    updatedAt: new Date(),
  } as never);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

async function fileReport(category: string) {
  const reporter = await guest(`R-${category}`);
  const target = await guest(`T-${category}`);
  const res = await request(server())
    .post('/api/v1/reports/player')
    .set(auth(reporter.token))
    .send({ userId: target.userId, category })
    .expect(201);
  return res.body.id as string;
}

let moderator: { userId: string; token: string };
let viewer: { userId: string; token: string };

beforeAll(async () => {
  t = await createTestApp();
  moderator = await maintainer('mod@example.com', 'moderator');
  viewer = await maintainer('viewer@example.com', 'viewer');
}, 60_000);
afterAll(() => t.close());

describe('dashboard reports', () => {
  it('lists open reports newest-first with cursor pagination; viewer is 403', async () => {
    const first = await fileReport('SPAM');
    const second = await fileReport('HARASSMENT');

    await request(server()).get('/api/v1/dashboard/reports').set(auth(viewer.token)).expect(403);

    const page1 = await request(server())
      .get('/api/v1/dashboard/reports')
      .query({ limit: 1 })
      .set(auth(moderator.token))
      .expect(200);
    expect(page1.body.reports).toHaveLength(1);
    expect(page1.body.reports[0].id).toBe(second);
    expect(page1.body.reports[0].status).toBe('open');
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await request(server())
      .get('/api/v1/dashboard/reports')
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set(auth(moderator.token))
      .expect(200);
    expect(page2.body.reports[0].id).toBe(first);
  });

  it('resolves once (open→resolved CAS), audits, and 404s a second resolve', async () => {
    const id = await fileReport('CHEATING');

    const resolved = await request(server())
      .post(`/api/v1/dashboard/reports/${id}/resolve`)
      .set(auth(moderator.token))
      .send({ note: 'warned the player' })
      .expect(200);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolutionNote).toBe('warned the player');

    await request(server())
      .post(`/api/v1/dashboard/reports/${id}/resolve`)
      .set(auth(moderator.token))
      .send({})
      .expect(404);

    const audit = await t.db
      .collection('dashboardAudit')
      .findOne({ action: 'report.resolve', 'target.id': id });
    expect(audit).toBeTruthy();

    // The resolved report leaves the default (open) list but shows under status=resolved.
    const open = await request(server())
      .get('/api/v1/dashboard/reports')
      .set(auth(moderator.token))
      .expect(200);
    expect(open.body.reports.map((r: { id: string }) => r.id)).not.toContain(id);
    const done = await request(server())
      .get('/api/v1/dashboard/reports')
      .query({ status: 'resolved' })
      .set(auth(moderator.token))
      .expect(200);
    expect(done.body.reports.map((r: { id: string }) => r.id)).toContain(id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/server test --run dashboard-reports`
Expected: FAIL — `GET /api/v1/dashboard/reports` 404.

- [ ] **Step 3: Widen the audit unions**

In `apps/server/src/dashboard/audit.repo.ts`, add to `DashboardAuditAction` (after `'map.transfer'`):

```ts
  | 'report.resolve';
```

and change `AuditTarget`:

```ts
export interface AuditTarget {
  type: 'user' | 'game' | 'room' | 'maintainer' | 'map' | 'report';
  id: string;
}
```

- [ ] **Step 4: Dashboard schemas**

In `apps/server/src/dashboard/dashboard.schemas.ts`, extend the `@trm/shared` import with `REPORT_CATEGORIES` and append a new section at the end:

```ts
// ---- reports (UGC moderation) ---------------------------------------------------------

export const ReportsListQuerySchema = z.object({
  status: z.enum(['open', 'resolved', 'all']).default('open'),
  limit,
  cursor,
});
export class ReportsListQueryDto extends createZodDto(ReportsListQuerySchema) {}

export const ResolveReportSchema = z.object({ note: z.string().trim().max(500).optional() });
export class ResolveReportDto extends createZodDto(ResolveReportSchema) {}

export const ReportRowSchema = z.object({
  id: z.string(),
  kind: z.enum(['player', 'map']),
  status: z.enum(['open', 'resolved']),
  category: z.enum(REPORT_CATEGORIES),
  reporterId: z.string(),
  reporterName: z.string(),
  message: z.string().optional(),
  reportedUserId: z.string().optional(),
  reportedName: z.string().optional(),
  gameId: z.string().optional(),
  roomCode: z.string().optional(),
  mapId: z.string().optional(),
  shareCode: z.string().optional(),
  mapNameZh: z.string().optional(),
  mapNameEn: z.string().optional(),
  resolvedByName: z.string().optional(),
  resolutionNote: z.string().optional(),
  resolvedAt: z.string().optional(),
  createdAt: z.string(),
});

export const ReportsListSchema = z.object({
  reports: z.array(ReportRowSchema),
  nextCursor: z.string().nullable(),
});
```

- [ ] **Step 5: Service + controller**

Create `apps/server/src/dashboard/dashboard-reports.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { ReportRepo, type ReportDoc } from '../moderation/report.repo';
import { AuditService } from './audit.service';
import type { AuthUser } from '../auth/auth.types';

const toRow = (d: ReportDoc) => ({
  id: d._id.toHexString(),
  kind: d.kind,
  status: d.status,
  category: d.category,
  reporterId: d.reporterId,
  reporterName: d.reporterName,
  ...(d.message ? { message: d.message } : {}),
  ...(d.reportedUserId ? { reportedUserId: d.reportedUserId } : {}),
  ...(d.reportedName ? { reportedName: d.reportedName } : {}),
  ...(d.gameId ? { gameId: d.gameId } : {}),
  ...(d.roomCode ? { roomCode: d.roomCode } : {}),
  ...(d.mapId ? { mapId: d.mapId } : {}),
  ...(d.shareCode ? { shareCode: d.shareCode } : {}),
  ...(d.mapNameZh ? { mapNameZh: d.mapNameZh } : {}),
  ...(d.mapNameEn ? { mapNameEn: d.mapNameEn } : {}),
  ...(d.resolvedByName ? { resolvedByName: d.resolvedByName } : {}),
  ...(d.resolutionNote ? { resolutionNote: d.resolutionNote } : {}),
  ...(d.resolvedAt ? { resolvedAt: d.resolvedAt.toISOString() } : {}),
  createdAt: d.createdAt.toISOString(),
});

@Injectable()
export class DashboardReportsService {
  constructor(
    private readonly reports: ReportRepo,
    private readonly audit: AuditService,
  ) {}

  async list(query: { status: 'open' | 'resolved' | 'all'; limit: number; cursor?: string }) {
    // Fetch one extra row to learn whether a next page exists (audit-list idiom).
    const docs = await this.reports.list(query.status, query.limit + 1, query.cursor);
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = docs.length > query.limit && last ? last._id.toHexString() : null;
    return { reports: page.map(toRow), nextCursor };
  }

  async resolve(actor: AuthUser, id: string, note?: string) {
    const doc = await this.reports.resolve(id, actor.userId, actor.displayName, note);
    if (!doc) throw new NotFoundException('report not found or already resolved');
    await this.audit.log(
      actor,
      'report.resolve',
      { type: 'report', id },
      { kind: doc.kind, category: doc.category, ...(note ? { note } : {}) },
    );
    return toRow(doc);
  }
}
```

Create `apps/server/src/dashboard/dashboard-reports.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardReportsService } from './dashboard-reports.service';
import {
  ReportRowSchema,
  ReportsListQueryDto,
  ReportsListSchema,
  ResolveReportDto,
  ResolveReportSchema,
} from './dashboard.schemas';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard')
export class DashboardReportsController {
  constructor(private readonly reports: DashboardReportsService) {}

  @Get('reports')
  @RequirePermission('reports.read')
  @ApiOperation({ summary: 'UGC reports (players + shared custom maps), newest first' })
  @ApiResponse({ status: 200, schema: apiSchema(ReportsListSchema) })
  list(@Query() query: ReportsListQueryDto) {
    return this.reports.list(query);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  @RequirePermission('reports.resolve')
  @ApiOperation({ summary: 'Mark a report resolved (audited; open→resolved is one-way)' })
  @ApiBody({ schema: apiSchema(ResolveReportSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(ReportRowSchema) })
  resolve(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Body() body: ResolveReportDto) {
    return this.reports.resolve(actor, id, body.note);
  }
}
```

In `apps/server/src/dashboard/dashboard.module.ts`: add `ModerationModule` to `imports`, `DashboardReportsController` to `controllers`, `DashboardReportsService` to `providers`, with the imports:

```ts
import { ModerationModule } from '../moderation/moderation.module';
import { DashboardReportsService } from './dashboard-reports.service';
import { DashboardReportsController } from './dashboard-reports.controller';
```

- [ ] **Step 6: Run tests**

Run: `yarn workspace @trm/server test --run dashboard-reports`
Expected: PASS
Run: `yarn workspace @trm/server test`
Expected: full suite PASS (permission additions are additive; owner-role invariants live in `@trm/shared` and were extended in Task 1).

- [ ] **Step 7: Document**

In `apps/server/CLAUDE.md`, append a bullet to "Auth, lobby, bots" (after the `src/bots/` bullet):

```markdown
- `src/moderation/` — the UGC compliance surface (Apple 1.2 / Play UGC): `GET/PUT/DELETE
  /me/blocks[/:userId]` maintains a capped **client-side mute list** on `UserDoc.blockedUserIds`
  (display filtering only — never touches seating or game state), and `POST /reports/player` +
  `POST /reports/map` (by share code, deliberately OUTSIDE the mapBuilder gate — the code is the
  capability) append to the `reports` collection with denormalized names (guests TTL-expire; the
  record stays self-contained). Moderators work the queue at `GET /dashboard/reports` /
  `POST /dashboard/reports/:id/resolve` (`reports.read`/`reports.resolve`, moderator+), resolution
  is a one-way open→resolved CAS audited as `report.resolve`.
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/dashboard/audit.repo.ts apps/server/src/dashboard/dashboard.schemas.ts apps/server/src/dashboard/dashboard-reports.service.ts apps/server/src/dashboard/dashboard-reports.controller.ts apps/server/src/dashboard/dashboard.module.ts apps/server/CLAUDE.md apps/server/test/dashboard-reports.e2e.spec.ts
git commit -m "feat(server): dashboard reports queue with audited resolution"
```

---

### Task 5: Admin — Reports view

**Files:**
- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/store/ui.ts` (`AdminView` + `parsePath` regex)
- Modify: `apps/admin/src/App.tsx` (NAV + `ActiveView`)
- Modify: `apps/admin/src/i18n/index.ts` (both locale tables)
- Create: `apps/admin/src/views/ReportsView.tsx`
- Create: `apps/admin/src/views/ReportsView.test.tsx`

**Interfaces:**
- Consumes: Task 4's endpoints; `SignalBadge`, `ConfirmDialog` (`withReason` passes the note), `useSession.hasPermission`, `fmtDateTime`/`shortId`, the `stubFetch` test idiom.
- Produces: `api.listReports({status?, cursor?})`, `api.resolveReport(id, note?)`, `ReportRow`/`ReportsPage` types, nav entry `reports` gated on `reports.read`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/views/ReportsView.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../i18n';
import { ReportsView } from './ReportsView';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';

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

const OPEN_ROW = {
  id: 'r1',
  kind: 'player',
  status: 'open',
  category: 'HARASSMENT',
  reporterId: 'u-rep',
  reporterName: 'Reporter',
  reportedUserId: 'u-bad',
  reportedName: 'Menace',
  roomCode: 'ABCD',
  message: 'said awful things',
  createdAt: '2026-07-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({ view: 'reports', param: null });
  useSession.setState({
    phase: 'ready',
    user: { id: 'u1', displayName: 'Ops', isGuest: false },
    role: 'moderator',
    permissions: new Set(['reports.read', 'reports.resolve']),
  });
});

describe('ReportsView', () => {
  it('renders an open report row with target, category, and context', async () => {
    stubFetch({ '/dashboard/reports?': { status: 200, body: { reports: [OPEN_ROW], nextCursor: null } } });
    render(<ReportsView />);
    expect(await screen.findByText('Menace')).toBeInTheDocument();
    expect(screen.getByText('騷擾')).toBeInTheDocument(); // category_HARASSMENT zh-Hant
    expect(screen.getByText('said awful things')).toBeInTheDocument();
    expect(screen.getByText(/ABCD/)).toBeInTheDocument();
  });

  it('resolves through the confirm dialog and flips the row to resolved', async () => {
    stubFetch({
      '/dashboard/reports/r1/resolve': {
        status: 200,
        body: { ...OPEN_ROW, status: 'resolved', resolvedByName: 'Ops' },
      },
      '/dashboard/reports?': { status: 200, body: { reports: [OPEN_ROW], nextCursor: null } },
    });
    render(<ReportsView />);
    fireEvent.click(await screen.findByText('標記已處理'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '標記已處理' }));
    expect(await screen.findByText('已處理')).toBeInTheDocument();
  });

  it('hides the resolve button without reports.resolve', async () => {
    useSession.setState({ permissions: new Set(['reports.read']) });
    stubFetch({ '/dashboard/reports?': { status: 200, body: { reports: [OPEN_ROW], nextCursor: null } } });
    render(<ReportsView />);
    expect(await screen.findByText('Menace')).toBeInTheDocument();
    expect(screen.queryByText('標記已處理')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test ReportsView.test`
Expected: FAIL — cannot resolve `./ReportsView`.

- [ ] **Step 3: REST client + router + nav**

`apps/admin/src/net/rest.ts` — add types after `AuditEntry` and endpoints after `listAudit`:

```ts
export type ReportStatusFilter = 'open' | 'resolved' | 'all';
export interface ReportRow {
  id: string;
  kind: 'player' | 'map';
  status: 'open' | 'resolved';
  category: string;
  reporterId: string;
  reporterName: string;
  message?: string;
  reportedUserId?: string;
  reportedName?: string;
  gameId?: string;
  roomCode?: string;
  mapId?: string;
  shareCode?: string;
  mapNameZh?: string;
  mapNameEn?: string;
  resolvedByName?: string;
  resolutionNote?: string;
  resolvedAt?: string;
  createdAt: string;
}
export type ReportsPage = { reports: ReportRow[]; nextCursor: string | null };
```

```ts
  listReports: (opts: { status?: ReportStatusFilter; cursor?: string } = {}) =>
    req<ReportsPage>('GET', `/dashboard/reports${qs(opts)}`),
  resolveReport: (id: string, note?: string) =>
    req<ReportRow>('POST', `/dashboard/reports/${encodeURIComponent(id)}/resolve`, { note }),
```

`apps/admin/src/store/ui.ts` — add `'reports'` to the `AdminView` union and to the `parsePath` regex alternation:

```ts
  const m = /^\/(users|features|games|rooms|maintainers|audit|purge|maps|reports)(?:\/([^/]+))?\/?$/.exec(
    p,
  );
```

`apps/admin/src/App.tsx` — import `Flag` from `lucide-react` and `ReportsView`; add to `NAV` after the `maps` entry:

```ts
  { view: 'reports', permission: 'reports.read', icon: Flag },
```

and to `ActiveView`:

```tsx
    case 'reports':
      return <ReportsView />;
```

- [ ] **Step 4: i18n (both tables — same key tree)**

`apps/admin/src/i18n/index.ts` — add `reports: '檢舉'` to the zh-Hant `nav` block and `reports: 'Reports'` to the en `nav` block, plus a new top-level `reports` section in each:

zh-Hant:

```ts
  reports: {
    tabOpen: '待處理',
    tabResolved: '已處理',
    tabAll: '全部',
    kindPlayer: '玩家',
    kindMap: '自訂地圖',
    statusOpen: '待處理',
    statusResolved: '已處理',
    reporter: '檢舉人',
    target: '對象',
    context: '情境',
    resolve: '標記已處理',
    resolveConfirmTitle: '標記為已處理？',
    resolveConfirmBody: '此動作會記錄在稽核日誌，且無法復原。附註為選填。',
    empty: '目前沒有檢舉。',
    loadMore: '載入更多',
    category_HARASSMENT: '騷擾',
    category_HATE_SPEECH: '仇恨言論',
    category_CHEATING: '作弊',
    category_SPAM: '濫發訊息',
    category_INAPPROPRIATE_NAME: '不當名稱',
    category_INAPPROPRIATE_CONTENT: '不當內容',
    category_OTHER: '其他',
  },
```

en:

```ts
  reports: {
    tabOpen: 'Open',
    tabResolved: 'Resolved',
    tabAll: 'All',
    kindPlayer: 'Player',
    kindMap: 'Custom map',
    statusOpen: 'Open',
    statusResolved: 'Resolved',
    reporter: 'Reporter',
    target: 'Target',
    context: 'Context',
    resolve: 'Mark resolved',
    resolveConfirmTitle: 'Mark this report resolved?',
    resolveConfirmBody: 'This is recorded in the audit log and cannot be undone. The note is optional.',
    empty: 'No reports.',
    loadMore: 'Load more',
    category_HARASSMENT: 'Harassment',
    category_HATE_SPEECH: 'Hate speech',
    category_CHEATING: 'Cheating',
    category_SPAM: 'Spam',
    category_INAPPROPRIATE_NAME: 'Inappropriate name',
    category_INAPPROPRIATE_CONTENT: 'Inappropriate content',
    category_OTHER: 'Other',
  },
```

- [ ] **Step 5: The view**

Create `apps/admin/src/views/ReportsView.tsx`. Before writing markup, open `apps/admin/src/views/RoomsView.tsx` and mirror its list/row/tab class names exactly (`oc-` prefix convention) — the structure below is the behavior contract:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ReportRow, type ReportStatusFilter } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { SignalBadge } from '../components/SignalBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { fmtDateTime, shortId } from '../lib/fmt';

const TABS: ReportStatusFilter[] = ['open', 'resolved', 'all'];
const TAB_KEY: Record<ReportStatusFilter, string> = {
  open: 'reports.tabOpen',
  resolved: 'reports.tabResolved',
  all: 'reports.tabAll',
};

export function ReportsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canResolve = useSession((s) => s.hasPermission('reports.resolve'));
  const [tab, setTab] = useState<ReportStatusFilter>('open');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReportRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (status: ReportStatusFilter, after?: string) => {
    setError(null);
    try {
      const page = await api.listReports({ status, ...(after ? { cursor: after } : {}) });
      setRows((prev) => (after ? [...prev, ...page.reports] : page.reports));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  const resolve = async (row: ReportRow, note?: string) => {
    setBusy(true);
    try {
      const updated = await api.resolveReport(row.id, note);
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const targetOf = (r: ReportRow): string =>
    r.kind === 'player'
      ? (r.reportedName ?? shortId(r.reportedUserId ?? ''))
      : `${r.mapNameZh ?? ''} (${r.mapNameEn ?? ''})`;
  const contextOf = (r: ReportRow): string =>
    [
      r.gameId ? `game ${shortId(r.gameId)}` : null,
      r.roomCode ? `room ${r.roomCode}` : null,
      r.shareCode ? `code ${r.shareCode}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="oc-view">
      <div className="oc-tabs" role="tablist">
        {TABS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            className={`oc-tab ${tab === s ? 'active' : ''}`}
            onClick={() => setTab(s)}
          >
            {t(TAB_KEY[s])}
          </button>
        ))}
      </div>
      {error && <p className="oc-error">{error}</p>}
      {rows.length === 0 && !error && <p className="oc-muted">{t('reports.empty')}</p>}
      <ul className="oc-list">
        {rows.map((r) => (
          <li key={r.id} className="oc-list-row">
            <div className="oc-row-head">
              <SignalBadge
                aspect={r.status === 'open' ? 'caution' : 'clear'}
                label={t(r.status === 'open' ? 'reports.statusOpen' : 'reports.statusResolved')}
              />
              <span className="oc-chip">
                {t(r.kind === 'player' ? 'reports.kindPlayer' : 'reports.kindMap')}
              </span>
              <span className="oc-chip">{t(`reports.category_${r.category}`)}</span>
              <span className="oc-muted">{fmtDateTime(r.createdAt, locale)}</span>
            </div>
            <div className="oc-row-body">
              <span>
                {t('reports.reporter')}: {r.reporterName}
              </span>
              <span>
                {t('reports.target')}: {targetOf(r)}
              </span>
              {contextOf(r) && (
                <span className="oc-muted">
                  {t('reports.context')}: {contextOf(r)}
                </span>
              )}
              {r.message && <blockquote className="oc-quote">{r.message}</blockquote>}
              {r.status === 'resolved' && r.resolvedByName && (
                <span className="oc-muted">
                  {r.resolvedByName}
                  {r.resolutionNote ? ` — ${r.resolutionNote}` : ''}
                </span>
              )}
            </div>
            {r.status === 'open' && canResolve && (
              <button className="oc-btn" onClick={() => setConfirming(r)}>
                {t('reports.resolve')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <button className="oc-btn" onClick={() => void load(tab, cursor)}>
          {t('reports.loadMore')}
        </button>
      )}
      {confirming && (
        <ConfirmDialog
          title={t('reports.resolveConfirmTitle')}
          body={t('reports.resolveConfirmBody')}
          confirmLabel={t('reports.resolve')}
          withReason
          busy={busy}
          onConfirm={(note) => void resolve(confirming, note)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

Run: `yarn workspace @trm/admin test ReportsView.test`
Expected: PASS
Run: `yarn workspace @trm/admin test`
Expected: full admin suite PASS (if `App.test.tsx` pins the nav list, extend its expectations for the new `reports` entry)
Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/store/ui.ts apps/admin/src/App.tsx apps/admin/src/i18n/index.ts apps/admin/src/views/ReportsView.tsx apps/admin/src/views/ReportsView.test.tsx
git commit -m "feat(admin): UGC reports queue view with audited resolution"
```

---

### Task 6: Web — public account-deletion page + privacy-policy page

**Files:**
- Modify: `apps/web/src/net/rest.ts` (`api.deleteAccount`)
- Modify: `apps/web/src/store/ui.ts` (two routes)
- Modify: `apps/web/src/App.tsx` (render both screens)
- Modify: `apps/web/src/i18n/index.ts` (deletion strings, both locales)
- Create: `apps/web/src/screens/DeleteAccountScreen.tsx`
- Create: `apps/web/src/screens/PrivacyScreen.tsx`
- Create: `apps/web/src/screens/DeleteAccountScreen.test.tsx`

**Interfaces:**
- Consumes: `DELETE /api/v1/auth/me` (P0-c, landed: 204, clears the refresh cookie, 409 while the account still holds dashboard access), the hand-rolled router (`syncFromUrl`/`navigateAfterAuth`), `useSession`.
- Produces: `https://<origin>/account/delete` (the URL for Play's Data-safety form) and `https://<origin>/privacy` (the privacy-policy URL both stores require). `/privacy` is public; `/account/delete` is auth-gated through `/login?redirect=/account/delete` — **the login gate IS the re-auth** for a cold visit from the store listing, and a same-session visitor must additionally re-type their display name.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/screens/DeleteAccountScreen.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../i18n';
import { DeleteAccountScreen } from './DeleteAccountScreen';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api, ApiError } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../net/rest')>();
  return {
    ...mod,
    setOnTokenChange: vi.fn(),
    setAccessToken: vi.fn(),
    api: { deleteAccount: vi.fn() },
  };
});

const mocked = api as unknown as { deleteAccount: ReturnType<typeof vi.fn> };

const user = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: [],
} as const;

describe('DeleteAccountScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: { ...user }, booting: false });
    window.history.replaceState(null, '', '/account/delete');
  });

  it('routing: an anonymous visit gates to /login with the redirect param', () => {
    useSession.setState({ user: null });
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('login');
    expect(window.location.search).toContain('redirect=%2Faccount%2Fdelete');
  });

  it('routing: an authed visit lands on the screen', () => {
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('deleteAccount');
  });

  it('keeps the button disabled until the display name is typed, then deletes', async () => {
    mocked.deleteAccount.mockResolvedValue(undefined);
    render(<DeleteAccountScreen />);
    const confirm = screen.getByRole('button', { name: /永久刪除帳號/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/輸入.*Tester/), { target: { value: 'Tester' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocked.deleteAccount).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/帳號已刪除/)).toBeInTheDocument();
    expect(useSession.getState().user).toBeNull();
  });

  it('surfaces the maintainer 409 as a specific message', async () => {
    mocked.deleteAccount.mockRejectedValue(new ApiError(409, 'maintainer'));
    render(<DeleteAccountScreen />);
    fireEvent.change(screen.getByLabelText(/輸入.*Tester/), { target: { value: 'Tester' } });
    fireEvent.click(screen.getByRole('button', { name: /永久刪除帳號/ }));
    expect(await screen.findByText(/仍具有維護者權限/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/web test --run DeleteAccountScreen`
Expected: FAIL — cannot resolve `./DeleteAccountScreen` (and the routing tests fail: `/account/delete` currently falls through to home/login-root).

- [ ] **Step 3: REST client**

In `apps/web/src/net/rest.ts`, add to the `api` object after `logout`:

```ts
  /** Irreversible. 204 on success; 409 while the account still holds dashboard access. */
  deleteAccount: () => req<void>('DELETE', '/auth/me', {}).then(() => setAccessToken(null)),
```

- [ ] **Step 4: Routes**

In `apps/web/src/store/ui.ts`:

1. Extend the `View` union with `'deleteAccount' | 'privacy'`.
2. Add path constants next to `HISTORY_PATH`:

```ts
const DELETE_ACCOUNT_PATH = '/account/delete';
const PRIVACY_PATH = '/privacy';
```

3. In `syncFromUrl`, insert BEFORE the room-code check (public page first, then the gated one):

```ts
    // Public privacy policy — reachable signed out (store listings link straight here).
    if (path === PRIVACY_PATH) {
      disconnectGame();
      set({ view: 'privacy', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    // Account deletion (Play Data-safety URL): the login gate is the re-auth for cold visits.
    if (path === DELETE_ACCOUNT_PATH) {
      if (!authed) {
        get().navigateLogin(DELETE_ACCOUNT_PATH);
        return;
      }
      disconnectGame();
      set({
        view: 'deleteAccount',
        roomCode: null,
        gameId: null,
        ticket: null,
        replayGameId: null,
      });
      return;
    }
```

4. In `navigateAfterAuth`, insert before the final home fallback:

```ts
    if (target === DELETE_ACCOUNT_PATH) {
      replacePath(DELETE_ACCOUNT_PATH);
      set({
        view: 'deleteAccount',
        roomCode: null,
        gameId: null,
        ticket: null,
        replayGameId: null,
      });
      return;
    }
```

- [ ] **Step 5: Screens + i18n + App wiring**

Add to `apps/web/src/i18n/index.ts` — zh-Hant table:

```ts
      deleteAccount: {
        title: '刪除帳號',
        signedInAs: '目前登入身分：{{name}}',
        consequence1: '你的帳號、登入方式與所有工作階段將被永久移除。',
        consequence2: '你的自訂地圖草稿將被刪除（已開始過對局的地圖內容仍會保留供重播）。',
        consequence3: '已完成對局的紀錄會匿名化保留（其他玩家的戰績不受影響）。',
        consequence4: '此動作無法復原。',
        typeName: '請輸入你的顯示名稱「{{name}}」以確認：',
        cancel: '取消',
        confirm: '永久刪除帳號',
        maintainerBlocked: '此帳號仍具有維護者權限，請先在管理後台撤銷後再刪除。',
        doneTitle: '帳號已刪除',
        doneBody: '你的帳號與個人資料已移除。感謝你搭乘台鐵任務。',
      },
```

en table (same key tree):

```ts
      deleteAccount: {
        title: 'Delete account',
        signedInAs: 'Signed in as {{name}}',
        consequence1: 'Your account, sign-in methods, and all sessions will be permanently removed.',
        consequence2:
          'Your custom map drafts will be deleted (published content of already-played games is kept for replays).',
        consequence3: 'Finished-game records are kept anonymized (other players keep their history).',
        consequence4: 'This cannot be undone.',
        typeName: 'Type your display name "{{name}}" to confirm:',
        cancel: 'Cancel',
        confirm: 'Delete account permanently',
        maintainerBlocked:
          'This account still holds maintainer access. Revoke it from the dashboard first, then delete.',
        doneTitle: 'Account deleted',
        doneBody: 'Your account and personal data have been removed. Thanks for riding TRMission.',
      },
```

Create `apps/web/src/screens/DeleteAccountScreen.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';

/**
 * Public account-deletion page. Google Play's Data-safety form requires an HTTPS URL
 * that works without the app; the mobile app's in-app deletion (Apple 5.1.1(v)) calls
 * the same DELETE /auth/me. Anonymous visitors are gated through
 * /login?redirect=/account/delete — that sign-in IS the re-auth; a same-session
 * visitor must additionally re-type their display name below.
 */
export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const goHome = useUi((s) => s.goHome);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="card stack">
        <h2>{t('deleteAccount.doneTitle')}</h2>
        <p>{t('deleteAccount.doneBody')}</p>
      </div>
    );
  }
  if (!user) return null; // syncFromUrl already gates; belt and braces

  const match = confirmText.trim() === user.displayName;

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      useSession.setState({ user: null, accessToken: null });
      setDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(t('deleteAccount.maintainerBlocked'));
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h2>{t('deleteAccount.title')}</h2>
      <p>{t('deleteAccount.signedInAs', { name: user.displayName })}</p>
      <ul>
        <li>{t('deleteAccount.consequence1')}</li>
        <li>{t('deleteAccount.consequence2')}</li>
        <li>{t('deleteAccount.consequence3')}</li>
        <li>
          <strong>{t('deleteAccount.consequence4')}</strong>
        </li>
      </ul>
      <label htmlFor="delete-confirm-name">
        {t('deleteAccount.typeName', { name: user.displayName })}
      </label>
      <input
        id="delete-confirm-name"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        autoComplete="off"
      />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button onClick={goHome} disabled={busy}>
          {t('deleteAccount.cancel')}
        </button>
        <button className="danger" disabled={!match || busy} onClick={() => void doDelete()}>
          {t('deleteAccount.confirm')}
        </button>
      </div>
    </div>
  );
}
```

Create `apps/web/src/screens/PrivacyScreen.tsx` — a static, deliberately bilingual page (legal content renders in both languages simultaneously, so it does not go through i18n keys). It must enumerate exactly what the server actually stores (mirrors the Task 9 data-safety table): account data (display name; email, password hash, avatar URL for registered/OAuth accounts), preferences (locale/theme), device push tokens (FCM/APNs, removable), match history (finished games: seats, scores, action logs; anonymized on deletion), in-game chat (free text + preset ids on finished-game records), UGC (custom maps, abuse reports), cookies (refresh session cookie only, no ads/analytics/tracking), retention (guests auto-delete after inactivity; deletion via `/account/delete` or in-app), and the support/moderation contact `PLACEHOLDER-SUPPORT-EMAIL` (a launch-gated placeholder — Task 11 blocks submission until it is replaced with the real monitored mailbox). Link to `/account/delete`. Keep it dependency-free JSX inside `<div className="card stack">`.

Wire `apps/web/src/App.tsx`: import both screens (eager — they are tiny) and render them:

```tsx
            {view === 'deleteAccount' && <DeleteAccountScreen />}
            {view === 'privacy' && <PrivacyScreen />}
```

- [ ] **Step 6: Run tests**

Run: `yarn workspace @trm/web test --run DeleteAccountScreen`
Expected: PASS (all four)
Run: `yarn workspace @trm/web test --run ui`
Expected: PASS (existing router tests unaffected)
Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/store/ui.ts apps/web/src/App.tsx apps/web/src/i18n/index.ts apps/web/src/screens/DeleteAccountScreen.tsx apps/web/src/screens/PrivacyScreen.tsx apps/web/src/screens/DeleteAccountScreen.test.tsx
git commit -m "feat(web): public account-deletion and privacy-policy pages"
```

---

### Task 7: Web — report a shared map from the builder peek

The `POST /reports/map` entry point belongs where share codes circulate: the builder's clone-by-code peek. The mobile app embeds this same web surface (builder WebView), so one implementation covers both platforms.

**Files:**
- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/features/builder/MapsScreen.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Create: `apps/web/src/features/builder/MapsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 3's `POST /api/v1/reports/map`, `REPORT_CATEGORIES` from `@trm/shared`, the existing peek state in `MapsScreen` (`peek`, `code`).
- Produces: `api.reportSharedMap(shareCode, category, message?)`; a "report this map" affordance inside the peek result block.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/builder/MapsScreen.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../../i18n';
import MapsScreen from './MapsScreen';
import { api } from '../../net/rest';

vi.mock('../../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../net/rest')>();
  return {
    ...mod,
    setOnTokenChange: vi.fn(),
    setAccessToken: vi.fn(),
    api: {
      listMaps: vi.fn(),
      peekSharedMap: vi.fn(),
      reportSharedMap: vi.fn(),
      cloneSharedMap: vi.fn(),
    },
  };
});

const mocked = api as unknown as {
  listMaps: ReturnType<typeof vi.fn>;
  peekSharedMap: ReturnType<typeof vi.fn>;
  reportSharedMap: ReturnType<typeof vi.fn>;
};

describe('MapsScreen: report a shared map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/maps');
    mocked.listMaps.mockResolvedValue([]);
    mocked.peekSharedMap.mockResolvedValue({
      nameZh: '可疑地圖',
      nameEn: 'Sus Map',
      draft: { cities: [], routes: [], tickets: [] },
    });
  });

  it('peek reveals a report affordance that submits code + category', async () => {
    mocked.reportSharedMap.mockResolvedValue({ id: 'r1' });
    render(<MapsScreen />);
    fireEvent.change(screen.getByPlaceholderText(/分享代碼/), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: /預覽/ }));
    expect(await screen.findByText(/可疑地圖/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /檢舉此地圖/ }));
    fireEvent.change(screen.getByLabelText(/檢舉原因/), {
      target: { value: 'INAPPROPRIATE_CONTENT' },
    });
    fireEvent.click(screen.getByRole('button', { name: /送出檢舉/ }));
    await waitFor(() =>
      expect(mocked.reportSharedMap).toHaveBeenCalledWith(
        'ABCD1234',
        'INAPPROPRIATE_CONTENT',
        undefined,
      ),
    );
    expect(await screen.findByText(/已收到你的檢舉/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run MapsScreen`
Expected: FAIL — no `檢舉此地圖` button (and `reportSharedMap` missing from the api type).

- [ ] **Step 3: Implement**

`apps/web/src/net/rest.ts` — add next to `peekSharedMap` (import `type ReportCategory` from `@trm/shared` at the top, next to the existing `@trm/shared` type import):

```ts
  reportSharedMap: (shareCode: string, category: ReportCategory, message?: string) =>
    req<{ id: string }>('POST', '/reports/map', { shareCode, category, message }),
```

`apps/web/src/i18n/index.ts` — add inside the existing `builder` section of BOTH tables:

zh-Hant: `reportMap: '檢舉此地圖'`, `reportReason: '檢舉原因'`, `reportMessage: '補充說明（選填）'`, `reportSubmit: '送出檢舉'`, `reportDone: '已收到你的檢舉，我們會盡快處理。'`, `reportFailed: '檢舉送出失敗，請稍後再試。'`
en: `reportMap: 'Report this map'`, `reportReason: 'Reason'`, `reportMessage: 'Details (optional)'`, `reportSubmit: 'Submit report'`, `reportDone: 'Report received — we will review it soon.'`, `reportFailed: 'Could not submit the report. Try again later.'`

And a top-level `report` section in BOTH tables with the same 7 category keys used by admin (`category_HARASSMENT: '騷擾'` … / `category_HARASSMENT: 'Harassment'` … — copy the exact strings from Task 5 Step 4).

`apps/web/src/features/builder/MapsScreen.tsx` — extend the peek block (`{peek && (…)}`, currently ending with the clone button around line 151–166). Add state at the top of the component:

```ts
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory>('INAPPROPRIATE_CONTENT');
  const [reportMsg, setReportMsg] = useState('');
  const [reportState, setReportState] = useState<'idle' | 'sent' | 'failed'>('idle');
```

with imports `import { REPORT_CATEGORIES, type ReportCategory } from '@trm/shared';` and `Flag` from `lucide-react`. Inside the peek block, after the clone button:

```tsx
            {reportState === 'sent' ? (
              <p className="muted">{t('builder.reportDone')}</p>
            ) : reportOpen ? (
              <div className="stack">
                <label htmlFor="report-category">{t('builder.reportReason')}</label>
                <select
                  id="report-category"
                  value={reportCategory}
                  onChange={(e) => setReportCategory(e.target.value as ReportCategory)}
                >
                  {REPORT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`report.category_${c}`)}
                    </option>
                  ))}
                </select>
                <input
                  placeholder={t('builder.reportMessage')}
                  value={reportMsg}
                  maxLength={1000}
                  onChange={(e) => setReportMsg(e.target.value)}
                />
                {reportState === 'failed' && <p className="error">{t('builder.reportFailed')}</p>}
                <button
                  onClick={() =>
                    void api
                      .reportSharedMap(code.trim(), reportCategory, reportMsg.trim() || undefined)
                      .then(() => setReportState('sent'))
                      .catch(() => setReportState('failed'))
                  }
                >
                  {t('builder.reportSubmit')}
                </button>
              </div>
            ) : (
              <button className="ghost" onClick={() => setReportOpen(true)}>
                <Flag size={14} aria-hidden /> {t('builder.reportMap')}
              </button>
            )}
```

(If the `ghost` class does not exist in `styles/builder.css`, reuse whatever secondary-button class the file already defines — check before inventing one.)

- [ ] **Step 4: Run tests**

Run: `yarn workspace @trm/web test --run MapsScreen`
Expected: PASS
Run: `yarn workspace @trm/web build`
Expected: builds; the builder stays its own lazy chunk (`@trm/shared` is already in the eager graph via `net/rest.ts`, so importing `REPORT_CATEGORIES` adds nothing to the main bundle — verify chunk sizes look unchanged in the build output).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/features/builder/MapsScreen.tsx apps/web/src/i18n/index.ts apps/web/src/features/builder/MapsScreen.test.tsx
git commit -m "feat(web): report shared custom maps from the builder peek"
```

---

### Task 8: Mobile app — block/report UI, blocked filtering, in-app deletion check

> **Contract task.** `apps/mobile` was built in P1–P5 and its exact file layout is not knowable from this plan's vantage point. Everything below is an exact behavioral contract with reground verification commands; the REST/store code is real (it depends only on the ported client's `req` idiom, which mirrors `apps/web/src/net/rest.ts`).

**Files (verify names at reground — these are the P1-plan contracts):**
- Modify: `apps/mobile/src/net/rest.ts` (the ported REST client)
- Create: `apps/mobile/src/store/moderation.ts`
- Create: `apps/mobile/src/store/moderation.test.ts`
- Modify: the chat panel component + chat/roster selectors (P2 game stage; lobby room screen from P1)
- Modify: the player-tracker component (P2)
- Create: a report action-sheet component + test
- Verify/modify: the Settings screen's account-deletion flow (P0-c server + P1 screens)

**Interfaces:**
- Consumes: Tasks 2–3 endpoints; the ported `req`/`api` client; the ported chat store (entries carry `playerId` — verify: `rg -n "playerId" apps/mobile/src/store/chat.ts`); the roster/display-name helper (web pattern: names come from the lobby REST view, bots detected by the `bot:` id prefix).
- Produces: `api.myBlocks/blockUser/unblockUser/reportPlayer`, `useModeration` store, filtered chat + masked names, report sheet, verified in-app deletion.

- [ ] **Step 1: Reground**

Run and record:

```bash
rg -n '"name"' apps/mobile/package.json          # workspace name (assumed @trm/mobile below)
rg -n "export const api" apps/mobile/src/net/rest.ts
rg -n "playerId" apps/mobile/src/store/chat.ts
rg -n "deleteAccount|auth/me" apps/mobile/src    # does in-app deletion already exist?
rg -n "sendRoomChat|presetId" apps/mobile/src    # lobby chat surface
```

Adjust the file paths below to what these return.

- [ ] **Step 2: REST client additions (failing jest test first)**

Add to the ported client, mirroring its existing function style exactly:

```ts
export interface BlockList {
  blockedUserIds: string[];
}
// …in the api object:
  myBlocks: () => req<BlockList>('GET', '/me/blocks'),
  blockUser: (userId: string) => req<void>('PUT', `/me/blocks/${encodeURIComponent(userId)}`, {}),
  unblockUser: (userId: string) => req<void>('DELETE', `/me/blocks/${encodeURIComponent(userId)}`),
  reportPlayer: (body: {
    userId: string;
    category: ReportCategory;
    message?: string;
    gameId?: string;
    roomCode?: string;
  }) => req<{ id: string }>('POST', '/reports/player', body),
```

(`ReportCategory` from `@trm/shared` — already a mobile dependency via the shared packages.)

- [ ] **Step 3: Moderation store (TDD — jest-expo)**

Create `apps/mobile/src/store/moderation.test.ts` asserting: `hydrate()` populates `blocked` from `api.myBlocks`; `block(id)` is optimistic and rolls back on API failure; `unblock(id)` mirrors it; `reset()` clears. Then create `apps/mobile/src/store/moderation.ts`:

```ts
import { create } from 'zustand';
import { api } from '../net/rest';

/**
 * The account's client-side mute list, mirrored locally. Blocking filters chat display
 * and masks the blocked player's UGC display name — it never touches game state.
 */
interface ModerationState {
  blocked: Set<string>;
  hydrated: boolean;
  hydrate(): Promise<void>;
  block(userId: string): Promise<void>;
  unblock(userId: string): Promise<void>;
  reset(): void;
}

export const useModeration = create<ModerationState>()((set, get) => ({
  blocked: new Set<string>(),
  hydrated: false,
  async hydrate() {
    try {
      const { blockedUserIds } = await api.myBlocks();
      set({ blocked: new Set(blockedUserIds), hydrated: true });
    } catch {
      /* non-fatal: filtering stays off until the next hydrate */
    }
  },
  async block(userId) {
    const next = new Set(get().blocked);
    next.add(userId);
    set({ blocked: next }); // optimistic
    try {
      await api.blockUser(userId);
    } catch {
      const rollback = new Set(get().blocked);
      rollback.delete(userId);
      set({ blocked: rollback });
    }
  },
  async unblock(userId) {
    const next = new Set(get().blocked);
    next.delete(userId);
    set({ blocked: next });
    try {
      await api.unblockUser(userId);
    } catch {
      const rollback = new Set(get().blocked);
      rollback.add(userId);
      set({ blocked: rollback });
    }
  },
  reset() {
    set({ blocked: new Set<string>(), hydrated: false });
  },
}));
```

Hydrate on session restore/sign-in; `reset()` on sign-out (wherever the P1 session store handles those transitions).

- [ ] **Step 4: UI contracts (each with a jest-expo test before implementation)**

1. **Chat filtering (in-game + lobby):** the rendered message list excludes entries whose `playerId`/`userId` is in `useModeration.blocked` — free text AND presets. Test: store with 3 entries, 1 blocked author → 2 rendered.
2. **Name masking:** wherever a display name resolves from the roster, a blocked user renders as the neutral seat label (`P{seat+1}` pattern — display names are themselves UGC). Test on the tracker component.
3. **Report/block entry points:** long-press (or the existing info affordance) on a player tracker row and on a chat message opens an action sheet with Report / Block (or Unblock). Hidden for yourself and for bots (`id.startsWith('bot:')`). Test: sheet absent for a bot id.
4. **Report sheet:** the 7 `REPORT_CATEGORIES` as radio options (labels via i18n `report.category_<ID>` — port the zh-Hant/en strings from Task 5 Step 4 into the mobile i18n tables), optional message (max 1000), submits `api.reportPlayer` with `gameId`/`roomCode` context auto-attached from the active game/room, success + failure states. Test: submit calls the api with the exact payload.
5. **In-app account deletion (Apple 5.1.1(v) — release blocker):** verify the Settings screen already offers deletion (Step 1 grep). If absent: a confirmation screen mirroring the web copy (Task 6 i18n keys), calling `DELETE /auth/me` via the ported client — for an Apple-linked account, first run a fresh SIWA re-auth (`expo-apple-authentication`) and pass `appleAuthorizationCode` in the body — then clear secure-store + all zustand stores and land on the sign-in screen.

- [ ] **Step 5: Validate + commit**

Run: `yarn workspace @trm/mobile test` (jest-expo; adjust the workspace name to Step 1's answer) and `yarn workspace @trm/mobile typecheck`.
Expected: PASS.

```bash
git add apps/mobile/src/net/rest.ts apps/mobile/src/store/moderation.ts apps/mobile/src/store/moderation.test.ts <the component/i18n files actually touched>
git commit -m "feat(mobile): report/block players, blocked-chat filtering, in-app deletion"
```

---

### Task 9: Store listings — metadata, screenshots, ratings, data safety, DSA

**Files (fastlane's conventional layout — verify the P1/P5 lanes' `Deliverfile`/`Supplyfile` paths at reground with `ls apps/mobile/fastlane`):**
- Create: `apps/mobile/fastlane/metadata/android/zh-TW/{title.txt,short_description.txt,full_description.txt}`
- Create: `apps/mobile/fastlane/metadata/android/en-US/{title.txt,short_description.txt,full_description.txt}`
- Create: `apps/mobile/fastlane/metadata/ios/zh-Hant/{name.txt,subtitle.txt,description.txt,keywords.txt,privacy_url.txt,support_url.txt}`
- Create: `apps/mobile/fastlane/metadata/ios/en-US/{…same six…}`

Store copy is **original wording** (Global Constraints). Character limits: Play title ≤30, short description ≤80, full description ≤4000; App Store name ≤30, subtitle ≤30, keywords ≤100 chars total.

- [ ] **Step 1: Commit the metadata files**

`title.txt` / `name.txt` (both locales): `台鐵任務 TRMission` (zh-TW/zh-Hant) · `TRMission 台鐵任務` (en-US).
`subtitle.txt`: zh-Hant `台灣鐵道策略桌遊` · en `Taiwan railway board game`.
`short_description.txt`: zh-TW `在台灣鐵道上搶佔路線、完成任務卡的多人策略桌遊。` · en-US `A multiplayer railway strategy board game set on Taiwan's railways.`
`keywords.txt`: zh-Hant `桌遊,鐵道,火車,策略,多人,任務,台灣` · en-US `board game,trains,railway,strategy,multiplayer,tickets,taiwan`
`privacy_url.txt` (both): `https://<production origin>/privacy` · `support_url.txt`: `https://<production origin>/` (replace `<production origin>` with the real deployed origin — same value as `OAUTH_REDIRECT_BASE`; Task 11 gates on no placeholders remaining).

`full_description.txt` zh-TW:

```
「台鐵任務」是一款以台灣鐵路為舞台的多人策略桌遊。收集車廂卡、搶佔路線，把城市串連成你的鐵道網，並完成秘密任務卡取得最高分。

特色：
• 線上多人對戰（2–5 人），可加入電腦玩家補位
• 離線單人模式：隨時與電腦玩家對戰，不需網路
• 五分鐘互動教學，第一次玩也能快速上手
• 自訂地圖工房：打造並分享你自己的地圖
• 回合推播提醒，輪到你時不錯過
• 繁體中文與英文介面
• 手機與平板皆有最佳化版面

可以訪客身分立即開玩；註冊帳號即可跨裝置保留戰績與設定。
```

`full_description.txt` en-US:

```
TRMission is a multiplayer railway strategy board game set on Taiwan's railways. Collect train cards, claim routes, connect cities into your own rail network, and complete secret mission tickets for the highest score.

Features:
• Online multiplayer for 2–5 players, with bot seats to fill a table
• Offline solo play against bots — no connection needed
• A five-minute interactive tutorial
• Custom map workshop: build and share your own maps
• Turn push reminders so you never miss a move
• Traditional Chinese and English interface
• Layouts optimized for both phones and tablets

Play instantly as a guest, or register to keep your match history and settings across devices.
```

```bash
git add apps/mobile/fastlane/metadata
git commit -m "docs(mobile): store listing metadata, zh-Hant + en"
```

- [ ] **Step 2: Screenshot matrix (real layouts, no device frames faked)**

Capture from real devices/simulators in BOTH locales, from real games (bots make staging easy). The tablet shots must show the genuine ≥700dp two-pane / ≥1000dp three-pane layouts — Play rejects stretched phone shots for the tablet slots.

- [ ] iPhone 6.9"/6.7" class (portrait, 3–5 shots): board mid-game, hand/dock, tickets, lobby, tutorial
- [ ] iPad 13" class (landscape, 3–5 shots): three-pane game stage, room screen
- [ ] Android phone (same five scenes)
- [ ] Android 7" tablet (two-pane) + 10" tablet (three-pane) — dedicated Play uploads
- [ ] No copyrighted/lookalike art anywhere in frame (clean-room posture); no debug UI; zh-Hant set is the primary listing set

- [ ] **Step 3: Age rating questionnaires**

- [ ] Apple: complete the age rating questionnaire — no violence/gambling/etc.; answer **yes** to unrestricted user-generated content? **No** — TRMission's UGC (chat, display names, shared maps) has the required guards (report, block, moderation) → declare "Infrequent/Mild User Generated Content" per the current questionnaire's wording and enable the Communication Safety disclosure if asked
- [ ] Play: complete the IARC questionnaire — declare **Users Interact** (chat + shared content) and **Shares User-Generated Content**; expected rating: Everyone / PEGI 3 with an interaction disclosure
- [ ] Record both outcomes in the release notes for the submission PR

- [ ] **Step 4: Privacy nutrition label (Apple) + Data safety form (Play)**

Declare exactly this — no more, no less (matches what the server stores; see `apps/server/src/auth/user.repo.ts`, `src/push/device.repo.ts`, `src/persistence/`):

| Data | Collected? | Linked to identity | Purpose | Shared with third parties |
|---|---|---|---|---|
| Email address | Yes (registered accounts only) | Yes | Account management | No |
| Display name | Yes | Yes | App functionality | No |
| Avatar URL | Yes (OAuth accounts only) | Yes | App functionality | No |
| User ID | Yes | Yes | App functionality | No |
| Device push token | Yes (opt-in) | Yes | App functionality (turn reminders) | No |
| Game history (matches, scores, action logs) | Yes | Yes | App functionality | No |
| In-game chat / UGC (custom maps, reports) | Yes | Yes | App functionality + moderation | No |
| Location, contacts, ad identifiers, analytics, tracking | **Not collected** | — | — | — |

- [ ] Apple: data **not** used for tracking; no third-party advertising/analytics SDKs
- [ ] Play: data encrypted in transit; deletion path = in-app + `https://<origin>/account/delete` (Task 6 — this URL goes in the form's "account deletion" field)
- [ ] Both forms name the same data set; a mismatch between the two stores is a review flag

- [ ] **Step 5: EU DSA + contacts**

- [ ] Apple App Store Connect: submit the **non-trader** declaration (no monetization — spec scope) so the EU listing stays live
- [ ] Play Console: same non-trader status where prompted
- [ ] Set the moderation/support contact (public email) in both listings AND replace `PLACEHOLDER-SUPPORT-EMAIL` in `apps/web/src/screens/PrivacyScreen.tsx` with the real monitored mailbox — one commit:

```bash
git add apps/web/src/screens/PrivacyScreen.tsx
git commit -m "chore(web): real support/moderation contact on the privacy page"
```

---

### Task 10: Release engineering — signing, versioning, test tracks, rollout

**Files:**
- Create: `docs/release/mobile-versioning.md`

- [ ] **Step 1: Commit the versioning scheme (this doc is the contract `MOBILE_MIN_BUILD` points into)**

Create `docs/release/mobile-versioning.md`:

```markdown
# Mobile build-number scheme

One monotonically increasing integer, **BUILD_NUMBER**, shared by both platforms per release:

- Android `versionCode` = BUILD_NUMBER
- iOS `CFBundleVersion` (buildNumber) = BUILD_NUMBER
- Marketing version (`versionName` / `CFBundleShortVersionString`) is independent semver (1.0.0, 1.0.1, …).

CI is the only place BUILD_NUMBER is assigned: the release workflows derive it from the
release tag (`mobile-v<semver>+<build>`; the `+<build>` suffix is the integer) and inject it
via `app.config.ts` env at `expo prebuild` time. Local dev builds use BUILD_NUMBER=1 and are
never shipped.

The server's `MOBILE_MIN_BUILD` (served by `GET /version/mobile`, checked at app boot)
lives in the SAME number space. Rules:

1. `MOBILE_MIN_BUILD` may only ever increase.
2. Raise it to build N only when every build < N can no longer talk to the deployed
   server (wire/protocol/auth break) — it is a compatibility floor, not a nudge.
3. Raise it AFTER build N has ≥ 7 days of store availability, except for security fixes.
4. OTA (expo-updates, runtimeVersion fingerprint) never substitutes for the gate: an OTA
   update cannot cross a native runtimeVersion, and the gate must assume store binaries.

Rehearsal procedure (staging): set MOBILE_MIN_BUILD to current+1 → app boot shows the
forced-update screen with a working store link → reset. This rehearsal is a launch-gate
item (see the P6 plan, Task 11).
```

```bash
git add docs/release/mobile-versioning.md
git commit -m "docs(release): mobile build-number + MOBILE_MIN_BUILD scheme"
```

- [ ] **Step 2: Production signing verification (Android)**

- [ ] The upload keystore lives only in GitHub secrets (P1 lane); verify locally-held backup exists in the team password manager
- [ ] Verify the built AAB is signed by the upload key: `keytool -printcert -jarfile app-release.aab` — the SHA-256 must match the upload certificate
- [ ] Enroll in **Play App Signing**; record BOTH fingerprints (upload key + Play's app-signing key) from Play Console → Setup → App signing
- [ ] `ANDROID_CERT_SHA256` (server env, feeds `assetlinks.json`) must list the **Play app-signing key's** SHA-256 (what production installs are actually signed with) — plus the upload/debug fingerprints only if internal-track installs need App Links too
- [ ] iOS: `fastlane match` certificates valid > 60 days out; App Store Connect API key in secrets scoped to App Manager

- [ ] **Step 3: Test tracks (calendar-critical — verify current state FIRST)**

- [ ] **Verify at reground:** Play account type (personal ⇒ the 12-tester × 14-day closed test is mandatory before production access; organization w/ D-U-N-S ⇒ exempt) and whether the closed test already started during P4–P5 as the spec timeline planned
- [ ] TestFlight internal (team) → fix crashes → **external beta** (needs Beta App Review — submit the same compliance metadata; budget ≥ 1 week)
- [ ] Play internal track → **closed track**: recruit ≥ 14 testers (buffer over the 12 minimum), all must opt in AND stay enrolled 14 consecutive days
- [ ] Apply for **production access** in Play Console the moment the closed test qualifies; answer the production-readiness questionnaire honestly (testing summary, target audience)
- [ ] Keep a dated log of these milestones in the release PR (the dates prove the 14-day window)

- [ ] **Step 4: Staged rollout plan**

- [ ] Play: staged rollout 10% → 25% → 50% → 100%, advancing only after ≥ 48h each with crash-free sessions ≥ 99.5% (Play Vitals) and no new-ANR regressions; halt + hotfix path is a new BUILD_NUMBER through the same lanes
- [ ] iOS: Phased Release ON (7-day automatic curve), same halt criteria via Xcode Organizer/App Store Connect metrics
- [ ] `MOBILE_MIN_BUILD` stays untouched during rollout (Step 1 rules)

---

### Task 11: Launch checklist — the gate before "Submit for review"

Every box below must be checked in the release PR. Items marked **(cmd)** have an exact verification command.

**Server / infra**

- [ ] **(cmd)** `.well-known` files live with real ids:
  `curl -s https://<origin>/.well-known/apple-app-site-association | jq .applinks.details[0].appIDs` → the real `TEAMID.bundle.id`;
  `curl -s https://<origin>/.well-known/assetlinks.json | jq '.[0].target.sha256_cert_fingerprints'` → includes the **Play app-signing** fingerprint (Task 10 Step 2)
- [ ] **(cmd)** Android statement list check: `curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<origin>&relation=delegate_permission/common.handle_all_urls" | jq .`
- [ ] Prod env set and non-empty: `MOBILE_MIN_BUILD` (0 at launch), `GOOGLE_MOBILE_CLIENT_IDS`, `APPLE_CLIENT_IDS`, `APPLE_APP_ID`, `ANDROID_PACKAGE_NAME`, `ANDROID_CERT_SHA256`, plus the push credentials — **(cmd)** enumerate the exact push env names with `rg -n "process.env" apps/server/src/config/env.ts | rg -i "apns|fcm|firebase|push"` and check each in the prod secret store
- [ ] `OAUTH_REDIRECT_BASE` is the SPA's production origin (Strict-cookie + `/m/callback` handoff both depend on it) and the SPA serves `/m/callback`, `/account/delete`, `/privacy` (deep-link + store URLs) — **(cmd)** `curl -sI https://<origin>/account/delete | head -1` → 200 (SPA fallback)
- [ ] `GET /version/mobile` returns `{minBuild, commitHash}` in prod — **(cmd)** `curl -s https://<origin>/version/mobile`

**Device verification (real hardware, production backend)**

- [ ] Android App Links: install a closed-track build, then **(cmd)** `adb shell pm get-app-links <package>` → domain `verified`; complete a Google + Discord OAuth round trip via the system browser ending back in the app
- [ ] iOS Universal Links: TestFlight build; complete the same OAuth round trip; if it falls back to the `trmission://` scheme, diagnose with Settings → Developer → Universal Links before shipping
- [ ] Sign in with Apple end-to-end (Apple 4.8), including Hide-My-Email
- [ ] Push: your-turn notification arrives with the app backgrounded (both platforms); deleting the account removes the device registration
- [ ] Forced-update rehearsal on staging per `docs/release/mobile-versioning.md` — gate screen renders, store link opens the correct listing
- [ ] In-app account deletion (Task 8 Step 4.5) verified on both platforms; web `/account/delete` verified signed-out (login gate) and signed-in
- [ ] Report + block round trip on device: report a player → row appears in the admin Reports view; block → their chat disappears locally
- [ ] Offline posture (Apple 4.2 review resilience): airplane mode → Home still offers Play-vs-Bots + Tutorial

**Compliance artifacts**

- [ ] Preset chat is live in production (landed pre-P6; **(cmd)** `rg CHAT_PRESET_IDS packages/shared/src` and a lobby smoke test) — free-text chat plus report/block is the moderation story told in both stores' review notes
- [ ] Review notes written for both stores: demo account credentials, how to reach chat/UGC, where report/block/moderation live, the offline mode, and the account-deletion path
- [ ] Moderation mailbox monitored; dashboard `reports` queue has an owner and an SLA note in the team docs
- [ ] Store forms (Task 9) submitted: ratings, data safety/privacy, DSA non-trader, deletion URL

**Business sign-off (blocking)**

- [ ] **IP-risk acknowledgment** — commit `docs/release/ip-risk-acknowledgment.md` and obtain a named sign-off BEFORE first submission:

```markdown
# IP-risk acknowledgment — mobile store release

TRMission is a clean-room reimplementation of the *mechanics* of a well-known train
board game, re-themed onto Taiwan's railways. Mechanics are not copyrightable; all map
content, artwork, names, colour palette, and rules wording are original. Commercial
storefronts nonetheless provide low-friction takedown channels (App Store dispute,
Play DMCA), and a takedown or forced rename after launch is a real business risk that
cannot be engineered away (spec: Risks & mitigations).

By signing below, the business owner acknowledges this risk and approves submission to
the Apple App Store and Google Play under the TRMission name and current art.

- Owner: ______________________  Date: __________
- Reviewed defenses: original content audit ✔ · no reserved terms in store copy/keywords ✔
  (verified: `rg -ri "ticket to ride|days of wonder" apps/mobile/fastlane docs/release` → no hits)
```

```bash
git add docs/release/ip-risk-acknowledgment.md
git commit -m "docs(release): IP-risk acknowledgment gate for store submission"
```

- [ ] Final go/no-go review of this whole checklist → **Submit for review** on both stores → begin Task 10 Step 4 staged rollout

---

## Out of scope (deliberately)

- Web-side blocked-player chat filtering parity (the block list is account-level and the web can adopt it later; compliance targets the store binaries).
- Report rate-limiting beyond the existing global throttler (240 req/min); revisit only if the queue sees abuse.
- A dashboard report **detail drawer** / bulk actions / auto-linking reports to the game-chat viewer (the `gameId` context + existing GamesView drawer already cover investigation).
- Push notifications to reporters on resolution.
- Turn timers / AFK handling, replay viewer on mobile, native builder — tracked in `docs/TODO.md`, not this phase.
