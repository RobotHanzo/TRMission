# Mobile Auth Foundation (P0-a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give native mobile clients a complete, cookie-free auth path on the existing NestJS server: body-token refresh/logout, refresh-token-in-body issuance, Google multi-audience credentials, a one-time-code mobile OAuth handoff with deep-link support files, a sliding guest TTL, and a forced-update version gate.

**Architecture:** All changes live in `apps/server` (plus docs). The rotating refresh-family model (`SessionRepo`) is already transport-agnostic — we add transports, never touch rotation logic. Mobile clients identify via the `x-trm-client: mobile` header (issuance) or by supplying `refreshToken` in the body (refresh/logout). The OAuth redirect flow gains a `client=mobile` variant that ends in a single-use exchange code delivered via `https://<origin>/m/callback?code=…` (Universal/App Link) instead of a Strict cookie. This is phase P0-a of `docs/superpowers/specs/2026-07-06-mobile-app-design.md`; Sign in with Apple, account deletion, and push are separate follow-on plans (P0-b/c/d).

**Tech Stack:** NestJS 10 + nestjs-zod (zod is the single source for validation AND OpenAPI), native Mongo driver, vitest + supertest + mongodb-memory-server e2e harness (`apps/server/test/app.ts`).

## Global Constraints

- Server runs via **swc, never tsx/esbuild** (`yarn workspace @trm/server dev`); tests via `yarn workspace @trm/server test --run <file-substring>`.
- Request validation + OpenAPI schemas come from **one zod source** (`auth.schemas.ts` + `apiSchema()`); never hand-write OpenAPI bodies.
- Injectable config classes (`AuthConfig` pattern: `@Optional()` overrides, tests bind `new X(overrides)` via `.useValue`) — never read `process.env` inside tests.
- Web behavior must not change: every existing cookie-based flow keeps its current semantics; `apps/server/test/auth.e2e.spec.ts` must keep passing untouched.
- Never `git add -A` / `git add .` — stage only files this plan touches (other agents may share the worktree).
- New endpoints follow the existing controller idiom: zod DTO classes, `@ApiOperation`/`@ApiBody`/`@ApiResponse` with `apiSchema(...)`.
- Mobile client header is exactly **`x-trm-client: mobile`**; mobile deep-link path is exactly **`/m/callback`** — these strings are load-bearing across future plans (P1 app skeleton).

---

### Task 1: Sliding guest TTL (extend on refresh)

**Files:**
- Modify: `apps/server/src/auth/user.repo.ts` (after `attachOauthToGuest`, ~line 153)
- Modify: `apps/server/src/auth/auth.service.ts:80-85` (`refresh`)
- Create: `apps/server/test/auth-mobile.e2e.spec.ts`

**Interfaces:**
- Consumes: `UserRepo.col` (users collection), `env.guestTtlMs`.
- Produces: `UserRepo.extendGuestExpiry(userId: string): Promise<void>` — no-op for non-guests. Called by `AuthService.refresh` after a successful rotation.

- [x] **Step 1: Write the failing test**

Create `apps/server/test/auth-mobile.e2e.spec.ts` (this file grows through Tasks 1–5):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, refreshCookie, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-mobile' });
}, 60_000);
afterAll(() => t.close());

