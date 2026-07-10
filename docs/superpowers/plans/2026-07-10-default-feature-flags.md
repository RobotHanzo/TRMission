# Default Feature Flags + Medium-Events Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a maintainer set global default feature flags from the admin dashboard, ship `randomEvents` on by default, and default new rooms to `moderate` events.

**Architecture:** A new `featureDefaults` singleton Mongo doc holds the global default `UserFeature[]` set. `UserRepo.hasFeature` and `AuthService`'s `PublicUser.features` both union an account's explicit grants with this global set (read fresh every request, no caching, no per-account "deny"). A new admin-only `config.features` permission gates a `GET/PUT /dashboard/config/features` pair that edits it. Separately, `DEFAULT_ROOM_SETTINGS.eventsMode` flips from `off` to `moderate`.

**Tech Stack:** NestJS (swc, not tsx) + MongoDB native driver + zod/nestjs-zod (server); React + Vite + zustand + react-i18next (admin); vitest + supertest + mongodb-memory-server (server e2e); vitest + @testing-library/react (admin).

## Global Constraints

- Server `dev`/`test` run through swc (`@swc-node/register` / `unplugin-swc`) — never switch to tsx/esbuild.
- `apps/admin` is pinned to Vite ^5 — do not touch that pin.
- Admin i18n: every new string key must be added to **both** the zh-Hant and en tables in `apps/admin/src/i18n/index.ts` (same key tree in both).
- Dashboard permissions follow the `resource.action` naming convention (`packages/shared/src/dashboard.ts`); a permission not in `DASHBOARD_PERMISSIONS` will not typecheck anywhere it's used.
- Every dashboard-mutating endpoint writes an audit entry via `AuditService.log` (`apps/server/src/dashboard/audit.service.ts`).
- Follow the existing e2e-only test convention in `apps/server` — there are no isolated per-file `.spec.ts` unit tests for repos/services; behavior is proven through `apps/server/test/*.e2e.spec.ts` against `createTestApp()` (mongodb-memory-server).
- Stay on `main`; commit only after the relevant test command passes; never `git add -A` — stage only the files each task actually touched.

---

## File Structure

**Create:**
- `apps/server/src/auth/feature-defaults.repo.ts` — the global-defaults Mongo repo.
- `apps/server/test/feature-defaults.e2e.spec.ts` — proves the union mechanism.
- `apps/server/src/dashboard/dashboard-feature-defaults.controller.ts` — `GET/PUT /dashboard/config/features`.
- `apps/server/src/dashboard/dashboard-feature-defaults.service.ts` — dedupe + persist + audit.
- `apps/server/test/dashboard-config-features.e2e.spec.ts` — endpoint + permission + audit e2e.

**Modify:**
- `packages/shared/src/dashboard.ts`, `packages/shared/test/dashboard.spec.ts` — new `config.features` permission.
- `packages/shared/src/features.ts` — doc-comment accuracy (global defaults now exist).
- `apps/server/src/auth/user.repo.ts` — `hasFeature` unions the global default set.
- `apps/server/src/auth/auth.service.ts` — `PublicUser.features` unions the global default set.
- `apps/server/src/auth/auth.module.ts` — register/export `FeatureDefaultsRepo`.
- `apps/server/src/lobby/room.repo.ts` — `DEFAULT_ROOM_SETTINGS.eventsMode` → `'moderate'`.
- `apps/server/test/lobby-settings.e2e.spec.ts`, `apps/server/test/lobby-events.e2e.spec.ts`, `apps/server/test/feature-gating.e2e.spec.ts` — ripple-effect fixes (see Tasks 3–4).
- `apps/server/src/dashboard/dashboard.schemas.ts`, `apps/server/src/dashboard/audit.repo.ts`, `apps/server/src/dashboard/dashboard.module.ts` — new endpoint wiring.
- `apps/admin/src/net/rest.ts` — `getDefaultFeatures`/`putDefaultFeatures`.
- `apps/admin/src/components/FeatureToggles.tsx`, `apps/admin/src/components/FeatureToggles.test.tsx` — generalize to a `target` prop.
- `apps/admin/src/views/UsersView.tsx`, `apps/admin/src/views/FeaturesView.tsx`, `apps/admin/src/views/FeaturesView.test.tsx` — new callers + new defaults panel.
- `apps/admin/src/i18n/index.ts` — new strings (zh-Hant + en).

---

### Task 1: `config.features` permission

**Files:**
- Modify: `packages/shared/src/dashboard.ts`
- Test: `packages/shared/test/dashboard.spec.ts`

