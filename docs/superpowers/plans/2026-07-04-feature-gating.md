# Per-Account Feature Gating (Replay Review & Map Building) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make replay reviewing and custom-map building opt-in per-account features (default OFF for everyone), grantable from the admin dashboard via a new Features view + user-drawer toggles, with a reusable AccountSelectorModal also adopted by MaintainersView.

**Architecture:** A `UserFeature` taxonomy in `@trm/shared` (mirroring the dashboard-permission pattern); a `features?: UserFeature[]` field on the Mongo `users` doc enforced by per-request reads (a `FeatureGuard` + `@RequireFeature` for whole routes, direct `UserRepo.hasFeature` reads for conditional logic in lobby/history); `PublicUser.features` flows to the web client for cosmetic UI gating; new dashboard endpoints behind a new `users.features` permission (admin + owner).

**Tech Stack:** NestJS (swc runtime — never tsx), zod + nestjs-zod, native Mongo driver, React + zustand + react-i18next (zh-Hant primary + en), vitest (+ supertest, mongodb-memory-server, @testing-library/react).

**Spec:** `docs/superpowers/specs/2026-07-04-feature-gating-design.md`. One deliberate refinement from the spec: the featured-accounts list endpoint is `GET /api/v1/dashboard/users/features` (declared on the existing users controller, before `:id`) instead of `GET /api/v1/dashboard/features` — same payload, no new controller needed.

## Global Constraints

- Yarn 4 workspaces + Turborepo; run tests via `yarn workspace <pkg> test --run <substring>`.
- Server dev/tests run through **swc** (`@swc-node/register` / `unplugin-swc`) — do not introduce tsx/esbuild.
- The engine, proto, codec, and WS plane are **untouched** by this feature.
- Absent `features` field = no features (default-disabled for all existing accounts); no migration.
- Stable error body for a missing feature: HTTP 403 with `{ message: 'feature not enabled: <feature>', code: 'FEATURE_DISABLED', feature }`.
- `GET /api/v1/maps/content/:hash` must remain reachable by ANY authenticated user (players/replay viewers of custom-map games resolve content by hash).
- Every user-facing string is added in **both** zh-Hant and en.
- **Never `git add -A` / `git add .`** — multiple agents share this worktree; stage only files you changed. Commit after each task once its tests pass.
- Strict TS everywhere: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — conditional-spread optional fields (`...(x ? { x } : {})`), never assign `undefined`.

---

### Task 1: Shared taxonomy — `UserFeature` + `users.features` permission

**Files:**

- Create: `packages/shared/src/features.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/dashboard.ts`
- Test: `packages/shared/test/features.spec.ts`

**Interfaces:**

- Produces: `USER_FEATURES: readonly ['replayReview', 'mapBuilder']`, `type UserFeature`, `isUserFeature(s: string): s is UserFeature`, and the new `'users.features'` member of `DashboardPermission` (in `ADMIN_PERMISSIONS`, hence admin + owner). All exported from `@trm/shared`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/features.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { USER_FEATURES, isUserFeature } from '../src/features';
import { ROLE_PERMISSIONS } from '../src/dashboard';