describe('guest TTL: refresh slides guestExpiresAt forward', () => {
  it('extends an almost-expired guest on refresh', async () => {
    const guest = await request(server()).post('/api/v1/auth/guest').send({}).expect(201);
    const id = guest.body.user.id as string;

    // Backdate the TTL anchor to nearly-now, as if the guest were 30 days old.
    await t.db
      .collection('users')
      .updateOne({ _id: id as never }, { $set: { guestExpiresAt: new Date(Date.now() + 1000) } });

    await request(server())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie(guest))
      .expect(200);

    const doc = await t.db.collection('users').findOne({ _id: id as never });
    const twentyDays = 20 * 24 * 60 * 60 * 1000;
    expect((doc?.guestExpiresAt as Date).getTime()).toBeGreaterThan(Date.now() + twentyDays);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: FAIL — `guestExpiresAt` is still `now + 1000ms` (refresh never touches it today).

- [x] **Step 3: Implement**

In `apps/server/src/auth/user.repo.ts`, add after `attachOauthToGuest`:

```ts
  /**
   * Sliding guest lifetime: re-anchor the TTL on activity so an ACTIVE guest is never
   * hard-deleted mid-use (mobile installs live on guest accounts for a long time).
   * No-op for registered accounts (the filter excludes them).
   */
  async extendGuestExpiry(userId: string): Promise<void> {
    await this.col.updateOne(
      { _id: userId, isGuest: true },
      { $set: { guestExpiresAt: new Date(Date.now() + env.guestTtlMs) } },
    );
  }
```

In `apps/server/src/auth/auth.service.ts`, inside `refresh(...)`, after the `disabledAt` check and before the `return`:

```ts
    if (user.isGuest) await this.users.extendGuestExpiry(user._id);
```

- [x] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/server/src/auth/user.repo.ts apps/server/src/auth/auth.service.ts apps/server/test/auth-mobile.e2e.spec.ts
git commit -m "feat(server): slide guest TTL forward on refresh"
```

---

### Task 2: Mobile token issuance + body-token refresh/logout

**Files:**
- Modify: `apps/server/src/auth/auth.schemas.ts`
- Modify: `apps/server/src/auth/auth.controller.ts`
- Test: `apps/server/test/auth-mobile.e2e.spec.ts` (extend)

**Interfaces:**
- Consumes: `AuthService.refresh/logout` (already token-in, token-out), `IssuedAuth.refreshToken`.
- Produces: header contract `x-trm-client: mobile` → issuance responses include `refreshToken`, no `Set-Cookie`. `POST /api/v1/auth/refresh` with body `{refreshToken}` → `{accessToken, refreshToken}`, no cookie. `POST /api/v1/auth/logout` with body `{refreshToken}` revokes it. `GoogleCredentialSchema` gains optional `refreshToken` (mobile guest-upgrade carry).

- [x] **Step 1: Write the failing tests**

Append to `apps/server/test/auth-mobile.e2e.spec.ts`:

```ts
describe('mobile issuance: x-trm-client header returns the refresh token in the body', () => {
  it('guest with the mobile header gets refreshToken and NO cookie', async () => {
    const res = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({ displayName: 'Pocket' })
      .expect(201);
    expect(res.body.refreshToken).toBeTruthy();
    expect(refreshCookie(res)).toBe('');
  });

  it('web guest (no header) keeps today\'s behavior: cookie set, no body token', async () => {
    const res = await request(server()).post('/api/v1/auth/guest').send({}).expect(201);
    expect(res.body.refreshToken).toBeUndefined();
    expect(refreshCookie(res)).toContain('trm_refresh=');
  });
});

describe('mobile refresh/logout: token in the body', () => {
  it('rotates via body token and burns the family on reuse', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({})
      .expect(201);
    const t1 = guest.body.refreshToken as string;

    const r1 = await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: t1 })
      .expect(200);
    expect(r1.body.accessToken).toBeTruthy();
    expect(r1.body.refreshToken).toBeTruthy();
    expect(r1.body.refreshToken).not.toBe(t1);
    expect(refreshCookie(r1)).toBe(''); // body transport never sets the cookie

    // Reusing the rotated-away token = theft → family burned, latest token dies too.
    await request(server()).post('/api/v1/auth/refresh').send({ refreshToken: t1 }).expect(401);
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('logout accepts the body token', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({})
      .expect(201);
    await request(server())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(204);
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(401);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: FAIL — `refreshToken` undefined in bodies; body-token refresh 401s (`no refresh token`).

- [x] **Step 3: Implement the schemas**

In `apps/server/src/auth/auth.schemas.ts`:

```ts
export const RefreshSchema = z.object({ refreshToken: z.string().min(1).optional() });
export const LogoutSchema = z.object({ refreshToken: z.string().min(1).optional() });
```

Change `GoogleCredentialSchema` to carry an optional guest token (mobile in-place upgrade, Task 2 wiring below):

```ts
export const GoogleCredentialSchema = z.object({
  credential: z.string().min(1),
  /** Mobile only: the app's refresh token, so a signed-in guest upgrades in place. */
  refreshToken: z.string().min(1).optional(),
});
```

Add DTO classes next to the existing ones:

```ts
export class RefreshDto extends createZodDto(RefreshSchema) {}
export class LogoutDto extends createZodDto(LogoutSchema) {}
```

Extend the result schemas (optional field — web responses are unchanged):

```ts
export const AuthResultSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  refreshToken: z.string().optional(), // present iff the client sent x-trm-client: mobile
});
export const AccessResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(), // present iff the refresh token arrived in the body
});
```

- [x] **Step 4: Implement the controller changes**

In `apps/server/src/auth/auth.controller.ts`:

Add to the imports from `./auth.schemas`: `RefreshDto, LogoutDto, RefreshSchema, LogoutSchema`.

Replace the `finish` helper (and add `isMobile`):

```ts
  /** Native clients cannot use SameSite cookies; they self-identify with this header. */
  private isMobile(req: Request): boolean {
    return req.headers['x-trm-client'] === 'mobile';
  }

  private finish(
    req: Request,
    res: Response,
    issued: IssuedAuth,
  ): { user: IssuedAuth['user']; accessToken: string; refreshToken?: string } {
    if (this.isMobile(req)) {
      // Token-in-body transport: the refresh token goes to Keychain/Keystore, never a cookie.
      return { user: issued.user, accessToken: issued.accessToken, refreshToken: issued.refreshToken };
    }
    this.setRefresh(res, issued.refreshToken);
    return { user: issued.user, accessToken: issued.accessToken };
  }
```

Every `finish(res, …)` call site becomes `finish(req, res, …)`; add `@Req() req: Request` to `guest`, `register`, `upgrade`, and `login` (already present on `googleCredential`). Example (`guest`):

```ts
  async guest(
    @Body() body: GuestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.authConfig.guest) throw new ForbiddenException('guest sign-in disabled');
    return this.finish(
      req,
      res,
      await this.auth.guest(body.displayName ?? randomGuestName(), body.locale ?? 'zh-Hant'),
    );
  }
```

`googleCredential` also honors the body carry token for the guest-upgrade path:

```ts
    const guestUserId = await this.oauth.guestIdFromRefresh(
      body.refreshToken ?? req.cookies?.[REFRESH_COOKIE],
    );
    return this.finish(req, res, await this.oauth.handleCredential(body.credential, guestUserId));
```

Replace `refresh` and `logout`:

```ts
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token (cookie for web, body for mobile)' })
  @ApiBody({ schema: apiSchema(RefreshSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AccessResultSchema) })
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const bodyToken = body.refreshToken;
    const result = await this.auth.refresh(bodyToken ?? req.cookies?.[REFRESH_COOKIE]);
    if (bodyToken) {
      // Body-in → body-out; never downgrade a mobile session onto a cookie.
      return { accessToken: result.accessToken, refreshToken: result.refreshToken };
    }
    this.setRefresh(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the refresh family (cookie or body token) and clear the cookie' })
  @ApiBody({ schema: apiSchema(LogoutSchema) })
  async logout(
    @Body() body: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken ?? req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  }
```

- [x] **Step 5: Run the new tests AND the untouched web suite**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: PASS
Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS (web cookie semantics unchanged)

- [x] **Step 6: Commit**

```bash
git add apps/server/src/auth/auth.schemas.ts apps/server/src/auth/auth.controller.ts apps/server/test/auth-mobile.e2e.spec.ts
git commit -m "feat(server): token-in-body auth transport for mobile clients"
```

---

### Task 3: Google credential verification accepts mobile audiences

**Files:**
- Modify: `apps/server/src/config/env.ts` (OAuth section, after `discordClientSecret`)
- Modify: `apps/server/src/auth/auth-config.ts`
- Modify: `apps/server/src/auth/google-id-token.verifier.ts`
- Modify: `apps/server/src/auth/oauth.service.ts:180` (`handleCredential`)
- Modify: `apps/server/test/app.ts` (`FakeGoogleIdTokenVerifier`)
- Test: `apps/server/test/auth-mobile.e2e.spec.ts` (extend)

**Interfaces:**
- Consumes: `AuthConfigOverrides` test-override pattern.
- Produces: env `GOOGLE_MOBILE_CLIENT_IDS` (comma list) → `AuthConfig.googleAudiences(): string[]` (`[webClientId, ...mobileIds]`, `[]` when Google unconfigured); `GoogleIdTokenVerifier.verify(idToken, audience: string | string[])`; `FakeGoogleIdTokenVerifier.lastAudience` for assertions.

- [x] **Step 1: Write the failing test**

Append to `apps/server/test/auth-mobile.e2e.spec.ts` (new top-level describe; boots its own app with providers enabled — mirror the import list with `FakeGoogleIdTokenVerifier, OAUTH_TEST_CONFIG`):

```ts
import { FakeGoogleIdTokenVerifier, FakeOauthHttp, OAUTH_TEST_CONFIG } from './app';

describe('google credential: mobile audiences', () => {
  let o: TestApp;
  let verifier: FakeGoogleIdTokenVerifier;
  const oServer = () => o.app.getHttpServer();

  beforeAll(async () => {
    verifier = new FakeGoogleIdTokenVerifier();
    o = await createTestApp({
      mongod: sharedMongod,
      dbName: 'trm-test-mobile-aud',
      authConfig: { ...OAUTH_TEST_CONFIG, googleMobileClientIds: ['ios-id', 'android-id'] },
      googleVerifier: verifier,
    });
  }, 60_000);
  afterAll(() => o.close());

  it('passes web + mobile client ids to the verifier', async () => {
    verifier.profile = {
      sub: 'g-m-1',
      email: 'mobileaud@example.com',
      emailVerified: true,
      displayName: 'MobileAud',
      avatarUrl: null,
    };
    verifier.fail = false;
    await request(oServer())
      .post('/api/v1/auth/oauth/google/credential')
      .set('x-trm-client', 'mobile')
      .send({ credential: 'fake-jwt' })
      .expect(200);
    expect(verifier.lastAudience).toEqual(['gid', 'ios-id', 'android-id']);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: FAIL — TS compile error: `googleMobileClientIds` not in `AuthConfigOverrides` / `lastAudience` not on the fake.

- [x] **Step 3: Implement**

`apps/server/src/config/env.ts`, after `discordClientSecret`:

```ts
  /** Extra Google OAuth client ids (iOS/Android apps) accepted as ID-token audiences. */
  googleMobileClientIds: (process.env.GOOGLE_MOBILE_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
```

`apps/server/src/auth/auth-config.ts` — add to `AuthConfigOverrides`:

```ts
  googleMobileClientIds?: string[];
```

Add a readonly field + method on `AuthConfig` (field initialized in the constructor):

```ts
  readonly googleMobileClientIds: string[];
```

```ts
    this.googleMobileClientIds = overrides?.googleMobileClientIds ?? env.googleMobileClientIds;
```

```ts
  /** Every audience a Google ID token may carry: web client id + native app client ids. */
  googleAudiences(): string[] {
    const g = this.providers.google;
    return g ? [g.clientId, ...this.googleMobileClientIds] : [];
  }
```

`apps/server/src/auth/google-id-token.verifier.ts` — widen the interface and pass through (google-auth-library accepts `string | string[]`):

```ts
export interface GoogleIdTokenVerifier {
  verify(idToken: string, audience: string | string[]): Promise<OauthProfile>;
}
```

```ts
  async verify(idToken: string, audience: string | string[]): Promise<OauthProfile> {
    const ticket = await this.client.verifyIdToken({ idToken, audience });
```

`apps/server/src/auth/oauth.service.ts`, in `handleCredential`, replace the verify call:

```ts
      profile = await this.verifier.verify(idToken, this.authConfig.googleAudiences());
```

`apps/server/test/app.ts` — record the audience on the fake:

```ts
export class FakeGoogleIdTokenVerifier implements GoogleIdTokenVerifier {
  profile: OauthProfile | null = null;
  fail = false;
  lastAudience: string | string[] | null = null;
  async verify(_idToken: string, audience: string | string[]): Promise<OauthProfile> {
    this.lastAudience = audience;
    if (this.fail || !this.profile) throw new Error('fake google verify failed');
    return this.profile;
  }
}
```

- [x] **Step 4: Run tests**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: PASS
Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS (web credential flow now passes `['gid']` — same acceptance set as before)

- [x] **Step 5: Commit**

```bash
git add apps/server/src/config/env.ts apps/server/src/auth/auth-config.ts apps/server/src/auth/google-id-token.verifier.ts apps/server/src/auth/oauth.service.ts apps/server/test/app.ts apps/server/test/auth-mobile.e2e.spec.ts
git commit -m "feat(server): accept iOS/Android Google client ids as credential audiences"
```

---

### Task 4: Mobile version gate endpoint

**Files:**
- Modify: `apps/server/src/config/env.ts` (top section, after `botMoveDelayMs`)
- Modify: `apps/server/src/health/health.controller.ts`
- Test: `apps/server/test/auth-mobile.e2e.spec.ts` (extend)

**Interfaces:**
- Produces: `GET /version/mobile` → `{ minBuild: number; commitHash: string }` (env `MOBILE_MIN_BUILD`, default 0 = never forces an update). The mobile app (P1 plan) blocks boot when its build number < `minBuild`.

- [x] **Step 1: Write the failing test**

Append to `apps/server/test/auth-mobile.e2e.spec.ts`:

```ts
describe('mobile version gate', () => {
  it('serves minBuild (default 0) + commitHash', async () => {
    const res = await request(server()).get('/version/mobile').expect(200);
    expect(res.body).toEqual({ minBuild: 0, commitHash: expect.any(String) });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: FAIL — 404.

- [x] **Step 3: Implement**

`apps/server/src/config/env.ts` after `botMoveDelayMs`:

```ts
  /** Force-update floor for the mobile app: builds below this are told to update. 0 = off. */
  mobileMinBuild: Number(process.env.MOBILE_MIN_BUILD ?? 0),
```

`apps/server/src/health/health.controller.ts`, after the `version()` method:

```ts
  @Get('version/mobile')
  @ApiOperation({ summary: 'Mobile forced-update gate: minimum accepted app build' })
  versionMobile(): { minBuild: number; commitHash: string } {
    return { minBuild: env.mobileMinBuild, commitHash: env.gitCommit };
  }
```

- [x] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/server/src/config/env.ts apps/server/src/health/health.controller.ts apps/server/test/auth-mobile.e2e.spec.ts
git commit -m "feat(server): mobile forced-update version gate endpoint"
```

---

### Task 5: Mobile OAuth handoff (one-time exchange code + carry code)

**Files:**
- Create: `apps/server/src/auth/mobile-code.repo.ts`
- Modify: `apps/server/src/auth/auth.types.ts` (`OauthStatePayload`)
- Modify: `apps/server/src/auth/auth-config.ts` (`mobileCallback`)
- Modify: `apps/server/src/auth/oauth.service.ts` (`buildAuthorize`, `handleCallback`, `CallbackResult`, new `guestIdFromCarryCode`)
- Modify: `apps/server/src/auth/auth.controller.ts` (start/callback + two new endpoints)
- Modify: `apps/server/src/auth/auth.schemas.ts`
- Modify: `apps/server/src/auth/auth.module.ts` (register `MobileCodeRepo`)
- Test: `apps/server/test/auth-mobile.e2e.spec.ts` (extend)

**Interfaces:**
- Consumes: `AuthService.issueFor(user: UserDoc)`, `UserRepo.findById`, `TokenService.signOauthState`, Task 2's `finish`-style token-in-body result shape.
- Produces:
  - `MobileCodeRepo.mint(kind: 'exchange' | 'carry', userId: string, ttlMs: number): Promise<string>`
  - `MobileCodeRepo.redeem(kind: 'exchange' | 'carry', code: string | undefined): Promise<string | null>` (single-use, deletes on read)
  - `GET /api/v1/auth/oauth/:provider/start?client=mobile[&carry=CODE]`
  - callback redirect `${redirectBase}/m/callback?code=…` (or `?error=…`)
  - `POST /api/v1/auth/mobile/carry` (Bearer) → `{ code }`
  - `POST /api/v1/auth/mobile/exchange` `{ code }` → `{ user, accessToken, refreshToken }`
  - `OauthService.handleCallback` now returns the resolved `UserDoc` (`{ ok: true; user; redirect; mobile }`) — the **controller** issues the session (web) or mints the exchange code (mobile).

- [x] **Step 1: Write the failing tests**

Append to `apps/server/test/auth-mobile.e2e.spec.ts` (reuses the `FakeOauthHttp` import added in Task 3):

```ts
describe('mobile OAuth handoff: one-time code round trip', () => {
  let o: TestApp;
  let fake: FakeOauthHttp;
  const oServer = () => o.app.getHttpServer();

  const pickCookie = (res: { headers: Record<string, unknown> }, name: string): string => {
    const sc = res.headers['set-cookie'] as string[] | undefined;
    const c = sc?.find((s) => s.startsWith(`${name}=`));
    return c ? (c.split(';')[0] ?? '') : '';
  };
  const locationOf = (res: { headers: Record<string, unknown> }): string =>
    String(res.headers.location ?? '');

  beforeAll(async () => {
    fake = new FakeOauthHttp();
    o = await createTestApp({
      mongod: sharedMongod,
      dbName: 'trm-test-mobile-oauth',
      authConfig: OAUTH_TEST_CONFIG,
      oauthHttp: fake,
    });
  }, 60_000);
  afterAll(() => o.close());

  it('start(client=mobile) → callback → /m/callback?code → exchange upgrades the carried guest', async () => {
    // Mobile guest signs in and mints a carry code over Bearer.
    const guest = await request(oServer())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({ displayName: 'MobileGuest' })
      .expect(201);
    const carry = await request(oServer())
      .post('/api/v1/auth/mobile/carry')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(201);
    expect(carry.body.code).toBeTruthy();

    // System browser: start → provider → callback.
    fake.profile = {
      sub: 'g-mob-1',
      email: 'mobileguest@example.com',
      emailVerified: true,
      displayName: 'MobileGuest',
      avatarUrl: null,
    };
    fake.fail = false;
    const start = await request(oServer())
      .get('/api/v1/auth/oauth/google/start')
      .query({ client: 'mobile', carry: carry.body.code })
      .expect(302);
    const state = new URL(locationOf(start)).searchParams.get('state');
    const cb = await request(oServer())
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', pickCookie(start, 'trm_oauth'))
      .expect(302);

    // Mobile landing: deep-link URL with a one-time code, and NO refresh cookie.
    const loc = new URL(locationOf(cb));
    expect(loc.pathname).toBe('/m/callback');
    const code = loc.searchParams.get('code');
    expect(code).toBeTruthy();
    expect(refreshCookie(cb)).toBe('');

    // Exchange: tokens in the body, guest upgraded in place (same id).
    const ex = await request(oServer())
      .post('/api/v1/auth/mobile/exchange')
      .send({ code })
      .expect(200);
    expect(ex.body.user.id).toBe(guest.body.user.id);
    expect(ex.body.user.isGuest).toBe(false);
    expect(ex.body.user.email).toBe('mobileguest@example.com');
    expect(ex.body.accessToken).toBeTruthy();
    expect(ex.body.refreshToken).toBeTruthy();

    // The code is single-use.
    await request(oServer()).post('/api/v1/auth/mobile/exchange').send({ code }).expect(401);

    // The returned refresh token works on the body transport.
    await request(oServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: ex.body.refreshToken })
      .expect(200);
  });

  it('mobile error paths land on /m/callback with an error param', async () => {
    fake.profile = {
      sub: 'g-mob-2',
      email: 'unverified-mobile@example.com',
      emailVerified: false,
      displayName: 'Nope',
      avatarUrl: null,
    };
    const start = await request(oServer())
      .get('/api/v1/auth/oauth/google/start')
      .query({ client: 'mobile' })
      .expect(302);
    const state = new URL(locationOf(start)).searchParams.get('state');
    const cb = await request(oServer())
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', pickCookie(start, 'trm_oauth'))
      .expect(302);
    const loc = new URL(locationOf(cb));
    expect(loc.pathname).toBe('/m/callback');
    expect(loc.searchParams.get('error')).toBe('email_unverified');
  });

  it('web flow still sets the cookie and redirects to /login/callback', async () => {
    fake.profile = {
      sub: 'g-web-1',
      email: 'stillweb@example.com',
      emailVerified: true,
      displayName: 'StillWeb',
      avatarUrl: null,
    };
    const start = await request(oServer()).get('/api/v1/auth/oauth/google/start').expect(302);
    const state = new URL(locationOf(start)).searchParams.get('state');
    const cb = await request(oServer())
      .get('/api/v1/auth/oauth/google/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', pickCookie(start, 'trm_oauth'))
      .expect(302);
    expect(locationOf(cb)).toContain('/login/callback');
    expect(refreshCookie(cb)).toContain('trm_refresh=');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: FAIL — `POST /auth/mobile/carry` 404.

- [x] **Step 3: Create `apps/server/src/auth/mobile-code.repo.ts`**

```ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';

/**
 * Single-use, short-lived opaque codes for the mobile auth flows:
 *  - 'exchange': minted by the OAuth callback, redeemed by POST /auth/mobile/exchange
 *    for a fresh session (the deep-link-safe replacement for the Strict refresh cookie).
 *  - 'carry': minted over Bearer before the system browser opens, so the OAuth `start`
 *    can identify the app's signed-in guest (no cookie crosses that boundary).
 * Redemption is a findOneAndDelete — a code can never be used twice, even in a race.
 */
export type MobileCodeKind = 'exchange' | 'carry';

interface MobileCodeDoc {
  _id: string; // the code itself (256-bit, base64url)
  kind: MobileCodeKind;
  userId: string;
  expiresAt: Date; // TTL
}

@Injectable()
export class MobileCodeRepo implements OnModuleInit {
  private readonly col: Collection<MobileCodeDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<MobileCodeDoc>('mobileAuthCodes');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }

  async mint(kind: MobileCodeKind, userId: string, ttlMs: number): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    await this.col.insertOne({
      _id: code,
      kind,
      userId,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return code;
  }

  /** Single-use redeem: returns the userId or null (wrong kind, expired, or already used). */
  async redeem(kind: MobileCodeKind, code: string | undefined): Promise<string | null> {
    if (!code) return null;
    const doc = await this.col.findOneAndDelete({
      _id: code,
      kind,
      expiresAt: { $gt: new Date() },
    });
    return doc?.userId ?? null;
  }
}
```

- [x] **Step 4: Thread the `mobile` flag through state, authorize, and callback**

`apps/server/src/auth/auth.types.ts` — add to `OauthStatePayload`:

```ts
  /** Set when the flow started with ?client=mobile: the callback hands off via /m/callback. */
  mobile?: boolean;
```

`apps/server/src/auth/auth-config.ts` — add beside `webCallback`:

```ts
  /** Mobile deep-link landing (Universal/App Link): carries a one-time exchange code or error. */
  mobileCallback(params: { code?: string; error?: string }): string {
    const q = new URLSearchParams();
    if (params.code) q.set('code', params.code);
    if (params.error) q.set('error', params.error);
    const qs = q.toString();
    return `${this.redirectBase}/m/callback${qs ? `?${qs}` : ''}`;
  }
```

`apps/server/src/auth/oauth.service.ts`:

1. `buildAuthorize` gains a fourth parameter and forwards it into the state:

```ts
  buildAuthorize(
    provider: OauthProvider,
    redirect: string | undefined,
    guestUserId?: string,
    mobile = false,
  ): { url: string; nonce: string } | null {
```

```ts
    const state = this.tokens.signOauthState({
      provider,
      redirect: safeRedirect(redirect),
      nonce,
      codeVerifier,
      ...(guestUserId ? { guestUserId } : {}),
      ...(mobile ? { mobile: true } : {}),
    });
```

2. New guest-carry resolver beside `guestIdFromRefresh`. Add the import and constructor entry:

```ts
import { MobileCodeRepo } from './mobile-code.repo';
```

```ts
    private readonly mobileCodes: MobileCodeRepo,
```

```ts
  /** Mobile flavor of guestIdFromRefresh: the app minted a single-use carry code over Bearer. */
  async guestIdFromCarryCode(code: string | undefined): Promise<string | undefined> {
    const userId = await this.mobileCodes.redeem('carry', code);
    if (!userId) return undefined;
    const user = await this.users.findById(userId);
    return user?.isGuest ? user._id : undefined;
  }
```

3. `CallbackResult` now returns the resolved user — the controller decides the transport:

```ts
export type CallbackResult =
  | { ok: true; user: UserDoc; redirect: string; mobile: boolean }
  | { ok: false; error: string; redirect: string; mobile?: boolean };
```

In `handleCallback`: after `const redirect = safeRedirect(payload.redirect);` add `const mobile = !!payload.mobile;`, then add `, mobile` to each of the four post-parse failure returns — the nonce-mismatch `invalid_state`, `provider_disabled`, `exchange_failed`, and `email_unverified` returns (the two failures ABOVE the state parse — missing code/state and bad-signature `invalid_state` — keep no `mobile`: the flag is unknowable there and they fall back to the web callback) — and replace the success tail:

```ts
    try {
      const user = await this.resolveAccount(
        provider,
        profile.email,
        profile.sub,
        profile.displayName,
        profile.avatarUrl,
        payload.guestUserId,
      );
      return { ok: true, user, redirect, mobile };
    } catch {
      return { ok: false, error: 'server_error', redirect, mobile };
    }
```

- [x] **Step 5: Controller wiring + the two new endpoints**

`apps/server/src/auth/auth.schemas.ts`:

```ts
export const MobileExchangeSchema = z.object({ code: z.string().min(1) });
export class MobileExchangeDto extends createZodDto(MobileExchangeSchema) {}
export const MobileCarryResultSchema = z.object({ code: z.string() });
export const MobileAuthResultSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
});
```

`apps/server/src/auth/auth.controller.ts` — extend the constructor to inject `MobileCodeRepo` and `UserRepo`:

```ts
import { MobileCodeRepo } from './mobile-code.repo';
import { UserRepo } from './user.repo';
```

```ts
  constructor(
    private readonly auth: AuthService,
    private readonly authConfig: AuthConfig,
    private readonly oauth: OauthService,
    private readonly mobileCodes: MobileCodeRepo,
    private readonly users: UserRepo,
  ) {}
```

Import the new DTOs/schemas from `./auth.schemas` (`MobileExchangeDto, MobileExchangeSchema, MobileCarryResultSchema, MobileAuthResultSchema`) plus `UnauthorizedException` from `@nestjs/common`, and add a module-scope constant:

```ts
/** Exchange codes only need to survive the 302 → app-open → POST hop. */
const EXCHANGE_CODE_TTL_MS = 60_000;
```

`oauthStart` — accept the mobile params and pick the right guest resolver:

```ts
  async oauthStart(
    @Param('provider') providerParam: string,
    @Query('redirect') redirect: string | undefined,
    @Query('client') client: string | undefined,
    @Query('carry') carry: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = asProvider(providerParam);
    const mobile = client === 'mobile';
    if (!provider || !this.authConfig.provider(provider)) {
      res.redirect(
        mobile
          ? this.authConfig.mobileCallback({ error: 'provider_disabled' })
          : this.authConfig.webCallback({ error: 'provider_disabled' }),
      );
      return;
    }
    const guestUserId = mobile
      ? await this.oauth.guestIdFromCarryCode(carry)
      : await this.oauth.guestIdFromRefresh(req.cookies?.[REFRESH_COOKIE]);
    const built = this.oauth.buildAuthorize(provider, redirect, guestUserId, mobile);
    // … (nonce cookie + redirect lines unchanged)
```

`oauthCallback` — split issuance by transport:

```ts
    const result = await this.oauth.handleCallback(
      provider,
      code,
      state,
      req.cookies?.[OAUTH_NONCE_COOKIE],
    );
    if (!result.ok) {
      res.redirect(
        result.mobile
          ? this.authConfig.mobileCallback({ error: result.error })
          : this.authConfig.webCallback({ redirect: result.redirect, error: result.error }),
      );
      return;
    }
    if (result.mobile) {
      // No cookie can survive the system-browser → app hop; hand off a single-use code instead.
      const exchangeCode = await this.mobileCodes.mint(
        'exchange',
        result.user._id,
        EXCHANGE_CODE_TTL_MS,
      );
      res.redirect(this.authConfig.mobileCallback({ code: exchangeCode }));
      return;
    }
    try {
      const issued = await this.auth.issueFor(result.user);
      this.setRefresh(res, issued.refreshToken);
      res.redirect(this.authConfig.webCallback({ redirect: result.redirect }));
    } catch {
      // e.g. account disabled between resolution and issuance — never 500 a top-level navigation.
      res.redirect(this.authConfig.webCallback({ redirect: result.redirect, error: 'server_error' }));
    }
```

New endpoints (place after `googleCredential`):

```ts
  @Post('mobile/carry')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Mint a single-use carry code so mobile OAuth can upgrade this guest' })
  @ApiResponse({ status: 201, schema: apiSchema(MobileCarryResultSchema) })
  async mobileCarry(@CurrentUser() user: AuthUser) {
    return { code: await this.mobileCodes.mint('carry', user.userId, env.oauthStateTtlMs) };
  }

  @Post('mobile/exchange')
  @HttpCode(200)
  @ApiOperation({ summary: 'Redeem a one-time OAuth code for a mobile token pair' })
  @ApiBody({ schema: apiSchema(MobileExchangeSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(MobileAuthResultSchema) })
  async mobileExchange(@Body() body: MobileExchangeDto) {
    const userId = await this.mobileCodes.redeem('exchange', body.code);
    if (!userId) throw new UnauthorizedException('invalid or expired code');
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('user not found');
    const issued = await this.auth.issueFor(user);
    return { user: issued.user, accessToken: issued.accessToken, refreshToken: issued.refreshToken };
  }
```

`apps/server/src/auth/auth.module.ts` — import `MobileCodeRepo` and add it to `providers`.

- [x] **Step 6: Run tests**

Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: PASS (all three new describe blocks)
Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS (web OAuth semantics unchanged — the third test in the new block double-covers this)

- [x] **Step 7: Commit**

```bash
git add apps/server/src/auth/mobile-code.repo.ts apps/server/src/auth/auth.types.ts apps/server/src/auth/auth-config.ts apps/server/src/auth/oauth.service.ts apps/server/src/auth/auth.controller.ts apps/server/src/auth/auth.schemas.ts apps/server/src/auth/auth.module.ts apps/server/test/auth-mobile.e2e.spec.ts
git commit -m "feat(server): mobile OAuth handoff via single-use exchange codes"
```

---

### Task 6: Deep-link verification files (/.well-known)

**Files:**
- Create: `apps/server/src/config/mobile-links.config.ts`
- Create: `apps/server/src/health/well-known.controller.ts`
- Modify: `apps/server/src/config/env.ts` (after `googleMobileClientIds`)
- Modify: `apps/server/src/app.module.ts` (controller + provider)
- Modify: `apps/server/test/app.ts` (override hook)
- Create: `apps/server/test/well-known.e2e.spec.ts`

**Interfaces:**
- Produces: `GET /.well-known/apple-app-site-association` and `GET /.well-known/assetlinks.json`, both 404 until configured. `MobileLinksConfig` (injectable, `@Optional()` overrides — same pattern as `AuthConfig`): `{ appleAppId: string; androidPackageName: string; androidCertSha256: string[] }`. Env: `APPLE_APP_ID` (`TEAMID.bundle.id`), `ANDROID_PACKAGE_NAME`, `ANDROID_CERT_SHA256` (comma list of colon-hex fingerprints).

- [x] **Step 1: Write the failing tests**

Create `apps/server/test/well-known.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createTestApp, type TestApp } from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

describe('/.well-known: unconfigured → 404', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ mongod: sharedMongod, dbName: 'trm-test-wk-off' });
  }, 60_000);
  afterAll(() => t.close());

  it('404s both files when no app ids are set', async () => {
    await request(t.app.getHttpServer()).get('/.well-known/apple-app-site-association').expect(404);
    await request(t.app.getHttpServer()).get('/.well-known/assetlinks.json').expect(404);
  });
});

describe('/.well-known: configured payloads', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({
      mongod: sharedMongod,
      dbName: 'trm-test-wk-on',
      mobileLinks: {
        appleAppId: 'ABCDE12345.tw.trmission.app',
        androidPackageName: 'tw.trmission.app',
        androidCertSha256: ['AA:BB:CC'],
      },
    });
  }, 60_000);
  afterAll(() => t.close());

  it('serves the AASA with the /m/callback pattern', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/.well-known/apple-app-site-association')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    expect(res.body).toEqual({
      applinks: {
        details: [
          { appIDs: ['ABCDE12345.tw.trmission.app'], components: [{ '/': '/m/callback*' }] },
        ],
      },
    });
  });

  it('serves assetlinks.json with the package + fingerprints', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/.well-known/assetlinks.json')
      .expect(200);
    expect(res.body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'tw.trmission.app',
          sha256_cert_fingerprints: ['AA:BB:CC'],
        },
      },
    ]);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/server test --run well-known`
Expected: FAIL — TS error: `mobileLinks` not a `TestAppOptions` field.

- [x] **Step 3: Implement**

`apps/server/src/config/env.ts`, after `googleMobileClientIds`:

```ts
  /** Universal/App Link verification (served under /.well-known when set). */
  appleAppId: process.env.APPLE_APP_ID ?? '', // "TEAMID.bundle.id"
  androidPackageName: process.env.ANDROID_PACKAGE_NAME ?? '',
  androidCertSha256: (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
```

Create `apps/server/src/config/mobile-links.config.ts`:

```ts
import { Injectable, Optional } from '@nestjs/common';
import { env } from './env';

export interface MobileLinksConfigOverrides {
  appleAppId?: string;
  androidPackageName?: string;
  androidCertSha256?: string[];
}

/**
 * App-identity constants for Universal Links (iOS) / App Links (Android) verification.
 * Same test pattern as AuthConfig: Nest builds it from env; specs bind
 * `new MobileLinksConfig(overrides)` via `.useValue(...)`.
 */
@Injectable()
export class MobileLinksConfig {
  readonly appleAppId: string;
  readonly androidPackageName: string;
  readonly androidCertSha256: string[];

  constructor(@Optional() overrides?: MobileLinksConfigOverrides) {
    this.appleAppId = overrides?.appleAppId ?? env.appleAppId;
    this.androidPackageName = overrides?.androidPackageName ?? env.androidPackageName;
    this.androidCertSha256 = overrides?.androidCertSha256 ?? env.androidCertSha256;
  }
}
```

Create `apps/server/src/health/well-known.controller.ts`:

```ts
import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { MobileLinksConfig } from '../config/mobile-links.config';

/**
 * Deep-link verification files the OS fetches from the web origin. 404 until the app
 * identities are configured, so a deploy without mobile apps serves nothing misleading.
 * The `/m/callback*` pattern must match AuthConfig.mobileCallback.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('.well-known')
export class WellKnownController {
  constructor(private readonly links: MobileLinksConfig) {}

  @Get('apple-app-site-association')
  appleAppSiteAssociation() {
    if (!this.links.appleAppId) throw new NotFoundException();
    return {
      applinks: {
        details: [{ appIDs: [this.links.appleAppId], components: [{ '/': '/m/callback*' }] }],
      },
    };
  }

  @Get('assetlinks.json')
  assetLinks() {
    if (!this.links.androidPackageName || this.links.androidCertSha256.length === 0) {
      throw new NotFoundException();
    }
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: this.links.androidPackageName,
          sha256_cert_fingerprints: this.links.androidCertSha256,
        },
      },
    ];
  }
}
```

`apps/server/src/app.module.ts` — add the imports:

```ts
import { WellKnownController } from './health/well-known.controller';
import { MobileLinksConfig } from './config/mobile-links.config';
```

then change the module arrays:

```ts
  controllers: [HealthController, DocsController, WellKnownController],
  providers: [
    OpenApiHolder,
    MobileLinksConfig,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
```

`apps/server/test/app.ts` — add to `TestAppOptions`:

```ts
  /** Override MobileLinksConfig (deep-link verification files) without touching env. */
  mobileLinks?: MobileLinksConfigOverrides;
```

with the import and the builder branch (beside the `dashboardConfig` one):

```ts
import { MobileLinksConfig, type MobileLinksConfigOverrides } from '../src/config/mobile-links.config';
```

```ts
  if (opts.mobileLinks)
    builder = builder
      .overrideProvider(MobileLinksConfig)
      .useValue(new MobileLinksConfig(opts.mobileLinks));
```

- [x] **Step 4: Run tests**

Run: `yarn workspace @trm/server test --run well-known`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/server/src/config/env.ts apps/server/src/config/mobile-links.config.ts apps/server/src/health/well-known.controller.ts apps/server/src/app.module.ts apps/server/test/app.ts apps/server/test/well-known.e2e.spec.ts
git commit -m "feat(server): serve Universal/App Link verification files"
```

---

### Task 7: Full-suite regression + docs

**Files:**
- Modify: `CLAUDE.md` (root — server env vars section)
- Modify: `apps/server/CLAUDE.md` (auth section)

- [x] **Step 1: Run the full validation gates**

Run: `yarn workspace @trm/server test`
Expected: all specs PASS (including every pre-existing auth/lobby/dashboard spec).
Run: `yarn typecheck`
Expected: clean.
Run: `yarn lint`
Expected: clean.

- [x] **Step 2: Document the new env vars**

In root `CLAUDE.md`, "Server env vars" section, append after the `GUEST_TTL_MS` mention:

```markdown
Mobile clients: `MOBILE_MIN_BUILD` (forced-update floor served at `GET /version/mobile`),
`GOOGLE_MOBILE_CLIENT_IDS` (comma list — extra ID-token audiences for the iOS/Android
Google Sign-In apps), `APPLE_APP_ID` + `ANDROID_PACKAGE_NAME` + `ANDROID_CERT_SHA256`
(serve `/.well-known/apple-app-site-association` + `assetlinks.json` for the `/m/callback`
deep link; unset ⇒ 404). A client sending `x-trm-client: mobile` receives its refresh
token in the response body (Keychain/Keystore storage) instead of the Strict cookie, and
`POST /auth/refresh`/`logout` accept `{refreshToken}` in the body. Guest TTLs slide
forward on refresh.
```

In `apps/server/CLAUDE.md`, at the end of the `src/auth/` bullet in "Auth, lobby, bots", append:

```markdown
  **Mobile transport** (no SameSite cookie can reach a native app): `x-trm-client: mobile`
  on any issuance route returns the refresh token in the body; `/auth/refresh` + `/auth/logout`
  take `{refreshToken}` in the body (body-in → body-out, never a cookie). The OAuth redirect
  flow with `?client=mobile` ends at `/m/callback?code=<single-use exchange code>` (minted in
  `mobile-code.repo.ts`, redeemed by `POST /auth/mobile/exchange` for a fresh token pair);
  a signed-in guest is carried via `POST /auth/mobile/carry` → `?carry=` (the cookie-free
  analogue of the refresh-cookie peek). Google ID tokens verify against
  `AuthConfig.googleAudiences()` (web + `GOOGLE_MOBILE_CLIENT_IDS`).
```

- [x] **Step 3: Commit**

```bash
git add CLAUDE.md apps/server/CLAUDE.md
git commit -m "docs: document the mobile auth transport + env vars"
```