**Interfaces:**
- Produces: `'config.features'` as a valid `DashboardPermission` literal, granted to `admin` and `owner` (not `viewer`/`moderator`) — every later task that references this permission string relies on it typechecking.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/test/dashboard.spec.ts`, inside the existing `describe('dashboard permission taxonomy', ...)` block, right before the final closing `});`:

```ts
  it('config.features is admin-tier, independent of users.features', () => {
    expect(ROLE_PERMISSIONS.viewer).not.toContain('config.features');
    expect(ROLE_PERMISSIONS.moderator).not.toContain('config.features');
    expect(ROLE_PERMISSIONS.admin).toContain('config.features');
    expect(ROLE_PERMISSIONS.owner).toContain('config.features');
    expect(DASHBOARD_PERMISSIONS).toContain('config.features');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: FAIL — TypeScript error, `'config.features'` is not assignable to `DashboardPermission` (the string literal doesn't exist in `DASHBOARD_PERMISSIONS` yet).

- [ ] **Step 3: Implement**

In `packages/shared/src/dashboard.ts`, add to the end of `DASHBOARD_PERMISSIONS`:

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
  'config.features',
] as const;
```

And add it to `ADMIN_PERMISSIONS` (so `admin` + `owner` inherit it, `viewer`/`moderator` don't):

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
  'config.features',
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: PASS (all tests in `dashboard.spec.ts`, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dashboard.ts packages/shared/test/dashboard.spec.ts
git commit -m "feat(shared): add config.features dashboard permission"
```

---

### Task 2: Global feature defaults storage + `UserRepo.hasFeature` union

**Files:**
- Create: `apps/server/src/auth/feature-defaults.repo.ts`
- Modify: `apps/server/src/auth/user.repo.ts`, `apps/server/src/auth/auth.module.ts`, `packages/shared/src/features.ts`
- Test: `apps/server/test/feature-defaults.e2e.spec.ts`

**Interfaces:**
- Consumes: `MONGO_DB` token (`apps/server/src/db/tokens.ts`); `UserFeature` (`@trm/shared`).
- Produces: `FeatureDefaultsRepo` (`@Injectable`, exported from `AuthModule`) with `get(): Promise<UserFeature[]>` and `set(features: UserFeature[]): Promise<UserFeature[]>`; `INITIAL_DEFAULTS: readonly UserFeature[] = ['randomEvents']` — the code-level fallback used until a maintainer ever saves a value. `UserRepo.hasFeature(userId, feature)` now returns `true` for a feature that's only in the global default set. Task 3 and Task 5 both depend on `FeatureDefaultsRepo`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/feature-defaults.e2e.spec.ts`:

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
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('global feature defaults', () => {
  it('a feature present only in the global default set still opens a FeatureGuard route', async () => {
    const a = await registered('def-maps@example.com', 'DefMaps');
    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(403);

    await t.db
      .collection('featureDefaults')
      .updateOne(
        { _id: 'singleton' } as never,
        { $set: { features: ['mapBuilder'] } },
        { upsert: true },
      );

    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(200);
  });

  it("an account's own explicit grant still works when the global default is empty", async () => {
    await t.db
      .collection('featureDefaults')
      .updateOne({ _id: 'singleton' } as never, { $set: { features: [] } }, { upsert: true });
    const a = await registered('def-grant@example.com', 'DefGrant');
    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(403);
    await t.db
      .collection('users')
      .updateOne({ _id: a.id } as never, { $set: { features: ['mapBuilder'] } });
    await request(server()).get('/api/v1/maps').set(auth(a.token)).expect(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run feature-defaults`
Expected: FAIL — the `featureDefaults` collection is never consulted yet, so the first test's second assertion gets 403 instead of 200.

- [ ] **Step 3: Implement**

Create `apps/server/src/auth/feature-defaults.repo.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import type { UserFeature } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';

export interface FeatureDefaultsDoc {
  _id: 'singleton';
  features: UserFeature[];
}

/** Shipped default until a maintainer has ever saved a value from the dashboard — lets a new
 *  default (e.g. turning randomEvents on) take effect immediately, with no boot-time seed step. */
export const INITIAL_DEFAULTS: readonly UserFeature[] = ['randomEvents'];

/**
 * The global feature-flag defaults, granted to every account on top of whatever a maintainer
 * has explicitly granted that account (`UserRepo.hasFeature` / `AuthService` union the two).
 * One document, fixed `_id`. Read fresh on every request — same "never cached, never baked
 * into new accounts" posture as per-account feature grants.
 */
@Injectable()
export class FeatureDefaultsRepo {
  private readonly col: Collection<FeatureDefaultsDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<FeatureDefaultsDoc>('featureDefaults');
  }

  async get(): Promise<UserFeature[]> {
    const doc = await this.col.findOne({ _id: 'singleton' });
    return doc ? doc.features : [...INITIAL_DEFAULTS];
  }

  async set(features: UserFeature[]): Promise<UserFeature[]> {
    const doc = await this.col.findOneAndUpdate(
      { _id: 'singleton' },
      { $set: { features } },
      { upsert: true, returnDocument: 'after' },
    );
    if (!doc) throw new Error('upsert returned no document');
    return doc.features;
  }
}
```

In `apps/server/src/auth/user.repo.ts`, add the import and thread `FeatureDefaultsRepo` through the constructor:

```ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import type { UserFeature } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';
import { env } from '../config/env';
import type { Locale, PublicUser, UserPreferences } from './auth.types';
import { DEFAULT_PREFERENCES } from './auth.types';
import type { OauthProvider } from './auth-config';
import { FeatureDefaultsRepo } from './feature-defaults.repo';
```

```ts
@Injectable()
export class UserRepo implements OnModuleInit {
  private readonly col: Collection<UserDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly defaults: FeatureDefaultsRepo,
  ) {
    this.col = db.collection<UserDoc>('users');
  }
```

And replace the `hasFeature` method:

```ts
  /** Per-request feature check (projection-only point read), unioned with the global default
   *  set. Used by FeatureGuard + inline gates. */
  async hasFeature(userId: string, feature: UserFeature): Promise<boolean> {
    const doc = await this.col.findOne({ _id: userId }, { projection: { features: 1 } });
    if (doc?.features?.includes(feature)) return true;
    return (await this.defaults.get()).includes(feature);
  }
```

In `apps/server/src/auth/auth.module.ts`, register and export `FeatureDefaultsRepo`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { UserRepo } from './user.repo';
import { FeatureDefaultsRepo } from './feature-defaults.repo';
import { SessionRepo } from './session.repo';
import { AccessTokenGuard } from './access-token.guard';
import { FeatureGuard } from './feature.guard';
import { AuthConfig } from './auth-config';
import { OauthService } from './oauth.service';
import { OAUTH_HTTP, FetchOauthHttp } from './oauth.http';
import { GOOGLE_ID_TOKEN_VERIFIER, GoogleAuthLibraryVerifier } from './google-id-token.verifier';

@Module({
  imports: [JwtModule.register({ secret: env.jwtSecret })],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    UserRepo,
    FeatureDefaultsRepo,
    SessionRepo,
    AccessTokenGuard,
    FeatureGuard,
    AuthConfig,
    OauthService,
    { provide: OAUTH_HTTP, useClass: FetchOauthHttp },
    { provide: GOOGLE_ID_TOKEN_VERIFIER, useClass: GoogleAuthLibraryVerifier },
  ],
  // Exported so the lobby can sign ws-game tickets and guard its routes; SessionRepo
  // for the dashboard's per-user session counts + ban-time revocation; FeatureDefaultsRepo
  // for the dashboard's default-flags endpoint (Task 5).
  exports: [TokenService, AccessTokenGuard, FeatureGuard, UserRepo, FeatureDefaultsRepo, SessionRepo],
})
export class AuthModule {}
```

In `packages/shared/src/features.ts`, update the doc comment for accuracy (a global default set now exists):

```ts
/**
 * Per-account gated features. Off unless granted — either directly to the account from the
 * maintainer dashboard (permission `users.features`), or via the global default set every
 * account gets on top of its own grants (permission `config.features`). Defined once here so
 * the server guard, the admin UI, and the web client can never drift — the same no-drift
 * pattern as the dashboard permission taxonomy.
 */
export const USER_FEATURES = ['replayReview', 'mapBuilder', 'randomEvents'] as const;
export type UserFeature = (typeof USER_FEATURES)[number];

export const isUserFeature = (s: string): s is UserFeature =>
  (USER_FEATURES as readonly string[]).includes(s);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run feature-defaults`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/feature-defaults.repo.ts apps/server/src/auth/user.repo.ts \
  apps/server/src/auth/auth.module.ts apps/server/test/feature-defaults.e2e.spec.ts \
  packages/shared/src/features.ts
git commit -m "feat(server): global feature-flag defaults, unioned into UserRepo.hasFeature"
```

---

### Task 3: `PublicUser.features` reflects the defaults

**Files:**
- Modify: `apps/server/src/auth/auth.service.ts`
- Test: `apps/server/test/feature-gating.e2e.spec.ts` (existing — one assertion changes)

**Interfaces:**
- Consumes: `FeatureDefaultsRepo.get()` (Task 2).
- Produces: `AuthService.issue/me/updatePreferences` all return a `PublicUser.features` that is `[...account grants, ...global defaults]` deduplicated — the shape the web app's `useHasFeature()` reads.

- [ ] **Step 1: Update the existing test to the new expected behavior (red)**

In `apps/server/test/feature-gating.e2e.spec.ts`, replace the `'PublicUser.features'` describe block:

```ts
describe('PublicUser.features', () => {
  it('starts at the global defaults and reflects grants instantly (no re-login)', async () => {
    const a = await registered('feat-me@example.com', 'FeatMe');
    const before = await request(server()).get('/api/v1/auth/me').set(auth(a.token)).expect(200);
    expect(before.body.features).toEqual(['randomEvents']);

    await grant(t.db, a.id, ['mapBuilder']);
    const after = await request(server()).get('/api/v1/auth/me').set(auth(a.token)).expect(200);
    expect(after.body.features).toEqual(['mapBuilder', 'randomEvents']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run feature-gating`
Expected: FAIL — `before.body.features` is still `[]` today (`AuthService` doesn't consult defaults yet).

- [ ] **Step 3: Implement**

In `apps/server/src/auth/auth.service.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { UserRepo, toPublicUser, type UserDoc } from './user.repo';
import { FeatureDefaultsRepo } from './feature-defaults.repo';
import { SessionRepo } from './session.repo';
import { TokenService } from './token.service';
import type { IssuedAuth, Locale, PublicUser, UserPreferences } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepo,
    private readonly sessions: SessionRepo,
    private readonly tokens: TokenService,
    private readonly defaults: FeatureDefaultsRepo,
  ) {}

  /** `toPublicUser` unioned with the global default feature set (Task 2) — the single place
   *  `PublicUser.features` is assembled, so every entry point below stays in sync. */
  private async withDefaults(user: UserDoc): Promise<PublicUser> {
    const pub = toPublicUser(user);
    const defaults = await this.defaults.get();
    return { ...pub, features: [...new Set([...pub.features, ...defaults])] };
  }

  private async issue(user: UserDoc): Promise<IssuedAuth> {
    // The single session-mint chokepoint (guest/register/login/upgrade/OAuth): a banned
    // account can never obtain a new session through any entry method.
    if (user.disabledAt) throw new ForbiddenException('account disabled');
    const refreshToken = await this.sessions.create(user._id);
    return {
      user: await this.withDefaults(user),
      accessToken: this.tokens.signAccess(user),
      refreshToken,
    };
  }

  /** Mint a fresh session for an already-resolved user (used by the OAuth flow). */
  issueFor(user: UserDoc): Promise<IssuedAuth> {
    return this.issue(user);
  }

  async guest(displayName: string, locale: Locale): Promise<IssuedAuth> {
    return this.issue(await this.users.createGuest(displayName, locale));
  }

  async register(
    email: string,
    password: string,
    displayName: string,
    locale: Locale,
  ): Promise<IssuedAuth> {
    if (await this.users.findByEmail(email))
      throw new ConflictException('email already registered');
    return this.issue(
      await this.users.createRegistered(email, await hash(password), displayName, locale),
    );
  }

  /** Attach credentials to the currently-authenticated guest, keeping its id (A9). */
  async upgrade(userId: string, email: string, password: string): Promise<IssuedAuth> {
    if (await this.users.findByEmail(email))
      throw new ConflictException('email already registered');
    const user = await this.users.upgradeGuest(userId, email, await hash(password));
    if (!user) throw new UnauthorizedException('not a guest account');
    // Prior guest refresh families die with the upgrade; the fresh one is minted just below.
    await this.sessions.revokeAllForUser(user._id);
    return this.issue(user);
  }

  async login(email: string, password: string): Promise<IssuedAuth> {
    const user = await this.users.findByEmail(email);
    if (!user?.passwordHash || !(await verify(user.passwordHash, password))) {
      throw new UnauthorizedException('invalid credentials');
    }
    return this.issue(user);
  }

  async refresh(
    refreshToken: string | undefined,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!refreshToken) throw new UnauthorizedException('no refresh token');
    const outcome = await this.sessions.rotate(refreshToken);
    if (outcome.kind !== 'ok') {
      throw new UnauthorizedException(
        outcome.kind === 'reuse' ? 'refresh token reuse detected' : 'invalid refresh token',
      );
    }
    const user = await this.users.findById(outcome.userId);
    if (!user) throw new UnauthorizedException('user not found');
    // Belt-and-braces on top of ban-time revokeAllForUser: a family minted in a race
    // with the ban still can't be rotated into a fresh access token.
    if (user.disabledAt) throw new UnauthorizedException('account disabled');
    return { accessToken: this.tokens.signAccess(user), refreshToken: outcome.token };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.sessions.revoke(refreshToken);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('user not found');
    return this.withDefaults(user);
  }

  async updatePreferences(userId: string, preferences: UserPreferences): Promise<PublicUser> {
    const user = await this.users.updatePreferences(userId, preferences);
    if (!user) throw new UnauthorizedException('user not found');
    return this.withDefaults(user);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run feature-gating`
Expected: PASS (all three describe blocks in the file).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/auth.service.ts apps/server/test/feature-gating.e2e.spec.ts
git commit -m "feat(server): PublicUser.features unions the global feature defaults"
```

---

### Task 4: Rooms default to `moderate` events

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts`, `apps/server/test/lobby-settings.e2e.spec.ts`, `apps/server/test/lobby-events.e2e.spec.ts`

**Interfaces:**
- Consumes: nothing new (pure constant change; `start()`'s existing silent-downgrade-to-`off` when the host lacks `randomEvents` is unchanged).
- Produces: `DEFAULT_ROOM_SETTINGS.eventsMode === 'moderate'` — any room whose stored settings don't explicitly set `eventsMode` now shows/starts `moderate` instead of `off` (subject to the host holding `randomEvents`, direct or default).

- [ ] **Step 1: Update the existing tests to the new expected behavior (red)**

In `apps/server/test/lobby-settings.e2e.spec.ts`, change the `it('defaults settings on a fresh room', ...)` assertion:

```ts
    expect(room.body.settings).toEqual({
      unlimitedStationBorrow: true,
      secondDrawAfterBlindRainbow: false,
      noUnfinishedTicketPenalty: false,
      doubleRouteSingleFor23: true,
      eventsMode: 'moderate',
      allowSpectating: true,
      visibility: 'INVITE_ONLY',
      map: { source: 'official', mapId: 'taiwan' },
    });
```

In `apps/server/test/lobby-events.e2e.spec.ts`, this whole suite tests the per-account `randomEvents` gate boundary by creating hosts with **no** grant and expecting them to be refused — that only holds if the global default is neutralized for this file, since Task 3 made `randomEvents` a real global default elsewhere. Add one line to `beforeAll`:

```ts
describe("lobby: random-events is gated by the host's randomEvents feature", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    // This suite tests the per-account gate boundary explicitly (grant()/no grant), so start
    // from an empty global default — Task 3 made randomEvents a real default elsewhere.
    await t.db
      .collection('featureDefaults')
      .updateOne({ _id: 'singleton' } as never, { $set: { features: [] } }, { upsert: true });
  }, 60_000);
  afterAll(() => t.close());
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/server test --run lobby-settings`
Expected: FAIL — `room.body.settings.eventsMode` is still `'off'`.

Run: `yarn workspace @trm/server test --run lobby-events`
Expected: PASS already (this file doesn't fail yet — the `beforeAll` addition is a pre-emptive fix for the change about to be made in Step 3; confirm it's still green before proceeding).

- [ ] **Step 3: Implement**

In `apps/server/src/lobby/room.repo.ts`, change the default:

```ts
export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  unlimitedStationBorrow: true,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
  doubleRouteSingleFor23: true,
  eventsMode: 'moderate',
  allowSpectating: true,
  visibility: 'INVITE_ONLY',
  map: { source: 'official', mapId: 'taiwan' },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/server test --run lobby-settings`
Expected: PASS.

Run: `yarn workspace @trm/server test --run lobby-events`
Expected: PASS (unaffected — the suite's `beforeAll` neutralization keeps every existing assertion valid; the second test's `start()` silent-downgrade-to-`off` logic still fires regardless of what `DEFAULT_ROOM_SETTINGS.eventsMode` is, since the host in that test holds no `randomEvents` grant).

Run: `yarn workspace @trm/server test --run lobby-practice`
Expected: PASS (unaffected — asserts room/member shape, not `eventsMode`).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/test/lobby-settings.e2e.spec.ts \
  apps/server/test/lobby-events.e2e.spec.ts
git commit -m "feat(server): default new rooms to moderate events"
```

---

### Task 5: Dashboard endpoint — `GET/PUT /dashboard/config/features`

**Files:**
- Create: `apps/server/src/dashboard/dashboard-feature-defaults.controller.ts`, `apps/server/src/dashboard/dashboard-feature-defaults.service.ts`
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts`, `apps/server/src/dashboard/audit.repo.ts`, `apps/server/src/dashboard/dashboard.module.ts`
- Test: `apps/server/test/dashboard-config-features.e2e.spec.ts`

**Interfaces:**
- Consumes: `FeatureDefaultsRepo` (Task 2, exported from `AuthModule`, which `DashboardModule` already imports); `AuditService.log` (existing); `config.features` permission (Task 1).
- Produces: `GET /api/v1/dashboard/config/features` → `{ features: UserFeature[] }`; `PUT` same path/body/response, permission-gated, audited as `'config.features'`. Task 6 (admin REST client) calls these two routes by exact path/shape.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/dashboard-config-features.e2e.spec.ts`:

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
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

let owner: Awaited<ReturnType<typeof registered>>;
let admin: Awaited<ReturnType<typeof registered>>;
let moderator: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  owner = await registered('cfg-owner@example.com', 'Owner');
  admin = await registered('cfg-admin@example.com', 'Admin');
  moderator = await registered('cfg-mod@example.com', 'Mod');
  const now = new Date();
  await t.db.collection('dashboardAccounts').insertMany([
    { _id: owner.id, role: 'owner', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: admin.id, role: 'admin', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: moderator.id, role: 'moderator', grantedBy: 'test', grantedAt: now, updatedAt: now },
  ] as never[]);
}, 60_000);
afterAll(() => t.close());

describe('dashboard config: default feature flags', () => {
  it('starts at the code fallback, round-trips a PUT, is audited, and is permission-gated', async () => {
    // Fresh install: the fallback default (randomEvents) shows up before any admin ever saves.
    const initial = await request(server())
      .get('/api/v1/dashboard/config/features')
      .set(auth(owner.token))
      .expect(200);
    expect(initial.body.features).toEqual(['randomEvents']);

    // config.features is a distinct permission from users.features — a moderator has neither.
    await request(server())
      .get('/api/v1/dashboard/config/features')
      .set(auth(moderator.token))
      .expect(403);
    await request(server())
      .put('/api/v1/dashboard/config/features')
      .set(auth(moderator.token))
      .send({ features: [] })
      .expect(403);

    // Admin can change it; the change round-trips and dedupes.
    const put = await request(server())
      .put('/api/v1/dashboard/config/features')
      .set(auth(admin.token))
      .send({ features: ['mapBuilder', 'mapBuilder', 'replayReview'] })
      .expect(200);
    expect(put.body.features).toEqual(['mapBuilder', 'replayReview']);

    const after = await request(server())
      .get('/api/v1/dashboard/config/features')
      .set(auth(owner.token))
      .expect(200);
    expect(after.body.features).toEqual(['mapBuilder', 'replayReview']);

    // The new default actually opens a feature-gated route for an account with no explicit grant.
    const bystander = await registered('cfg-bystander@example.com', 'Bystander');
    await request(server()).get('/api/v1/maps').set(auth(bystander.token)).expect(200);

    // Audited with before/after.
    const audit = await request(server())
      .get('/api/v1/dashboard/audit')
      .set(auth(owner.token))
      .expect(200);
    const entry = audit.body.entries.find((e: { action: string }) => e.action === 'config.features');
    expect(entry).toBeDefined();
    expect(entry.params).toEqual({ before: ['randomEvents'], after: ['mapBuilder', 'replayReview'] });

    // Unknown feature name is rejected by validation.
    await request(server())
      .put('/api/v1/dashboard/config/features')
      .set(auth(admin.token))
      .send({ features: ['timeTravel'] })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-config-features`
Expected: FAIL — 404 (route doesn't exist yet).

- [ ] **Step 3: Implement**

In `apps/server/src/dashboard/dashboard.schemas.ts`, add near `UserFeaturesPutSchema`:

```ts
export const ConfigFeaturesSchema = z.object({
  features: z.array(UserFeatureSchema),
});
export const ConfigFeaturesPutSchema = z.object({
  features: z.array(UserFeatureSchema).max(USER_FEATURES.length),
});
export class ConfigFeaturesPutDto extends createZodDto(ConfigFeaturesPutSchema) {}
```

In `apps/server/src/dashboard/audit.repo.ts`, add `'config.features'` to `DashboardAuditAction`:

```ts
export type DashboardAuditAction =
  | 'bootstrap.grant'
  | 'user.ban'
  | 'user.unban'
  | 'user.features'
  | 'user.delete'
  | 'game.terminate'
  | 'game.delete'
  | 'game.viewReplay'
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

Create `apps/server/src/dashboard/dashboard-feature-defaults.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { UserFeature } from '@trm/shared';
import type { AuthUser } from '../auth/auth.types';
import { FeatureDefaultsRepo } from '../auth/feature-defaults.repo';
import { AuditService } from './audit.service';

/** Backs `GET/PUT /dashboard/config/features` (permission `config.features`) — the global
 *  default feature set every account gets on top of its own explicit grants. */
@Injectable()
export class DashboardFeatureDefaultsService {
  constructor(
    private readonly defaults: FeatureDefaultsRepo,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<{ features: UserFeature[] }> {
    return { features: await this.defaults.get() };
  }

  async set(actor: AuthUser, features: UserFeature[]): Promise<{ features: UserFeature[] }> {
    const before = await this.defaults.get();
    const deduped = [...new Set(features)];
    const after = await this.defaults.set(deduped);
    await this.audit.log(actor, 'config.features', undefined, { before, after });
    return { features: after };
  }
}
```

Create `apps/server/src/dashboard/dashboard-feature-defaults.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DashboardGuard } from './dashboard.guard';
import { RequirePermission } from './require-permission.decorator';
import { DashboardFeatureDefaultsService } from './dashboard-feature-defaults.service';
import {
  ConfigFeaturesPutDto,
  ConfigFeaturesPutSchema,
  ConfigFeaturesSchema,
} from './dashboard.schemas';

@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard, DashboardGuard)
@Controller('api/v1/dashboard/config')
export class DashboardFeatureDefaultsController {
  constructor(private readonly config: DashboardFeatureDefaultsService) {}

  @Get('features')
  @RequirePermission('config.features')
  @ApiOperation({
    summary: 'Global default feature flags, granted to every account on top of any explicit grant',
  })
  @ApiResponse({ status: 200, schema: apiSchema(ConfigFeaturesSchema) })
  getFeatures() {
    return this.config.get();
  }

  @Put('features')
  @HttpCode(200)
  @RequirePermission('config.features')
  @ApiOperation({
    summary: 'Replace the global default feature set',
    description:
      'Applies on the very next request for every account that does not already hold the ' +
      'feature directly (defaults are read fresh, never cached or baked into new accounts).',
  })
  @ApiBody({ schema: apiSchema(ConfigFeaturesPutSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(ConfigFeaturesSchema) })
  setFeatures(@CurrentUser() actor: AuthUser, @Body() body: ConfigFeaturesPutDto) {
    return this.config.set(actor, body.features);
  }
}
```

In `apps/server/src/dashboard/dashboard.module.ts`, register the new controller/service:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameModule } from '../game/game.module';
import { LobbyModule } from '../lobby/lobby.module';
import { HistoryModule } from '../history/history.module';
import { MapsModule } from '../maps/maps.module';
import { DashboardConfig } from './dashboard-config';
import { DashboardAccountRepo } from './dashboard-account.repo';
import { DashboardAuditRepo } from './audit.repo';
import { AuditService } from './audit.service';
import { DashboardGuard } from './dashboard.guard';
import { DashboardService } from './dashboard.service';
import { DashboardUsersService } from './dashboard-users.service';
import { DashboardGamesService } from './dashboard-games.service';
import { DashboardMaintainersService } from './dashboard-maintainers.service';
import { DashboardFeatureDefaultsService } from './dashboard-feature-defaults.service';
import { PurgeService } from './purge.service';
import { DashboardMapsService } from './dashboard-maps.service';
import { DashboardController } from './dashboard.controller';
import { DashboardUsersController } from './dashboard-users.controller';
import { DashboardGamesController } from './dashboard-games.controller';
import { DashboardMaintainersController } from './dashboard-maintainers.controller';
import { DashboardFeatureDefaultsController } from './dashboard-feature-defaults.controller';
import { DashboardPurgeController } from './dashboard-purge.controller';
import { DashboardMapsController } from './dashboard-maps.controller';
import { DashboardRatingsService } from './dashboard-ratings.service';
import { DashboardRatingsController } from './dashboard-ratings.controller';
import { DashboardBootstrap } from './dashboard-bootstrap';
import { RatingsModule } from '../ratings/ratings.module';

@Module({
  imports: [AuthModule, GameModule, LobbyModule, HistoryModule, MapsModule, RatingsModule],
  controllers: [
    DashboardController,
    DashboardUsersController,
    DashboardGamesController,
    DashboardMaintainersController,
    DashboardFeatureDefaultsController,
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
    DashboardFeatureDefaultsService,
    DashboardBootstrap,
    PurgeService,
    DashboardMapsService,
    DashboardRatingsService,
  ],
})
export class DashboardModule {}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-config-features`
Expected: PASS.

- [ ] **Step 5: Run the full server suite once to confirm no regressions**

Run: `yarn workspace @trm/server test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/dashboard/dashboard-feature-defaults.controller.ts \
  apps/server/src/dashboard/dashboard-feature-defaults.service.ts \
  apps/server/src/dashboard/dashboard.schemas.ts apps/server/src/dashboard/audit.repo.ts \
  apps/server/src/dashboard/dashboard.module.ts \
  apps/server/test/dashboard-config-features.e2e.spec.ts
git commit -m "feat(server): dashboard endpoint to edit the global default feature flags"
```

---

### Task 6: Generalize `FeatureToggles` to a `target` prop

**Files:**
- Modify: `apps/admin/src/net/rest.ts`, `apps/admin/src/components/FeatureToggles.tsx`, `apps/admin/src/components/FeatureToggles.test.tsx`, `apps/admin/src/views/UsersView.tsx`, `apps/admin/src/views/FeaturesView.tsx`

**Interfaces:**
- Consumes: `PUT/GET /dashboard/config/features` (Task 5).
- Produces: `api.getDefaultFeatures(): Promise<{features: UserFeature[]}>`, `api.putDefaultFeatures(features): Promise<{features: UserFeature[]}>`; `FeatureToggles({ target, initial })` where `target` is `{kind:'user', userId, onSaved?: (detail: UserDetail) => void} | {kind:'defaults', onSaved?: (features: UserFeature[]) => void}` — Task 7's new panel depends on this exact `target` shape and the two REST methods.

- [ ] **Step 1: Update `FeatureToggles.test.tsx` to the new prop shape, plus a new defaults-target case (red)**

Replace `apps/admin/src/components/FeatureToggles.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as RestModule from '../net/rest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { FeatureToggles } from './FeatureToggles';
import { api } from '../net/rest';
import { useToast } from '../store/toast';
import { ToastStack } from './ToastStack';

vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof RestModule>();
  return {
    ...mod,
    api: { ...mod.api, putUserFeatures: vi.fn(), putDefaultFeatures: vi.fn() },
  };
});
const mocked = api as unknown as {
  putUserFeatures: ReturnType<typeof vi.fn>;
  putDefaultFeatures: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
});

describe('FeatureToggles toasts', () => {
  it('shows a success toast after saving a user target', async () => {
    mocked.putUserFeatures.mockResolvedValue({ id: 'u1', features: ['mapBuilder'] });
    render(
      <>
        <FeatureToggles target={{ kind: 'user', userId: 'u1' }} initial={[]} />
        <ToastStack />
      </>,
    );
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('功能開通已儲存')).toBeInTheDocument();
    expect(mocked.putUserFeatures).toHaveBeenCalledWith('u1', []);
  });

  it('shows an error toast when saving fails', async () => {
    mocked.putUserFeatures.mockRejectedValue(new Error('boom'));
    render(
      <>
        <FeatureToggles target={{ kind: 'user', userId: 'u1' }} initial={[]} />
        <ToastStack />
      </>,
    );
    fireEvent.click(screen.getByText('儲存'));
    // FeatureToggles also shows the same message as an inline paragraph (existing
    // behavior, kept as-is), so scope to the toast specifically (role="status") rather
    // than a plain text query, which would become ambiguous once both are on screen.
    expect(await screen.findByRole('status')).toHaveTextContent('boom');
  });

  it('saves the defaults target via putDefaultFeatures and calls onSaved with the features array', async () => {
    mocked.putDefaultFeatures.mockResolvedValue({ features: ['randomEvents'] });
    const onSaved = vi.fn();
    render(
      <>
        <FeatureToggles target={{ kind: 'defaults', onSaved }} initial={['randomEvents']} />
        <ToastStack />
      </>,
    );
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('功能開通已儲存')).toBeInTheDocument();
    expect(mocked.putDefaultFeatures).toHaveBeenCalledWith(['randomEvents']);
    expect(onSaved).toHaveBeenCalledWith(['randomEvents']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/admin test FeatureToggles`
Expected: FAIL — `FeatureToggles` still takes a flat `userId` prop; TS/render errors.

- [ ] **Step 3: Implement**

Replace `apps/admin/src/components/FeatureToggles.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { USER_FEATURES, type UserFeature } from '@trm/shared';
import { api, type UserDetail } from '../net/rest';
import { useToast } from '../store/toast';

export type FeatureToggleTarget =
  | { kind: 'user'; userId: string; onSaved?: (detail: UserDetail) => void }
  | { kind: 'defaults'; onSaved?: (features: UserFeature[]) => void };

/** Checkbox-per-feature editor. Saves via PUT /dashboard/users/:id/features for a `user`
 *  target, or PUT /dashboard/config/features for the `defaults` target. */
export function FeatureToggles({
  target,
  initial,
}: {
  target: FeatureToggleTarget;
  initial: UserFeature[];
}) {
  const { t } = useTranslation();
  const pushToast = useToast((s) => s.push);
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
      if (target.kind === 'user') {
        const detail = await api.putUserFeatures(target.userId, [...selected]);
        target.onSaved?.(detail);
      } else {
        const { features } = await api.putDefaultFeatures([...selected]);
        target.onSaved?.(features);
      }
      pushToast('success', t('toast.featuresSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
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

In `apps/admin/src/net/rest.ts`, add next to `listFeaturedUsers` (inside the `api` object):

```ts
  getDefaultFeatures: () => req<{ features: UserFeature[] }>('GET', '/dashboard/config/features'),
  putDefaultFeatures: (features: UserFeature[]) =>
    req<{ features: UserFeature[] }>('PUT', '/dashboard/config/features', { features }),
```

In `apps/admin/src/views/UsersView.tsx`, update the `FeatureToggles` usage:

```tsx
              <FeatureToggles
                key={detail.features.join(',')}
                target={{ kind: 'user', userId: detail.id, onSaved: setDetail }}
                initial={detail.features}
              />
```

In `apps/admin/src/views/FeaturesView.tsx`, update the per-user drawer's `FeatureToggles` usage:

```tsx
            <FeatureToggles
              target={{
                kind: 'user',
                userId: editing.id,
                onSaved: () => {
                  setEditing(null);
                  void load();
                },
              }}
              initial={editing.features}
            />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/admin test FeatureToggles`
Expected: PASS.

Run: `yarn workspace @trm/admin typecheck`
Expected: PASS (proves `UsersView.tsx`/`FeaturesView.tsx` compile against the new prop shape).

Run: `yarn workspace @trm/admin test UsersView FeaturesView`
Expected: PASS (existing tests for both views still pass against the new call sites).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/components/FeatureToggles.tsx \
  apps/admin/src/components/FeatureToggles.test.tsx apps/admin/src/views/UsersView.tsx \
  apps/admin/src/views/FeaturesView.tsx
git commit -m "refactor(admin): generalize FeatureToggles to a user/defaults target"
```

---

### Task 7: "Default feature flags" panel in the admin Features view

**Files:**
- Modify: `apps/admin/src/views/FeaturesView.tsx`, `apps/admin/src/views/FeaturesView.test.tsx`, `apps/admin/src/i18n/index.ts`

**Interfaces:**
- Consumes: `api.getDefaultFeatures`/`api.putDefaultFeatures` and `FeatureToggles({target: {kind:'defaults', onSaved}, initial})` (Task 6); `useSession((s) => s.hasPermission('config.features'))` (Task 1's permission).
- Produces: nothing consumed by a later task — this is the final task.

- [ ] **Step 1: Extend `FeaturesView.test.tsx` with the new panel's tests (red)**

Replace `apps/admin/src/views/FeaturesView.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as RestModule from '../net/rest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { FeaturesView } from './FeaturesView';
import { api, type UserRow } from '../net/rest';
import { useSession } from '../store/session';

vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof RestModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      listFeaturedUsers: vi.fn(),
      listUsers: vi.fn(),
      putUserFeatures: vi.fn(),
      getDefaultFeatures: vi.fn(),
      putDefaultFeatures: vi.fn(),
    },
  };
});
const mocked = api as unknown as {
  listFeaturedUsers: ReturnType<typeof vi.fn>;
  listUsers: ReturnType<typeof vi.fn>;
  putUserFeatures: ReturnType<typeof vi.fn>;
  getDefaultFeatures: ReturnType<typeof vi.fn>;
  putDefaultFeatures: ReturnType<typeof vi.fn>;
};

const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  isGuest: false,
  oauthProviders: [],
  hasPassword: false,
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

  it('hides the default-flags panel without config.features', async () => {
    mocked.listFeaturedUsers.mockResolvedValue({ users: [] });
    render(<FeaturesView />);
    await screen.findByText('功能開通');
    expect(mocked.getDefaultFeatures).not.toHaveBeenCalled();
    expect(screen.queryByText('預設功能旗標')).not.toBeInTheDocument();
  });

  it('loads and saves the default-flags panel with config.features', async () => {
    useSession.setState({
      permissions: new Set(['users.read', 'users.features', 'config.features']),
    });
    mocked.listFeaturedUsers.mockResolvedValue({ users: [] });
    mocked.getDefaultFeatures.mockResolvedValue({ features: ['randomEvents'] });
    mocked.putDefaultFeatures.mockResolvedValue({ features: ['randomEvents', 'mapBuilder'] });
    render(<FeaturesView />);
    expect(await screen.findByText('預設功能旗標')).toBeInTheDocument();
    fireEvent.click(await screen.findByText('儲存'));
    expect(mocked.putDefaultFeatures).toHaveBeenCalledWith(['randomEvents']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/admin test FeaturesView`
Expected: FAIL — the panel doesn't exist yet, and the `'預設功能旗標'` / `config.features` i18n key aren't wired up.

- [ ] **Step 3: Implement**

Replace `apps/admin/src/views/FeaturesView.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserFeature } from '@trm/shared';
import { api, type UserRow } from '../net/rest';
import { useSession } from '../store/session';
import { AccountSelectorModal } from '../components/AccountSelectorModal';
import { FeatureToggles } from '../components/FeatureToggles';
import { Drawer } from '../components/Drawer';
import { shortId } from '../lib/fmt';

export function FeaturesView() {
  const { t } = useTranslation();
  const canEditDefaults = useSession((s) => s.hasPermission('config.features'));
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [defaults, setDefaults] = useState<UserFeature[] | null>(null);

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

  useEffect(() => {
    if (!canEditDefaults) return;
    void api.getDefaultFeatures().then((r) => setDefaults(r.features));
  }, [canEditDefaults]);

  return (
    <div>
      <h1 className="oc-page-title">{t('features.title')}</h1>

      {canEditDefaults && defaults && (
        <section>
          <h2>{t('features.defaultsTitle')}</h2>
          <p className="oc-muted">{t('features.defaultsDesc')}</p>
          <FeatureToggles target={{ kind: 'defaults', onSaved: setDefaults }} initial={defaults} />
        </section>
      )}

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
              target={{
                kind: 'user',
                userId: editing.id,
                onSaved: () => {
                  setEditing(null);
                  void load();
                },
              }}
              initial={editing.features}
            />
          </section>
        </Drawer>
      )}
    </div>
  );
}
```

In `apps/admin/src/i18n/index.ts`, add to the **zh-Hant** `features` object (right after `save: '儲存',` and before the closing of that object — the block immediately precedes `feature: {`):

```ts
  features: {
    title: '功能開通',
    add: '新增帳號',
    pickTitle: '選擇帳號',
    editorTitle: '編輯功能',
    colUser: '帳號',
    colFeatures: '已開通功能',
    edit: '編輯',
    save: '儲存',
    defaultsTitle: '預設功能旗標',
    defaultsDesc: '在此開啟的功能會套用到所有尚未被個別授權的帳號。',
  },
```

Add to the **zh-Hant** `perm` object (right after `'users.features': '管理功能開通',`):

```ts
    'users.features': '管理功能開通',
    'config.features': '管理預設功能旗標',
```

Add to the **zh-Hant** `audit.action` object (right after `'user.features': '調整功能開通',`):

```ts
      'user.features': '調整功能開通',
      'config.features': '調整預設功能旗標',
```

Add to the **en** `features` object (right after `save: 'Save',`):

```ts
  features: {
    title: 'Feature access',
    add: 'Add account',
    pickTitle: 'Select an account',
    editorTitle: 'Edit features',
    colUser: 'Account',
    colFeatures: 'Enabled features',
    edit: 'Edit',
    save: 'Save',
    defaultsTitle: 'Default feature flags',
    defaultsDesc: 'Features enabled here apply to every account that has not been granted them individually.',
  },
```

Add to the **en** `perm` object (right after `'users.features': 'Manage feature access',`):

```ts
    'users.features': 'Manage feature access',
    'config.features': 'Manage default feature flags',
```

Add to the **en** `audit.action` object (right after `'user.features': 'Changed feature access',`):

```ts
      'user.features': 'Changed feature access',
      'config.features': 'Changed default feature flags',
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/admin test FeaturesView`
Expected: PASS.

- [ ] **Step 5: Run the full admin suite and typecheck once to confirm no regressions**

Run: `yarn workspace @trm/admin test`
Expected: PASS.

Run: `yarn workspace @trm/admin typecheck`
Expected: PASS.

Run: `yarn workspace @trm/admin lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/views/FeaturesView.tsx apps/admin/src/views/FeaturesView.test.tsx \
  apps/admin/src/i18n/index.ts
git commit -m "feat(admin): default feature flags panel in the Features view"
```

---

## Final verification (run once, after all 7 tasks)

- [ ] `yarn workspace @trm/shared test`
- [ ] `yarn workspace @trm/server typecheck && yarn workspace @trm/server test`
- [ ] `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint && yarn workspace @trm/admin test`
- [ ] Manually confirm via `/docs` (Scalar) that `GET/PUT /dashboard/config/features` appear with the right request/response schemas.

## Out of scope (from the spec's YAGNI section — do not add)

- No per-account **denial** of a globally-defaulted feature.
- No migration/backfill of existing accounts or rooms.
- No caching of the `featureDefaults` doc.