describe('user feature taxonomy', () => {
  it('defines exactly the two gated features', () => {
    expect(USER_FEATURES).toEqual(['replayReview', 'mapBuilder']);
  });

  it('type guard accepts members and rejects strangers', () => {
    expect(isUserFeature('replayReview')).toBe(true);
    expect(isUserFeature('mapBuilder')).toBe(true);
    expect(isUserFeature('timeTravel')).toBe(false);
  });

  it('users.features is granted to admin and owner, not viewer/moderator', () => {
    expect(ROLE_PERMISSIONS.viewer).not.toContain('users.features');
    expect(ROLE_PERMISSIONS.moderator).not.toContain('users.features');
    expect(ROLE_PERMISSIONS.admin).toContain('users.features');
    expect(ROLE_PERMISSIONS.owner).toContain('users.features');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/shared test --run features`
Expected: FAIL — cannot resolve `../src/features`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/features.ts`:

```ts
/**
 * Per-account gated features. Default-OFF for every account; granted from the
 * maintainer dashboard (permission `users.features`). Defined once here so the
 * server guard, the admin UI, and the web client can never drift — the same
 * no-drift pattern as the dashboard permission taxonomy.
 */
export const USER_FEATURES = ['replayReview', 'mapBuilder'] as const;
export type UserFeature = (typeof USER_FEATURES)[number];

export const isUserFeature = (s: string): s is UserFeature =>
  (USER_FEATURES as readonly string[]).includes(s);
```

In `packages/shared/src/index.ts` append:

```ts
export * from './features';
```

In `packages/shared/src/dashboard.ts`, add `'users.features'` to `DASHBOARD_PERMISSIONS` (after `'users.ban'`):

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

and add it to `ADMIN_PERMISSIONS`:

```ts
const ADMIN_PERMISSIONS: readonly DashboardPermission[] = [
  ...MODERATOR_PERMISSIONS,
  'users.features',
  'maintainers.read',
  'audit.read',
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @trm/shared test` (the pre-existing `dashboard.spec.ts` is structural and must also stay green)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/features.ts packages/shared/src/index.ts packages/shared/src/dashboard.ts packages/shared/test/features.spec.ts
git commit -m "feat(shared): user feature taxonomy + users.features dashboard permission"
```

---

### Task 2: Server — `UserDoc.features`, repo helpers, `FeatureGuard`, `PublicUser.features`

**Files:**

- Modify: `apps/server/src/auth/user.repo.ts`
- Modify: `apps/server/src/auth/auth.types.ts`
- Create: `apps/server/src/auth/require-feature.decorator.ts`
- Create: `apps/server/src/auth/feature.guard.ts`
- Modify: `apps/server/src/auth/auth.module.ts`
- Test: `apps/server/test/feature-gating.e2e.spec.ts` (new; grows in Tasks 3–5)

**Interfaces:**

- Consumes: `UserFeature` from `@trm/shared` (Task 1).
- Produces:
  - `UserDoc.features?: UserFeature[]`
  - `UserRepo.hasFeature(userId: string, feature: UserFeature): Promise<boolean>`
  - `UserRepo.setFeatures(userId: string, features: UserFeature[]): Promise<UserDoc | null>` (null for guests/missing)
  - `UserRepo.listFeatured(): Promise<UserDoc[]>`
  - `PublicUser.features: UserFeature[]` (always present; `[]` when none)
  - `RequireFeature(feature: UserFeature)` decorator (metadata key `REQUIRE_FEATURE_KEY = 'auth:feature'`)
  - `FeatureGuard` (provided + exported by `AuthModule`)
  - `featureDisabled(feature: UserFeature): ForbiddenException` helper (exported from `feature.guard.ts`)

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/feature-gating.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { UserFeature } from '@trm/shared';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

/** Grant features directly in Mongo — the dashboard API arrives in Task 6. */
export async function grant(db: TestApp['db'], userId: string, features: UserFeature[]) {
  await db.collection('users').updateOne({ _id: userId } as never, { $set: { features } });
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('PublicUser.features', () => {
  it('defaults to [] and reflects grants instantly (no re-login)', async () => {
    const a = await registered('feat-me@example.com', 'FeatMe');
    const before = await request(server()).get('/api/v1/auth/me').set(auth(a.token)).expect(200);
    expect(before.body.features).toEqual([]);

    await grant(t.db, a.id, ['mapBuilder']);
    const after = await request(server()).get('/api/v1/auth/me').set(auth(a.token)).expect(200);
    expect(after.body.features).toEqual(['mapBuilder']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/server test --run feature-gating`
Expected: FAIL — `before.body.features` is `undefined`.

- [ ] **Step 3: Implement the repo + types**

In `apps/server/src/auth/auth.types.ts`, add the import at the top and the field to `PublicUser`:

```ts
import type { UserFeature } from '@trm/shared';
```

```ts
export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  preferences: UserPreferences;
  /** Per-account gated features (dashboard-granted). Empty for everyone by default. */
  features: UserFeature[];
  email?: string;
  avatarUrl?: string;
}
```

In `apps/server/src/auth/user.repo.ts`:

1. Add to imports: `import type { UserFeature } from '@trm/shared';`
2. Add to `UserDoc` (after `disabledReason?`):

```ts
  /** Dashboard-granted gated features (absent/empty = none — the default for everyone). */
  features?: UserFeature[];
```

3. In `toPublicUser`, add after `isGuest: u.isGuest,`:

```ts
  features: u.features ?? [],
```

4. Add three methods to `UserRepo` (after `clearDisabled`):

```ts
  /** Per-request feature check (projection-only point read). Used by FeatureGuard + inline gates. */
  async hasFeature(userId: string, feature: UserFeature): Promise<boolean> {
    const doc = await this.col.findOne({ _id: userId }, { projection: { features: 1 } });
    return !!doc?.features?.includes(feature);
  }

  /** Replace the feature set (dashboard). Guests can never hold features — the filter refuses them. */
  setFeatures(userId: string, features: UserFeature[]): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId, isGuest: false },
      features.length ? { $set: { features } } : { $unset: { features: '' } },
      { returnDocument: 'after' },
    );
  }

  /** Accounts holding at least one feature, newest first (dashboard Features view). */
  listFeatured(): Promise<UserDoc[]> {
    return this.col
      .find({ features: { $exists: true, $ne: [] } })
      .sort({ createdAt: -1 })
      .toArray();
  }
```

- [ ] **Step 4: Implement decorator + guard**

Create `apps/server/src/auth/require-feature.decorator.ts`:

```ts
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { UserFeature } from '@trm/shared';

export const REQUIRE_FEATURE_KEY = 'auth:feature';

/**
 * Declares the per-account feature a route (or whole controller) needs.
 * Enforced by FeatureGuard; routes without this metadata pass through.
 */
export const RequireFeature = (feature: UserFeature): CustomDecorator<string> =>
  SetMetadata(REQUIRE_FEATURE_KEY, feature);
```

Create `apps/server/src/auth/feature.guard.ts`:

```ts
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserFeature } from '@trm/shared';
import type { AuthUser } from './auth.types';
import { UserRepo } from './user.repo';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator';

/** Stable 403 body the web client maps to an i18n message. */
export const featureDisabled = (feature: UserFeature): ForbiddenException =>
  new ForbiddenException({
    message: `feature not enabled: ${feature}`,
    code: 'FEATURE_DISABLED',
    feature,
  });

/**
 * Per-account feature gate. Must run AFTER AccessTokenGuard (needs req.user).
 * Reads the user doc on every request (one indexed point read) so a dashboard
 * grant/revoke applies instantly — same posture as ban enforcement, never token claims.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UserRepo,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserFeature | undefined>(
      REQUIRE_FEATURE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) throw featureDisabled(required); // AccessTokenGuard should have run first
    if (!(await this.users.hasFeature(req.user.userId, required))) {
      throw featureDisabled(required);
    }
    return true;
  }
}
```

In `apps/server/src/auth/auth.module.ts`: add `FeatureGuard` to the `providers` array and to `exports` (which becomes `[TokenService, AccessTokenGuard, UserRepo, SessionRepo, FeatureGuard]`), importing it from `./feature.guard`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run feature-gating` then `yarn workspace @trm/server test --run auth.e2e`
Expected: both PASS (auth.e2e may assert `/auth/me` shape — if it does exact-match asserts, add `features: []`).

- [ ] **Step 6: Typecheck and commit**

Run: `yarn workspace @trm/server typecheck`

```bash
git add apps/server/src/auth/user.repo.ts apps/server/src/auth/auth.types.ts apps/server/src/auth/require-feature.decorator.ts apps/server/src/auth/feature.guard.ts apps/server/src/auth/auth.module.ts apps/server/test/feature-gating.e2e.spec.ts
git commit -m "feat(server): per-account features field, FeatureGuard, PublicUser.features"
```

---

### Task 3: Server — gate all map-authoring routes on `mapBuilder`

**Files:**

- Create: `apps/server/src/maps/maps-content.controller.ts`
- Modify: `apps/server/src/maps/maps.controller.ts`
- Modify: `apps/server/src/maps/maps.module.ts`
- Modify: `apps/server/test/maps.e2e.spec.ts`
- Test: `apps/server/test/feature-gating.e2e.spec.ts` (extend)

**Interfaces:**

- Consumes: `FeatureGuard`, `RequireFeature` (Task 2); the `grant()` helper exported by `feature-gating.e2e.spec.ts`.
- Produces: `MapsContentController` serving `GET /api/v1/maps/content/:hash` with only `AccessTokenGuard`; every other `/api/v1/maps` route 403s (`FEATURE_DISABLED`) without `mapBuilder`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/feature-gating.e2e.spec.ts`:

```ts
describe('maps routes require mapBuilder', () => {
  it('403 FEATURE_DISABLED without the feature; works with it; content/:hash stays open', async () => {
    const a = await registered('feat-maps@example.com', 'FeatMaps');

    const denied = await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(403);
    expect(denied.body.code).toBe('FEATURE_DISABLED');
    await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '圖', nameEn: 'Map' })
      .expect(403);
    await request(server()).get('/api/v1/maps/shared/ABCD1234').set(auth(a.token)).expect(403);

    await grant(t.db, a.id, ['mapBuilder']);
    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(200);
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '圖', nameEn: 'Map' })
      .expect(201);
    expect(created.body.id).toBeTruthy();

    // content/:hash is NOT feature-gated — any authenticated user (even a guest) may resolve it.
    const g = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Guest' })
      .expect(201);
    await request(server())
      .get('/api/v1/maps/content/no-such-hash')
      .set(auth(g.body.accessToken))
      .expect(404); // 404 (unknown hash), NOT 403 — proves the route is reachable
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run feature-gating`
Expected: FAIL — `GET /api/v1/maps` returns 200 where 403 expected.

- [ ] **Step 3: Split the content route out and gate the rest**

Create `apps/server/src/maps/maps-content.controller.ts`:

```ts
import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MapsService } from './maps.service';
import { MapContentResponseSchema } from './maps.schemas';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';

/**
 * Published-content resolution stays OUTSIDE the mapBuilder feature gate: players and
 * replay viewers of a custom-map game (guests included) resolve board content by hash —
 * the unguessable hash is the capability. Gating this would break live games and replays.
 */
@ApiTags('maps')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/maps')
export class MapsContentController {
  constructor(private readonly maps: MapsService) {}

  @Get('content/:hash')
  @ApiOperation({ summary: 'Fetch published, immutable map content by contentHash' })
  @ApiResponse({ status: 200, schema: apiSchema(MapContentResponseSchema) })
  async content(@Param('hash') hash: string) {
    const doc = await this.maps.getContentByHash(hash);
    if (!doc) throw new NotFoundException('unknown content hash');
    return doc.content;
  }
}
```

In `apps/server/src/maps/maps.controller.ts`:

1. Delete the `content()` method (the last method) and remove the now-unused imports: `NotFoundException` and `MapContentResponseSchema`.
2. Add imports:

```ts
import { FeatureGuard } from '../auth/feature.guard';
import { RequireFeature } from '../auth/require-feature.decorator';
```

3. Replace the class decorators so the whole controller is feature-gated (class-level metadata is what `FeatureGuard` reads via `getAllAndOverride`):

```ts
@ApiTags('maps')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, FeatureGuard)
@RequireFeature('mapBuilder')
@Controller('api/v1/maps')
export class MapsController {
```

In `apps/server/src/maps/maps.module.ts`, register the new controller:

```ts
  controllers: [MapsContentController, MapsController],
```

(import `MapsContentController` from `./maps-content.controller`).

- [ ] **Step 4: Update the existing maps spec to grant the feature**

In `apps/server/test/maps.e2e.spec.ts`, the `registered()` helper mints authors — grant them the feature there:

```ts
async function registered(
  email: string,
  displayName: string,
): Promise<{ token: string; id: string }> {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  await t.db
    .collection('users')
    .updateOne({ _id: res.body.user.id } as never, { $set: { features: ['mapBuilder'] } });
  return { token: res.body.accessToken, id: res.body.user.id };
}
```

Note: `maps.e2e.spec.ts` also asserts guests get 403 from `RegisteredUserGuard` — those asserts still hold (FeatureGuard fires first with 403 too; if an assertion pins the _message_, update it to the `FEATURE_DISABLED` message).

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run feature-gating` and `yarn workspace @trm/server test --run maps.e2e`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/maps/maps-content.controller.ts apps/server/src/maps/maps.controller.ts apps/server/src/maps/maps.module.ts apps/server/test/maps.e2e.spec.ts apps/server/test/feature-gating.e2e.spec.ts
git commit -m "feat(server): gate map authoring routes on the mapBuilder feature"
```

---

### Task 4: Server — lobby: custom-map select/host requires `mapBuilder` on the host

**Files:**

- Modify: `apps/server/src/lobby/lobby.service.ts`
- Modify: `apps/server/test/lobby-custom-map.e2e.spec.ts`
- Modify (if it exercises custom selectors): `apps/server/test/lobby-map-selector.e2e.spec.ts`, `apps/server/test/lobby-settings.e2e.spec.ts`
- Test: `apps/server/test/feature-gating.e2e.spec.ts` (extend)

**Interfaces:**

- Consumes: `featureDisabled` from `apps/server/src/auth/feature.guard.ts`; `UserRepo.hasFeature` (both Task 2). `LobbyService` already injects `UserRepo`.
- Produces: `updateSettings` (custom map PATCH) and `start` (custom selector resolution) both throw the `FEATURE_DISABLED` 403 when the host lacks `mapBuilder`. Official maps unaffected.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/feature-gating.e2e.spec.ts`:

```ts
describe('lobby: hosting a custom map requires mapBuilder', () => {
  it('blocks select and start for a non-granted host; official maps unaffected', async () => {
    const host = await registered('feat-host@example.com', 'FeatHost');
    await grant(t.db, host.id, ['mapBuilder']);

    // Author a playable map while granted (draft content copied from maps.e2e's tinyDraft shape).
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(host.token))
      .send({ nameZh: '圖', nameEn: 'Map' })
      .expect(201);
    const mapId: string = created.body.id;

    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(host.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    // Revoke, then try to SELECT the custom map → 403 FEATURE_DISABLED.
    await grant(t.db, host.id, []);
    const sel = await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ map: { source: 'custom', customMapId: mapId } })
      .expect(403);
    expect(sel.body.code).toBe('FEATURE_DISABLED');

    // Re-grant, select, revoke again: START must still be blocked (authoritative check).
    // Fill the room to 2 ready players first so the ONLY failure left is the feature gate
    // (the check lives in resolveMapForStart's custom branch, which runs before draft validation).
    await grant(t.db, host.id, ['mapBuilder']);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ map: { source: 'custom', customMapId: mapId } })
      .expect(200);
    const buddy = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'Buddy' })
      .expect(201);
    await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(buddy.body.accessToken))
      .expect(200);
    for (const token of [host.token, buddy.body.accessToken as string]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(token))
        .send({ ready: true })
        .expect(200);
    }
    await grant(t.db, host.id, []);
    const start = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(host.token))
      .expect(403);
    expect(start.body.code).toBe('FEATURE_DISABLED');

    // Official maps stay selectable without any feature.
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(host.token))
      .send({ map: { source: 'official', mapId: 'taiwan' } })
      .expect(200);
  });
});
```

(Routes verified against `lobby.controller.ts`: `POST /api/v1/rooms`, `POST /:code/join`, `POST /:code/ready` with `{ ready: true }`, `PATCH /:code/settings`, `POST /:code/start`. The official map id is `'taiwan'` — `packages/map-data/src/index.ts:19`.)

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run feature-gating`
Expected: FAIL — the settings PATCH returns 200 where 403 expected.

- [ ] **Step 3: Implement**

In `apps/server/src/lobby/lobby.service.ts`:

1. Add import: `import { featureDisabled } from '../auth/feature.guard';`
2. Add a helper next to `assertNotDisabled`:

```ts
  /** Hosting/selecting a custom map is part of the mapBuilder feature (spec: strict gate). */
  private async assertCustomMapAllowed(selector: MapSelector, userId: string): Promise<void> {
    if (selector.source !== 'custom') return;
    if (!(await this.users.hasFeature(userId, 'mapBuilder'))) {
      throw featureDisabled('mapBuilder');
    }
  }
```

3. Gate both existing custom-branch chokepoints — no reordering of `start()`'s guards. In `assertMapSelectable`, add the feature check ahead of the ownership read:

```ts
  private async assertMapSelectable(selector: MapSelector, callerUserId: string): Promise<void> {
    if (selector.source === 'official') {
      if (!officialMapById(selector.mapId)) {
        throw new BadRequestException(`unknown official map: ${selector.mapId}`);
      }
      return;
    }
    await this.assertCustomMapAllowed(selector, callerUserId);
    await this.maps.requireOwned(selector.customMapId, callerUserId);
  }
```

and in `resolveMapForStart`, mirror it in the custom branch (the last two lines of the method):

```ts
await this.assertCustomMapAllowed(selector, callerUserId);
const map = await this.maps.requireOwned(selector.customMapId, callerUserId);
return this.maps.resolveForStart(map, maxPlayers);
```

This makes the start-time check authoritative (a revoke between select and start still blocks) and fires before draft validation, which is what the Step-1 test asserts.

- [ ] **Step 4: Update pre-existing lobby specs**

`apps/server/test/lobby-custom-map.e2e.spec.ts` hosts games on custom maps — grant `['mapBuilder']` to its map-owning users right after registration, exactly like Task 3 Step 4 (find the register helper with `grep -n "auth/register" apps/server/test/lobby-custom-map.e2e.spec.ts` and add the `updateOne ... $set: { features: ['mapBuilder'] }` line). Do the same in `lobby-map-selector.e2e.spec.ts` / `lobby-settings.e2e.spec.ts` **only if** they patch a `{ source: 'custom' }` selector (grep for `custom`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run feature-gating`, then `--run lobby-custom-map`, `--run lobby-map-selector`, `--run lobby-settings`, `--run lobby.e2e`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/lobby/lobby.service.ts apps/server/test/feature-gating.e2e.spec.ts apps/server/test/lobby-custom-map.e2e.spec.ts
git commit -m "feat(server): custom-map select/host requires the mapBuilder feature"
```

(add the other lobby specs to the `git add` only if you changed them)

---

### Task 5: Server — replay browsing/sharing requires `replayReview` (link visibility unchanged)

**Files:**

- Modify: `apps/server/src/history/history.controller.ts`
- Test: `apps/server/test/history-replay.e2e.spec.ts` (fixture grants + a new gate-matrix describe)
- Modify: `apps/server/test/replay-visibility.e2e.spec.ts` (fixture grants)

**Interfaces:**

- Consumes: `UserRepo.hasFeature`, `featureDisabled` (Task 2). `HistoryModule` already imports `AuthModule` (which exports `UserRepo`).
- Produces: replay access rule `(isMember && hasReplayReview) || visibility === 'link'`; member-without-feature on a private replay → 403 `FEATURE_DISABLED` (outsiders keep the nondisclosing 404); `PATCH :gameId/visibility` requires the feature; `canConfigureVisibility = isPlayer && hasReplayReview`.

- [ ] **Step 1: Write the failing test**

The gate-matrix test lives in `apps/server/test/history-replay.e2e.spec.ts`, which already drives a real game to completion through the hub and exposes `host`, `member`, `watcher`, `outsider` (all guests) and `gameId`. Two edits there:

1. In its `beforeAll`, after the game completes, grant the members the feature so every PRE-EXISTING test in the file keeps passing (direct db writes work on guests — only the dashboard API refuses them):

```ts
await t.db
  .collection('users')
  .updateMany({ _id: { $in: [host.id, member.id, watcher.id] } } as never, {
    $set: { features: ['replayReview'] },
  });
```

2. Append a new describe at the END of the file (it revokes/re-grants `member`'s feature and restores all state before finishing, so position it last anyway):

```ts
describe('replay browsing requires replayReview', () => {
  const setFeatures = (userId: string, features: string[]) =>
    t.db.collection('users').updateOne({ _id: userId } as never, { $set: { features } });

  it('member without the feature: list/scoreboard OK, replay + visibility 403; link path stays open', async () => {
    await setFeatures(member.id, []);

    // History list + scoreboard stay open (spec: only the replay payload is gated).
    await request(server()).get('/api/v1/history').set(auth(member.token)).expect(200);
    await request(server()).get(`/api/v1/history/${gameId}`).set(auth(member.token)).expect(200);

    const denied = await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(member.token))
      .expect(403);
    expect(denied.body.code).toBe('FEATURE_DISABLED');

    // Sharing management is gated too.
    await request(server())
      .patch(`/api/v1/history/${gameId}/visibility`)
      .set(auth(member.token))
      .send({ visibility: 'link' })
      .expect(403);

    // Granted member: replay works and canConfigureVisibility is true.
    await setFeatures(member.id, ['replayReview']);
    const ok = await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(member.token))
      .expect(200);
    expect(ok.body.canConfigureVisibility).toBe(true);

    // Flip to link, revoke the feature: the member (and an anonymous visitor) can still
    // view via the link path; canConfigureVisibility drops to false.
    await request(server())
      .patch(`/api/v1/history/${gameId}/visibility`)
      .set(auth(member.token))
      .send({ visibility: 'link' })
      .expect(200);
    await setFeatures(member.id, []);
    const viaLink = await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(member.token))
      .expect(200);
    expect(viaLink.body.canConfigureVisibility).toBe(false);
    await request(server()).get(`/api/v1/history/${gameId}/replay`).expect(200); // anonymous

    // True outsider on a PRIVATE replay still gets the nondisclosing 404.
    await setFeatures(member.id, ['replayReview']);
    await request(server())
      .patch(`/api/v1/history/${gameId}/visibility`)
      .set(auth(member.token))
      .send({ visibility: 'private' })
      .expect(200);
    await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(outsider.token))
      .expect(404);
  });
});
```

If the file already ends with its own visibility flows that leave the game on `link`, restore `private` at the end exactly as above so ordering stays irrelevant.

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run history-replay`
Expected: the new describe FAILS — the first replay GET returns 200 where 403 expected (pre-existing tests still pass thanks to the `beforeAll` grant).

- [ ] **Step 3: Implement**

In `apps/server/src/history/history.controller.ts`:

1. Add imports:

```ts
import { UserRepo } from '../auth/user.repo';
import { featureDisabled } from '../auth/feature.guard';
```

2. Inject the repo:

```ts
  constructor(
    private readonly repo: HistoryRepo,
    private readonly users: UserRepo,
  ) {}
```

3. In `setVisibility`, before the repo call:

```ts
if (!(await this.users.hasFeature(user.userId, 'replayReview'))) {
  throw featureDisabled('replayReview');
}
```

4. In `replay`, replace the access block (the `isPlayer`/`isMember`/`visibility` lines through the `if (!isMember && visibility !== 'link')` throw) with:

```ts
const isPlayer = !!user && doc.players.some((p) => p.userId === user.userId);
const isMember = isPlayer || (!!user && (doc.spectators ?? []).includes(user.userId));
const visibility = doc.replayVisibility === 'link' ? 'link' : 'private';
// Membership grants access only WITH the replayReview feature; 'link' admits anyone
// holding the URL (anonymous included) regardless of features. A member without the
// feature gets a disclosed 403 (their own history already shows the game exists);
// outsiders keep the nondisclosing 404.
const canReview =
  isMember && user ? await this.users.hasFeature(user.userId, 'replayReview') : false;
if (!canReview && visibility !== 'link') {
  if (!isMember) throw new NotFoundException('game not found');
  throw featureDisabled('replayReview');
}
```

5. In the returned object, change `canConfigureVisibility: isPlayer` to:

```ts
      canConfigureVisibility: isPlayer && canReview,
```

6. Update the route's `@ApiOperation` summaries to mention the feature (e.g. `'Replay payload (config + action log) — members with the replayReview feature, or anyone when view-by-link'`).

- [ ] **Step 4: Update the other replay spec**

`replay-visibility.e2e.spec.ts` fetches replays and PATCHes visibility as members — grant `['replayReview']` to its users right after they're created (same `updateOne`/`updateMany` `$set: { features: ['replayReview'] }` pattern as Step 1.1; find its user-creation helper via `grep -n "auth/register\|auth/guest" apps/server/test/replay-visibility.e2e.spec.ts`). Where it asserts `canConfigureVisibility === true`, the asserting user needs the grant.

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run history-replay`, `--run replay-visibility`, `--run history-chat`, `--run og.e2e`
Expected: all PASS (og reads matchHistory server-side, not via the replay route — it must not need changes; if it fails, stop and re-read before touching it).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/history/history.controller.ts apps/server/test/history-replay.e2e.spec.ts apps/server/test/replay-visibility.e2e.spec.ts
git commit -m "feat(server): replay browsing/sharing requires the replayReview feature"
```

---

### Task 6: Server — dashboard features API (`users.features`)

**Files:**

- Modify: `apps/server/src/dashboard/audit.repo.ts` (action union)
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts`
- Modify: `apps/server/src/dashboard/dashboard-users.service.ts`
- Modify: `apps/server/src/dashboard/dashboard-users.controller.ts`
- Test: `apps/server/test/dashboard-features.e2e.spec.ts` (new)

**Interfaces:**

- Consumes: `UserRepo.setFeatures` / `listFeatured` (Task 2), `USER_FEATURES`/`UserFeature` (Task 1), `AuditService.log` (existing).
- Produces:
  - `PUT /api/v1/dashboard/users/:id/features` body `{ features: UserFeature[] }` → `DashboardUserDetail` (replaces the whole set; guests → 400; audited as `'user.features'` with `{ before, after }`).
  - `GET /api/v1/dashboard/users/features` → `{ users: DashboardUserRow[] }` (accounts holding ≥1 feature). **Must be declared before `@Get(':id')`.**
  - `DashboardUserRow` and `UserDetail` payloads now always carry `features: UserFeature[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/dashboard-features.e2e.spec.ts`:

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

let owner: Awaited<ReturnType<typeof registered>>;
let moderator: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  owner = await registered('owner@example.com', 'Owner');
  moderator = await registered('mod@example.com', 'Mod');
  const now = new Date();
  await t.db.collection('dashboardAccounts').insertMany([
    { _id: owner.userId, role: 'owner', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: moderator.userId, role: 'moderator', grantedBy: 'test', grantedAt: now, updatedAt: now },
  ] as never[]);
}, 60_000);
afterAll(() => t.close());

describe('dashboard feature grants', () => {
  it('grant → detail/list reflect it → revoke; audited; guests 400; moderators 403', async () => {
    const alice = await registered('alice@example.com', 'Alice');

    // Grant both features.
    const granted = await request(server())
      .put(`/api/v1/dashboard/users/${alice.userId}/features`)
      .set(auth(owner.token))
      .send({ features: ['replayReview', 'mapBuilder'] })
      .expect(200);
    expect(granted.body.features).toEqual(['replayReview', 'mapBuilder']);

    // The featured list contains alice.
    const list = await request(server())
      .get('/api/v1/dashboard/users/features')
      .set(auth(owner.token))
      .expect(200);
    expect(list.body.users.map((u: { id: string }) => u.id)).toContain(alice.userId);

    // The gate actually opens (feature is live on the game surface).
    await request(server()).get('/api/v1/maps').set(auth(alice.token)).expect(200);

    // Revoke-all unsets the field and empties the list entry.
    const revoked = await request(server())
      .put(`/api/v1/dashboard/users/${alice.userId}/features`)
      .set(auth(owner.token))
      .send({ features: [] })
      .expect(200);
    expect(revoked.body.features).toEqual([]);
    const after = await request(server())
      .get('/api/v1/dashboard/users/features')
      .set(auth(owner.token))
      .expect(200);
    expect(after.body.users.map((u: { id: string }) => u.id)).not.toContain(alice.userId);

    // Audit entries were appended.
    const audit = await request(server())
      .get('/api/v1/dashboard/audit')
      .set(auth(owner.token))
      .expect(200);
    const entries = audit.body.entries.filter(
      (e: { action: string; target?: { id: string } }) =>
        e.action === 'user.features' && e.target?.id === alice.userId,
    );
    expect(entries.length).toBe(2);

    // Guests can never hold features.
    const g = await request(server())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'G' })
      .expect(201);
    await request(server())
      .put(`/api/v1/dashboard/users/${g.body.user.id}/features`)
      .set(auth(owner.token))
      .send({ features: ['mapBuilder'] })
      .expect(400);

    // users.features is admin+ — a moderator is 403.
    await request(server())
      .put(`/api/v1/dashboard/users/${alice.userId}/features`)
      .set(auth(moderator.token))
      .send({ features: ['mapBuilder'] })
      .expect(403);
    await request(server())
      .get('/api/v1/dashboard/users/features')
      .set(auth(moderator.token))
      .expect(403);

    // Unknown feature name is rejected by validation.
    await request(server())
      .put(`/api/v1/dashboard/users/${alice.userId}/features`)
      .set(auth(owner.token))
      .send({ features: ['timeTravel'] })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-features`
Expected: FAIL — PUT `/features` route does not exist (404).

- [ ] **Step 3: Implement**

`apps/server/src/dashboard/audit.repo.ts` — extend the action union:

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

`apps/server/src/dashboard/dashboard.schemas.ts`:

1. Extend the shared import: `import { DASHBOARD_PERMISSIONS, DASHBOARD_ROLES, USER_FEATURES } from '@trm/shared';`
2. Below `DashboardPermissionSchema` add:

```ts
export const UserFeatureSchema = z.enum(USER_FEATURES);
```

3. Add `features` to `DashboardUserRowSchema` (after `oauthProviders`):

```ts
  features: z.array(UserFeatureSchema),
```

4. In the maintainers/users DTO area add:

```ts
export const UserFeaturesPutSchema = z.object({
  features: z.array(UserFeatureSchema).max(USER_FEATURES.length),
});
export class UserFeaturesPutDto extends createZodDto(UserFeaturesPutSchema) {}

export const FeaturedUsersSchema = z.object({
  users: z.array(DashboardUserRowSchema),
});
```

`apps/server/src/dashboard/dashboard-users.service.ts`:

1. Add to imports: `BadRequestException` from `@nestjs/common`; `import type { UserFeature } from '@trm/shared';`
2. In `toRow`, add after `oauthProviders: ...`:

```ts
  features: u.features ?? [],
```

3. Add two methods after `enable`:

```ts
  /** Replace a registered account's gated-feature set (dashboard `users.features`). */
  async setFeatures(actor: AuthUser, userId: string, features: UserFeature[]) {
    const target = await this.users.findById(userId);
    if (!target) throw new NotFoundException('user not found');
    if (target.isGuest) {
      throw new BadRequestException('features cannot be granted to guest accounts');
    }
    const deduped = [...new Set(features)];
    await this.users.setFeatures(userId, deduped);
    await this.audit.log(actor, 'user.features', { type: 'user', id: userId }, {
      before: target.features ?? [],
      after: deduped,
    });
    return this.detail(userId);
  }

  async listFeatured() {
    return { users: (await this.users.listFeatured()).map(toRow) };
  }
```

`apps/server/src/dashboard/dashboard-users.controller.ts`:

1. Extend imports: add `Put` to the `@nestjs/common` list; add `FeaturedUsersSchema`, `UserFeaturesPutDto`, and `UserFeaturesPutSchema` to the `./dashboard.schemas` import.
2. Add the list route **above** `@Get(':id')` (route order matters — `features` must not be captured as an `:id`):

```ts
  @Get('features')
  @RequirePermission('users.features')
  @ApiOperation({ summary: 'Accounts holding at least one gated feature' })
  @ApiResponse({ status: 200, schema: apiSchema(FeaturedUsersSchema) })
  listFeatured() {
    return this.users.listFeatured();
  }
```

3. Add the PUT route after `enable`:

```ts
  @Put(':id/features')
  @HttpCode(200)
  @RequirePermission('users.features')
  @ApiOperation({
    summary: "Replace a registered account's gated features (replayReview / mapBuilder)",
    description:
      'Grants apply on the very next request (features are read per request, never from ' +
      'token claims). Guests can never hold features.',
  })
  @ApiBody({ schema: apiSchema(UserFeaturesPutSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardUserDetailSchema) })
  setFeatures(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: UserFeaturesPutDto,
  ) {
    return this.users.setFeatures(actor, id, body.features);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run dashboard-features`, then `--run dashboard-read` and `--run dashboard-ban` (their user-row assertions may pin exact shapes — add `features: []` where they do), then the full `yarn workspace @trm/server test`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/dashboard/audit.repo.ts apps/server/src/dashboard/dashboard.schemas.ts apps/server/src/dashboard/dashboard-users.service.ts apps/server/src/dashboard/dashboard-users.controller.ts apps/server/test/dashboard-features.e2e.spec.ts
git commit -m "feat(server): dashboard feature-grant API behind users.features"
```

(add any adjusted dashboard specs to the `git add` too)

---

### Task 7: Admin — REST client additions + `AccountSelectorModal`

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Create: `apps/admin/src/components/AccountSelectorModal.tsx`
- Modify: `apps/admin/src/styles/` main stylesheet (the one defining `.oc-modal`)
- Test: `apps/admin/src/components/AccountSelectorModal.test.tsx`

**Interfaces:**

- Consumes: `UserFeature` from `@trm/shared`; existing `api.listUsers`, `.oc-modal` CSS, `SignalBadge`, `shortId`.
- Produces:
  - `UserRow.features: UserFeature[]`, `UserDetail` inherits it.
  - `api.putUserFeatures(id: string, features: UserFeature[]): Promise<UserDetail>`
  - `api.listFeaturedUsers(): Promise<{ users: UserRow[] }>`
  - `AccountSelectorModal({ title, onSelect, onClose, filter?, excludeIds? })` — `onSelect(user: UserRow)`.

- [ ] **Step 1: REST client**

In `apps/admin/src/net/rest.ts`:

1. Extend the shared import: `import type { DashboardPermission, DashboardRole, UserFeature } from '@trm/shared';`
2. Add to `UserRow` (after `oauthProviders`):

```ts
  features: UserFeature[];
```

3. Add to the `api` object after `enableUser`:

```ts
  putUserFeatures: (id: string, features: UserFeature[]) =>
    req<UserDetail>('PUT', `/dashboard/users/${encodeURIComponent(id)}/features`, { features }),
  listFeaturedUsers: () => req<{ users: UserRow[] }>('GET', '/dashboard/users/features'),
```

- [ ] **Step 2: Write the failing component test**

Create `apps/admin/src/components/AccountSelectorModal.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { AccountSelectorModal } from './AccountSelectorModal';
import { api, type UserRow } from '../net/rest';

vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../net/rest')>();
  return { ...mod, api: { ...mod.api, listUsers: vi.fn() } };
});
const mocked = api as unknown as { listUsers: ReturnType<typeof vi.fn> };

const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  email: 'alice@example.com',
  isGuest: false,
  oauthProviders: [],
  features: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

describe('AccountSelectorModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists registered accounts and reports the clicked one', async () => {
    mocked.listUsers.mockResolvedValue({ users: [row()], nextCursor: null });
    const onSelect = vi.fn();
    render(<AccountSelectorModal title="pick" onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(await screen.findByText('Alice'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
    expect(mocked.listUsers).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'registered' }),
    );
  });

  it('hides excluded ids and closes on Escape', async () => {
    mocked.listUsers.mockResolvedValue({
      users: [row(), row({ id: 'u2', displayName: 'Bob' })],
      nextCursor: null,
    });
    const onClose = vi.fn();
    render(
      <AccountSelectorModal
        title="pick"
        excludeIds={['u1']}
        onSelect={() => {}}
        onClose={onClose}
      />,
    );
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `yarn workspace @trm/admin test --run AccountSelectorModal`
Expected: FAIL — module `./AccountSelectorModal` not found.

- [ ] **Step 4: Implement the modal**

Create `apps/admin/src/components/AccountSelectorModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type UserFilter, type UserRow } from '../net/rest';
import { SignalBadge } from './SignalBadge';
import { shortId } from '../lib/fmt';

interface Props {
  title: string;
  onSelect: (user: UserRow) => void;
  onClose: () => void;
  /** Defaults to registered accounts — features and maintainer grants can only target them. */
  filter?: UserFilter;
  /** Accounts to hide (already granted / already maintainers). */
  excludeIds?: string[];
}

/** Search-as-you-type account picker over GET /dashboard/users (requires users.read). */
export function AccountSelectorModal({
  title,
  onSelect,
  onClose,
  filter = 'registered',
  excludeIds,
}: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(
      () => {
        setLoading(true);
        api
          .listUsers({ ...(q.trim() ? { q: q.trim() } : {}), filter })
          .then((page) => {
            if (!cancelled) setRows(page.users);
          })
          .catch(() => {
            if (!cancelled) setRows([]);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      q ? 250 : 0,
    ); // debounce typing, load immediately on open
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, filter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const excluded = new Set(excludeIds ?? []);
  const visible = rows.filter((u) => !excluded.has(u.id));

  return (
    <div className="oc-modal-backdrop" onClick={onClose}>
      <div
        className="oc-modal oc-account-selector"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <input
          type="search"
          autoFocus
          placeholder={t('accountSelector.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('common.search')}
        />
        <div className="oc-account-list">
          {visible.map((u) => (
            <button key={u.id} type="button" className="oc-account-row" onClick={() => onSelect(u)}>
              <span className="name">{u.displayName}</span>
              <span className="oc-mono oc-muted">{shortId(u.id)}</span>
              {u.email && <span className="oc-muted email">{u.email}</span>}
              {u.disabledAt && <SignalBadge aspect="stop" label={t('users.disabledBadge')} />}
            </button>
          ))}
          {visible.length === 0 && (
            <div className="oc-empty">{loading ? t('common.loading') : t('common.empty')}</div>
          )}
        </div>
        <div className="oc-modal-actions">
          <button className="oc-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Append to the admin stylesheet that defines `.oc-modal` (find it: `grep -rn "oc-modal-backdrop" apps/admin/src/styles/`):

```css
/* Account selector modal */
.oc-account-selector input[type='search'] {
  width: 100%;
  margin-bottom: 8px;
}
.oc-account-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.oc-account-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
}
.oc-account-row:hover {
  background: var(--oc-hover, rgba(128, 128, 128, 0.15));
}
.oc-account-row .email {
  margin-left: auto;
  font-size: 11px;
}
```

Add the i18n key in **both** locale objects in `apps/admin/src/i18n/index.ts` (full `features`/nav blocks come in Task 8; add just this now):

```ts
  accountSelector: {
    searchPlaceholder: '搜尋名稱或電子郵件…', // zh-Hant object
  },
```

```ts
  accountSelector: {
    searchPlaceholder: 'Search by name or email…', // en object
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/admin test --run AccountSelectorModal` and `yarn workspace @trm/admin typecheck`
Expected: PASS. (The typecheck also surfaces any admin test fixtures now missing `features` on `UserRow` — add `features: []` to them.)

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/components/AccountSelectorModal.tsx apps/admin/src/components/AccountSelectorModal.test.tsx apps/admin/src/i18n/index.ts apps/admin/src/styles
git commit -m "feat(admin): REST feature endpoints + reusable AccountSelectorModal"
```

---

### Task 8: Admin — Features view + nav/route + i18n

**Files:**

- Create: `apps/admin/src/components/FeatureToggles.tsx`
- Create: `apps/admin/src/views/FeaturesView.tsx`
- Modify: `apps/admin/src/store/ui.ts` (AdminView union + parsePath regex)
- Modify: `apps/admin/src/App.tsx` (NAV + ActiveView)
- Modify: `apps/admin/src/i18n/index.ts`
- Test: `apps/admin/src/views/FeaturesView.test.tsx`

**Interfaces:**

- Consumes: `AccountSelectorModal`, `api.listFeaturedUsers`, `api.putUserFeatures` (Task 7); `USER_FEATURES`/`UserFeature` (Task 1); `useSession.hasPermission('users.features')`.
- Produces:
  - `FeatureToggles({ userId, initial, onSaved? })` — checkbox-per-feature + save button (reused by Task 9's UserDrawer).
  - `FeaturesView` at `/admin/features`, nav-gated on `users.features`.
  - `AdminView` union includes `'features'`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/views/FeaturesView.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { FeaturesView } from './FeaturesView';
import { api, type UserRow } from '../net/rest';
import { useSession } from '../store/session';

vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../net/rest')>();
  return {
    ...mod,
    api: { ...mod.api, listFeaturedUsers: vi.fn(), listUsers: vi.fn(), putUserFeatures: vi.fn() },
  };
});
const mocked = api as unknown as {
  listFeaturedUsers: ReturnType<typeof vi.fn>;
  listUsers: ReturnType<typeof vi.fn>;
  putUserFeatures: ReturnType<typeof vi.fn>;
};

const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  isGuest: false,
  oauthProviders: [],
  features: ['mapBuilder'],
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

describe('FeaturesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ permissions: new Set(['users.read', 'users.features']) });
  });

  it('lists granted accounts with their features', async () => {
    mocked.listFeaturedUsers.mockResolvedValue({ users: [row()] });
    render(<FeaturesView />);
    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });

  it('opens the account selector from the add button', async () => {
    mocked.listFeaturedUsers.mockResolvedValue({ users: [] });
    mocked.listUsers.mockResolvedValue({ users: [row({ features: [] })], nextCursor: null });
    render(<FeaturesView />);
    fireEvent.click(await screen.findByRole('button', { name: /新增|Add/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/admin test --run FeaturesView`
Expected: FAIL — module `./FeaturesView` not found.

- [ ] **Step 3: Implement `FeatureToggles`**

Create `apps/admin/src/components/FeatureToggles.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { USER_FEATURES, type UserFeature } from '@trm/shared';
import { api, type UserDetail } from '../net/rest';

/** Checkbox-per-feature editor saving via PUT /dashboard/users/:id/features. */
export function FeatureToggles({
  userId,
  initial,
  onSaved,
}: {
  userId: string;
  initial: UserFeature[];
  onSaved?: (detail: UserDetail) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<UserFeature>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (f: UserFeature) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const detail = await api.putUserFeatures(userId, [...selected]);
      onSaved?.(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {USER_FEATURES.map((f) => (
        <label key={f} className="oc-kv" style={{ cursor: 'pointer' }}>
          <span className="k">{t(`feature.${f}`)}</span>
          <input type="checkbox" checked={selected.has(f)} onChange={() => toggle(f)} />
        </label>
      ))}
      {error && <p style={{ color: 'var(--oc-signal-stop)' }}>{error}</p>}
      <button className="oc-btn primary" disabled={busy} onClick={() => void save()}>
        {t('features.save')}
      </button>
    </>
  );
}
```

- [ ] **Step 4: Implement `FeaturesView`**

Create `apps/admin/src/views/FeaturesView.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type UserRow } from '../net/rest';
import { AccountSelectorModal } from '../components/AccountSelectorModal';
import { FeatureToggles } from '../components/FeatureToggles';
import { Drawer } from '../components/Drawer';
import { shortId } from '../lib/fmt';

export function FeaturesView() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.listFeaturedUsers()).users);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="oc-page-title">{t('features.title')}</h1>

      <div className="oc-toolbar">
        <button className="oc-btn primary" onClick={() => setPicking(true)}>
          {t('features.add')}
        </button>
      </div>

      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('features.colUser')}</th>
              <th>{t('features.colFeatures')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.displayName} <span className="oc-mono oc-muted">{shortId(u.id)}</span>
                  {u.email && <span className="oc-muted"> · {u.email}</span>}
                </td>
                <td>
                  <span className="oc-muted" style={{ fontSize: 11 }}>
                    {u.features.map((f) => t(`feature.${f}`)).join(' · ')}
                  </span>
                </td>
                <td>
                  <button className="oc-btn" onClick={() => setEditing(u)}>
                    {t('features.edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="oc-empty">{loading ? t('common.loading') : t('common.empty')}</div>
        )}
      </div>

      {picking && (
        <AccountSelectorModal
          title={t('features.pickTitle')}
          excludeIds={rows.map((u) => u.id)}
          onSelect={(u) => {
            setPicking(false);
            setEditing(u);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {editing && (
        <Drawer
          title={`${t('features.editorTitle')} · ${editing.displayName}`}
          onClose={() => setEditing(null)}
        >
          <section>
            <FeatureToggles
              userId={editing.id}
              initial={editing.features}
              onSaved={() => {
                setEditing(null);
                void load();
              }}
            />
          </section>
        </Drawer>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Route + nav + i18n**

`apps/admin/src/store/ui.ts`:

1. Add `'features'` to the `AdminView` union (after `'users'`).
2. Extend the `parsePath` regex:

```ts
const m = /^\/(users|features|games|rooms|maintainers|audit)(?:\/([^/]+))?\/?$/.exec(p);
```

`apps/admin/src/App.tsx`:

1. Import the view and an icon: add `FeaturesView` to the view imports; add `ToggleRight` to the lucide-react import.
2. Add to `NAV` after the users entry:

```ts
  { view: 'features', permission: 'users.features', icon: ToggleRight },
```

3. Add to `ActiveView`'s switch:

```tsx
    case 'features':
      return <FeaturesView />;
```

`apps/admin/src/i18n/index.ts` — in the **zh-Hant** object add (and `nav.features`):

```ts
  nav: { /* existing keys… */ features: '功能開通' },
  features: {
    title: '功能開通',
    add: '新增帳號',
    pickTitle: '選擇帳號',
    editorTitle: '編輯功能',
    colUser: '帳號',
    colFeatures: '已開通功能',
    edit: '編輯',
    save: '儲存',
  },
  feature: {
    replayReview: '重播檢視',
    mapBuilder: '地圖編輯器',
  },
```

and in `perm`:

```ts
    'users.features': '管理功能開通',
```

In the **en** object (key tree must match exactly):

```ts
  nav: { /* existing keys… */ features: 'Features' },
  features: {
    title: 'Feature access',
    add: 'Add account',
    pickTitle: 'Select an account',
    editorTitle: 'Edit features',
    colUser: 'Account',
    colFeatures: 'Enabled features',
    edit: 'Edit',
    save: 'Save',
  },
  feature: {
    replayReview: 'Replay viewing',
    mapBuilder: 'Map builder',
  },
```

and in `perm`:

```ts
    'users.features': 'Manage feature access',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn workspace @trm/admin test --run FeaturesView`, then `yarn workspace @trm/admin test` and `yarn workspace @trm/admin typecheck`
Expected: all PASS (fix any `App.test.tsx` nav-count assumptions if present).

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/components/FeatureToggles.tsx apps/admin/src/views/FeaturesView.tsx apps/admin/src/views/FeaturesView.test.tsx apps/admin/src/store/ui.ts apps/admin/src/App.tsx apps/admin/src/i18n/index.ts
git commit -m "feat(admin): Features view for per-account replay/map-builder grants"
```

---

### Task 9: Admin — UserDrawer features section + MaintainersView uses the selector modal

**Files:**

- Modify: `apps/admin/src/views/UsersView.tsx`
- Modify: `apps/admin/src/views/MaintainersView.tsx`
- Modify: `apps/admin/src/i18n/index.ts` (one key swap)

**Interfaces:**

- Consumes: `FeatureToggles` (Task 8), `AccountSelectorModal` (Task 7), `useSession.hasPermission`.
- Produces: features toggles inside the user detail drawer (registered users, viewer holds `users.features`); MaintainersView's add flow driven by the modal instead of a pasted userId.

- [ ] **Step 1: UserDrawer section**

In `apps/admin/src/views/UsersView.tsx`:

1. Add import: `import { FeatureToggles } from '../components/FeatureToggles';`
2. Inside `UserDrawer`, add below the `canBan` line:

```ts
const canFeatures = useSession((s) => s.hasPermission('users.features'));
```

3. Insert a section between the history section and the ban section (`key` remounts the toggles when a save refreshes `detail`):

```tsx
{
  canFeatures && !detail.isGuest && (
    <section>
      <h3>{t('features.title')}</h3>
      <FeatureToggles
        key={detail.features.join(',')}
        userId={detail.id}
        initial={detail.features}
        onSaved={setDetail}
      />
    </section>
  );
}
```

- [ ] **Step 2: MaintainersView add flow**

In `apps/admin/src/views/MaintainersView.tsx`:

1. Add import: `import { AccountSelectorModal } from '../components/AccountSelectorModal';`
2. Replace the `const [addId, setAddId] = useState('');` state with `const [picking, setPicking] = useState(false);`
3. Replace the whole `{canWrite && (<div className="oc-toolbar">…</div>)}` block with:

```tsx
{
  canWrite && (
    <div className="oc-toolbar">
      <button className="oc-btn primary" onClick={() => setPicking(true)}>
        {t('maintainers.add')}
      </button>
    </div>
  );
}
```

4. Next to the existing `{editing && …}` render, add:

```tsx
{
  picking && (
    <AccountSelectorModal
      title={t('maintainers.addTitle')}
      excludeIds={rows.map((m) => m.userId)}
      onSelect={(u) => {
        setPicking(false);
        setEditing({ userId: u.id, displayName: u.displayName });
      }}
      onClose={() => setPicking(false)}
    />
  );
}
```

5. In `apps/admin/src/i18n/index.ts`, replace the `maintainers.addPrompt` key in **both** locales with `addTitle` (zh-Hant: `addTitle: '選擇要授權的帳號'`; en: `addTitle: 'Select an account to grant'`). Grep for `addPrompt` to confirm no other usage remains.

- [ ] **Step 3: Verify**

Run: `yarn workspace @trm/admin test` and `yarn workspace @trm/admin typecheck` and `yarn workspace @trm/admin build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/views/UsersView.tsx apps/admin/src/views/MaintainersView.tsx apps/admin/src/i18n/index.ts
git commit -m "feat(admin): feature toggles in user drawer; maintainer add via account selector"
```

---

### Task 10: Web — `PublicUser.features` + hide/redirect gated entry points

**Files:**

- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/store/session.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppHeader.tsx`
- Modify: `apps/web/src/screens/RoomScreen.tsx`
- Modify: `apps/web/src/screens/HistoryScreen.tsx`
- Modify: `apps/web/src/screens/ReplayScreen.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/screens/HistoryScreen.test.tsx` (extend), plus fixture fixes surfaced by typecheck

**Interfaces:**

- Consumes: `UserFeature` from `@trm/shared`; server now always returns `features` on `PublicUser` (Task 2).
- Produces: `PublicUser.features: UserFeature[]` (required); `useHasFeature(feature: UserFeature): boolean` hook exported from `store/session.ts`.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/screens/HistoryScreen.test.tsx`:

1. Extend the `signedIn` fixture with `features: ['replayReview'],` (keeps existing tests meaningful once gating lands — they exercise the granted path).
2. Add a new test:

```tsx
it('hides the replay button entirely without the replayReview feature', async () => {
  useSession.setState({ user: { ...signedIn, features: [] } });
  mocked.history.mockResolvedValue([row()]);
  render(<HistoryScreen />);
  expect(await screen.findByText('Rival')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /重播/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/web test --run HistoryScreen`
Expected: the new test FAILS (button still rendered); existing tests may fail typecheck-side until Step 3.

- [ ] **Step 3: Types + session hook**

`apps/web/src/net/rest.ts`:

1. Add at the top: `import type { UserFeature } from '@trm/shared';`
2. Add to `PublicUser` (after `preferences`):

```ts
  /** Per-account gated features granted from the maintainer dashboard. */
  features: UserFeature[];
```

`apps/web/src/store/session.ts` — append after the store definition:

```ts
/** Convenience selector: does the signed-in user hold a dashboard-granted feature? */
export const useHasFeature = (feature: import('@trm/shared').UserFeature): boolean =>
  useSession((s) => !!s.user?.features?.includes(feature));
```

(Use a top-level `import type { UserFeature } from '@trm/shared'` instead of the inline import if the file gains other shared imports.)

- [ ] **Step 4: Gate the UI surfaces**

`apps/web/src/components/AppHeader.tsx`:

1. Import: `import { useHasFeature } from '../store/session';` (the file already imports from `../store/session` — extend that import).
2. In the component body: `const canBuild = useHasFeature('mapBuilder');`
3. Wrap **both** `enterMaps` entry points (menu item and toolbar icon button): change their conditions from `{user && !onAuthScreen && !inGame && (` to `{user && !onAuthScreen && !inGame && canBuild && (`.

`apps/web/src/App.tsx` — redirect direct URL hits at `/maps` + `/maps/:id/edit`:

1. Extend imports: `import { useHasFeature } from './store/session';`
2. In the component body:

```ts
const canBuild = useHasFeature('mapBuilder');
const goHome = useUi((s) => s.goHome);
// The builder is feature-gated: a direct /maps URL without the grant lands home.
// (Cosmetic only — the server 403s regardless.)
useEffect(() => {
  if (!booting && user && (view === 'maps' || view === 'mapEditor') && !canBuild) goHome();
}, [booting, user, view, canBuild, goHome]);
```

`apps/web/src/screens/RoomScreen.tsx`:

1. `const canBuild = useHasFeature('mapBuilder');` (extend the existing `../store/session` import with `useHasFeature`).
2. Skip the maps fetch for non-granted users — change the effect body's guard to:

```ts
if (!user || !canBuild) return;
```

and add `canBuild` to that effect's dependency array. 3. In the map picker, hide the custom option for non-granted hosts — replace the `Segmented` options with:

```tsx
                options={
                  canBuild
                    ? [
                        { value: 'official', label: t('mapOfficial') },
                        { value: 'custom', label: t('mapCustom') },
                      ]
                    : [{ value: 'official', label: t('mapOfficial') }]
                }
```

`apps/web/src/screens/HistoryScreen.tsx`:

1. `const canReplay = useHasFeature('replayReview');` (extend the `../store/session` import).
2. Wrap the replay button:

```tsx
{
  canReplay && (
    <button
      onClick={() => enterReplay(m.gameId)}
      disabled={!m.replayable}
      title={m.replayable ? t('history.watchReplay') : t('history.notReplayable')}
    >
      <Play size={14} aria-hidden /> {t('history.watchReplay')}
    </button>
  );
}
```

`apps/web/src/screens/ReplayScreen.tsx` — map the server's 403 to a specific message. In the fetch `.catch`/`try-catch` that currently sets `{ kind: 'error', msgKey: 'history.loadFailed' }`, distinguish the status (the file imports from `../net/rest` already — add `ApiError`):

```ts
if (!cancelled)
  setLoad({
    kind: 'error',
    msgKey:
      e instanceof ApiError && e.status === 403 ? 'history.replayDisabled' : 'history.loadFailed',
  });
```

(match the existing catch parameter name; if the catch is `.catch(() => …)` style, convert it to `.catch((e: unknown) => …)`.)

`apps/web/src/i18n/index.ts` — add to the `history` block in **both** locales:

- zh-Hant: `replayDisabled: '此帳號尚未開通重播功能'`
- en: `replayDisabled: 'Replay viewing is not enabled for this account'`

- [ ] **Step 5: Fix fixtures surfaced by typecheck**

Run: `yarn workspace @trm/web typecheck`
Every test fixture constructing a `PublicUser` now needs `features` — add `features: []` (or `['replayReview']`/`['mapBuilder']` where the test exercises a gated flow). Expect hits in `HistoryScreen.test.tsx` (done in Step 1), `HomeScreen.test.tsx`, `LoginScreen.test.tsx`, `SettingsModal.test.tsx`, `App.test.tsx` — follow the errors.

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn workspace @trm/web test` and `yarn workspace @trm/web build`
Expected: all PASS; the build's chunk report shows the builder still in its own lazy chunk.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/store/session.ts apps/web/src/App.tsx apps/web/src/components/AppHeader.tsx apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/HistoryScreen.tsx apps/web/src/screens/ReplayScreen.tsx apps/web/src/i18n/index.ts apps/web/src/screens/HistoryScreen.test.tsx
git commit -m "feat(web): hide replay/map-builder entry points behind account features"
```

(add any other fixed test files to the `git add`)

---

### Task 11: Docs, full validation, graphify

**Files:**

- Modify: `apps/server/CLAUDE.md`, `apps/web/CLAUDE.md`

- [ ] **Step 1: Update the docs**

`apps/server/CLAUDE.md`:

- In the `src/maps/` bullet: change “CRUD + sharing for user-authored maps, registered users only (`RegisteredUserGuard`, 403 for guests)” to “CRUD + sharing for user-authored maps, gated on the per-account `mapBuilder` feature (`FeatureGuard` → 403 `FEATURE_DISABLED`; `RegisteredUserGuard` still excludes guests). `GET /content/:hash` lives on `MapsContentController` OUTSIDE the gate — players/replay viewers resolve content by hash.”
- In the history/persistence paragraph, note the replay endpoint’s member path additionally requires the viewer’s `replayReview` feature (link visibility unchanged).
- In the dashboard section, mention the `users.features` permission and the `PUT /dashboard/users/:id/features` + `GET /dashboard/users/features` endpoints (audited as `user.features`; guests can never hold features).

`apps/web/CLAUDE.md`:

- In the builder section: change “Registered-users-only (guests can play a custom map, not author one)” to “Feature-gated (`mapBuilder`, granted per-account from the maintainer dashboard; guests can still play a custom map). Entry points hide and `/maps` redirects home without the grant.”
- In the replay section, add: replay browsing needs the `replayReview` feature; `/replay/:gameId` stays reachable for `link`-visibility replays; a 403 renders `history.replayDisabled`.

- [ ] **Step 2: Full-repo validation**

Run, from the repo root:

```bash
yarn typecheck && yarn lint && yarn test && yarn format:check
```

Expected: all pass. If `format:check` complains, run `yarn format` and restage the affected files (only ones this feature touched).

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`
Expected: completes without error (AST-only).

- [ ] **Step 4: Commit**

```bash
git add apps/server/CLAUDE.md apps/web/CLAUDE.md
git commit -m "docs: feature-gating notes for maps/replay + dashboard users.features"
```

(graphify-out changes are committed by the graphify hook/flow if the project does so routinely — otherwise leave them unstaged.)
