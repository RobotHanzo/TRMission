# Google One Tap + rendered sign-in button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google One Tap and Google's own rendered "Sign in with Google" button to `LoginScreen`, authenticating via a signed ID-token credential verified server-side, while keeping the existing authorization-code redirect flow wired up as a fallback.

**Architecture:** A new `POST /api/v1/auth/oauth/google/credential` endpoint verifies the GSI ID token (via `google-auth-library`) and funnels the resulting profile through the exact same account-resolution logic (`OauthService.resolveAccount`) the redirect flow already uses. The frontend loads Google's GSI script on the login screen, renders Google's own button + fires One Tap, and POSTs the resulting credential to the new endpoint — falling back to today's redirect-based anchor button if the script fails to load.

**Tech Stack:** NestJS + zod (nestjs-zod) + MongoDB (server), React + Zustand + vitest (web), `google-auth-library` (new server dependency).

## Global Constraints

- The existing `GET /auth/oauth/google/start` + `/callback` redirect flow stays exactly as-is — it is the accepted fallback, not something to remove or refactor (spec non-goal).
- Discord's flow is untouched.
- `googleClientId` is not a secret (Google client IDs are meant to be embedded in public web pages) — only the client _secret_ stays server-only.
- Use `google-auth-library` only for `OAuth2Client.verifyIdToken` — do not hand-roll JWT/JWKS verification (approved in the spec: this is security-sensitive code not worth re-deriving, unlike the existing hand-rolled authorization-code exchange in `oauth.http.ts`, which has a code-exchange step to lean on that this flow does not).
- Follow the codebase's existing DI-seam-for-network-calls pattern (`OAUTH_HTTP` / `FakeOauthHttp`) for the new Google ID-token verifier, so e2e tests never call Google's real JWKS endpoint.
- Follow the existing zod-is-the-single-source pattern (`nestjs-zod`) for the new endpoint's request/response schemas — do not hand-write a separate OpenAPI schema.
- Git workflow (repo-wide rule): commit once each task's tests pass; stage only the files that task touched (never `git add -A`), since other sessions may have unrelated in-progress changes in this worktree.
- Server dev/test tooling stays on swc (`@swc-node/register`/`unplugin-swc`) — nothing in this plan touches that, but don't introduce tsx/esbuild-based tooling for the new files.

---

### Task 1: Expose `googleClientId` via `GET /auth/config`

**Files:**

- Modify: `apps/server/src/auth/auth-config.ts:100-111` (`publicConfig()`)
- Modify: `apps/server/src/auth/auth.schemas.ts:47-51` (`AuthConfigSchema`)
- Modify: `apps/web/src/net/rest.ts:30-34` (`AuthConfig` interface)
- Test: `apps/server/test/auth.e2e.spec.ts`

**Interfaces:**

- Produces: `AuthConfig.publicConfig()` return type gains `googleClientId?: string` — later tasks (Task 2, Task 5) read `config.googleClientId` to decide whether to attempt GSI at all.

- [ ] **Step 1: Write the failing e2e assertion**

In `apps/server/test/auth.e2e.spec.ts`, inside the existing `describe('auth: OAuth (Google + Discord, bound by email)', ...)` block (the one that does `o = await createTestApp({ authConfig: OAUTH_TEST_CONFIG, oauthHttp: fake })`), add a new test right after the existing `'advertises both providers via /config'` test:

```ts
it('exposes googleClientId alongside the boolean flag', async () => {
  const res = await request(oServer()).get('/api/v1/auth/config').expect(200);
  expect(res.body.googleClientId).toBe('gid');
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: FAIL — `expect(res.body.googleClientId).toBe('gid')` sees `undefined`.

- [ ] **Step 3: Add `googleClientId` to `AuthConfig.publicConfig()`**

In `apps/server/src/auth/auth-config.ts`, replace the `publicConfig` method:

```ts
  /** The UI hint sent to the web app so it renders only the available entry methods. */
  publicConfig(): {
    passwordLogin: boolean;
    guest: boolean;
    providers: { google: boolean; discord: boolean };
    googleClientId?: string;
  } {
    return {
      passwordLogin: this.passwordLogin,
      guest: this.guest,
      providers: { google: !!this.providers.google, discord: !!this.providers.discord },
      ...(this.providers.google ? { googleClientId: this.providers.google.clientId } : {}),
    };
  }
```

- [ ] **Step 4: Add the field to `AuthConfigSchema`**

In `apps/server/src/auth/auth.schemas.ts`, replace:

```ts
export const AuthConfigSchema = z.object({
  passwordLogin: z.boolean(),
  guest: z.boolean(),
  providers: z.object({ google: z.boolean(), discord: z.boolean() }),
});
```

with:

```ts
export const AuthConfigSchema = z.object({
  passwordLogin: z.boolean(),
  guest: z.boolean(),
  providers: z.object({ google: z.boolean(), discord: z.boolean() }),
  googleClientId: z.string().optional(),
});
```

- [ ] **Step 5: Add the field to the web `AuthConfig` type**

In `apps/web/src/net/rest.ts`, replace:

```ts
export interface AuthConfig {
  passwordLogin: boolean;
  guest: boolean;
  providers: { google: boolean; discord: boolean };
}
```

with:

```ts
export interface AuthConfig {
  passwordLogin: boolean;
  guest: boolean;
  providers: { google: boolean; discord: boolean };
  googleClientId?: string;
}
```

- [ ] **Step 6: Run the e2e suite, confirm it passes**

Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS (all cases in the file, including the new one).

- [ ] **Step 7: Typecheck both touched workspaces**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/web typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/auth/auth-config.ts apps/server/src/auth/auth.schemas.ts apps/web/src/net/rest.ts apps/server/test/auth.e2e.spec.ts
git commit -m "feat(auth): expose googleClientId via /auth/config"
```

---

### Task 2: Google credential sign-in endpoint (`POST /auth/oauth/google/credential`)

**Files:**

- Create: `apps/server/src/auth/google-id-token.verifier.ts`
- Modify: `apps/server/src/auth/oauth.service.ts`
- Modify: `apps/server/src/auth/auth.controller.ts`
- Modify: `apps/server/src/auth/auth.schemas.ts`
- Modify: `apps/server/src/auth/auth.module.ts`
- Modify: `apps/server/test/app.ts`
- Modify: `apps/server/package.json` (new dependency)
- Test: `apps/server/test/auth.e2e.spec.ts`

**Interfaces:**

- Consumes: `OauthProfile` (`apps/server/src/auth/oauth.http.ts`) — `{ sub, email, emailVerified, displayName, avatarUrl }`; `OauthService`'s private `resolveAccount(provider: OauthProvider, email: string, sub: string, rawName: string, avatarUrl: string | null, guestUserId: string | undefined): Promise<UserDoc>`; `AuthService.issueFor(user: UserDoc): Promise<IssuedAuth>`; `OauthService.guestIdFromRefresh(refreshToken: string | undefined): Promise<string | undefined>`; `AuthConfig.provider('google')` (`apps/server/src/auth/auth-config.ts`).
- Produces: `GOOGLE_ID_TOKEN_VERIFIER` DI token + `GoogleIdTokenVerifier` interface (`{ verify(idToken: string, audience: string): Promise<OauthProfile> }`) — a test double `FakeGoogleIdTokenVerifier` in `test/app.ts` with the same shape as `FakeOauthHttp` (public `profile`/`fail` fields). `OauthService.handleCredential(idToken: string, guestUserId: string | undefined): Promise<IssuedAuth>`.

- [ ] **Step 1: Add the `google-auth-library` dependency**

Run: `yarn workspace @trm/server add google-auth-library`
Expected: `apps/server/package.json`'s `dependencies` gains a `google-auth-library` entry (yarn resolves the version — do not hand-pick one).

- [ ] **Step 2: Create the verifier seam**

Create `apps/server/src/auth/google-id-token.verifier.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import type { OauthProfile } from './oauth.http';

/** Verifies a Google Identity Services credential (ID token JWT) and normalizes its payload. */
export interface GoogleIdTokenVerifier {
  verify(idToken: string, audience: string): Promise<OauthProfile>;
}

export const GOOGLE_ID_TOKEN_VERIFIER = Symbol('GOOGLE_ID_TOKEN_VERIFIER');

/** Google sometimes serializes `email_verified` as the string "true". */
const truthy = (v: unknown): boolean => v === true || v === 'true';

/**
 * Real implementation: delegates JWKS fetch/cache/rotation and signature/audience/issuer/expiry
 * checks to google-auth-library. Unlike `oauth.http.ts`'s authorization-code exchange, there is no
 * code-exchange step to lean on here — the JWT signature is the only proof of identity, so this is
 * not worth hand-rolling.
 */
@Injectable()
export class GoogleAuthLibraryVerifier implements GoogleIdTokenVerifier {
  private readonly client = new OAuth2Client();

  async verify(idToken: string, audience: string): Promise<OauthProfile> {
    const ticket = await this.client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload) throw new Error('google id token carried no payload');
    return {
      sub: payload.sub,
      email: payload.email ?? null,
      emailVerified: truthy(payload.email_verified),
      displayName: payload.name ?? '',
      avatarUrl: payload.picture ?? null,
    };
  }
}
```

- [ ] **Step 3: Add the test double + wiring to `test/app.ts`**

In `apps/server/test/app.ts`, add the import alongside the existing `OAUTH_HTTP` import:

```ts
import {
  GOOGLE_ID_TOKEN_VERIFIER,
  type GoogleIdTokenVerifier,
} from '../src/auth/google-id-token.verifier';
```

Add a field to `TestAppOptions` (right after `oauthHttp`):

```ts
  /** Stub Google ID-token verification (One Tap / rendered-button credential flow). */
  googleVerifier?: GoogleIdTokenVerifier;
```

In `createTestApp`, add the override alongside the existing `oauthHttp` override:

```ts
if (opts.googleVerifier)
  builder = builder.overrideProvider(GOOGLE_ID_TOKEN_VERIFIER).useValue(opts.googleVerifier);
```

Add the fake class alongside `FakeOauthHttp`:

```ts
/** A controllable stand-in for Google ID-token verification: set `profile`, or `fail` to throw. */
export class FakeGoogleIdTokenVerifier implements GoogleIdTokenVerifier {
  profile: OauthProfile | null = null;
  fail = false;
  async verify(): Promise<OauthProfile> {
    if (this.fail || !this.profile) throw new Error('fake google verify failed');
    return this.profile;
  }
}
```

- [ ] **Step 4: Add the request schema**

In `apps/server/src/auth/auth.schemas.ts`, add right after `LoginSchema`/`LoginDto`:

```ts
export const GoogleCredentialSchema = z.object({ credential: z.string().min(1) });
```

and add the DTO class alongside the others:

```ts
export class GoogleCredentialDto extends createZodDto(GoogleCredentialSchema) {}
```

- [ ] **Step 5: Write the failing e2e tests**

In `apps/server/test/auth.e2e.spec.ts`, add a new `describe` block at the end of the file (after the existing `describe('auth: OAuth (Google + Discord, bound by email)', ...)` block):

```ts
describe('auth: Google credential sign-in (One Tap / rendered button)', () => {
  let o: TestApp;
  let verifier: FakeGoogleIdTokenVerifier;
  const oServer = () => o.app.getHttpServer();

  beforeAll(async () => {
    verifier = new FakeGoogleIdTokenVerifier();
    o = await createTestApp({ authConfig: OAUTH_TEST_CONFIG, googleVerifier: verifier });
  }, 60_000);
  afterAll(() => o.close());

  it('creates an account from a verified credential', async () => {
    verifier.profile = {
      sub: 'g-cred-1',
      email: 'crednew@example.com',
      emailVerified: true,
      displayName: 'CredNew',
      avatarUrl: 'https://example.com/a/crednew.png',
    };
    verifier.fail = false;
    const res = await request(oServer())
      .post('/api/v1/auth/oauth/google/credential')
      .send({ credential: 'fake-jwt' })
      .expect(200);
    expect(res.body.user.email).toBe('crednew@example.com');
    expect(res.body.user.isGuest).toBe(false);
    expect(res.body.accessToken).toBeTruthy();
    expect(refreshCookie(res)).toContain('trm_refresh=');
  });

  it('auto-links a credential sign-in to an existing account with the same verified email', async () => {
    const reg = await request(oServer())
      .post('/api/v1/auth/register')
      .send({ email: 'credlink@example.com', password: 'password123', displayName: 'CredLinker' })
      .expect(201);
    verifier.profile = {
      sub: 'g-cred-2',
      email: 'credlink@example.com',
      emailVerified: true,
      displayName: 'CredLinker-Google',
      avatarUrl: null,
    };
    const res = await request(oServer())
      .post('/api/v1/auth/oauth/google/credential')
      .send({ credential: 'fake-jwt' })
      .expect(200);
    expect(res.body.user.id).toBe(reg.body.user.id);
  });

  it('upgrades a signed-in guest in place', async () => {
    const guest = await request(oServer())
      .post('/api/v1/auth/guest')
      .send({ displayName: 'CredGuest' })
      .expect(201);
    verifier.profile = {
      sub: 'g-cred-3',
      email: 'credguest@example.com',
      emailVerified: true,
      displayName: 'CredGuest',
      avatarUrl: null,
    };
    const res = await request(oServer())
      .post('/api/v1/auth/oauth/google/credential')
      .set('Cookie', refreshCookie(guest))
      .send({ credential: 'fake-jwt' })
      .expect(200);
    expect(res.body.user.id).toBe(guest.body.user.id);
    expect(res.body.user.isGuest).toBe(false);
    expect(res.body.user.email).toBe('credguest@example.com');
  });

  it('rejects an unverified email with 401 (no session issued)', async () => {
    verifier.profile = {
      sub: 'g-cred-4',
      email: 'credunverified@example.com',
      emailVerified: false,
      displayName: 'CredUnverified',
      avatarUrl: null,
    };
    const res = await request(oServer())
      .post('/api/v1/auth/oauth/google/credential')
      .send({ credential: 'fake-jwt' })
      .expect(401);
    expect(refreshCookie(res)).toBe('');
  });

  it('rejects a token the verifier cannot validate with 401', async () => {
    verifier.fail = true;
    await request(oServer())
      .post('/api/v1/auth/oauth/google/credential')
      .send({ credential: 'garbage' })
      .expect(401);
  });

  it('validates the request body via the zod pipe', async () => {
    await request(oServer()).post('/api/v1/auth/oauth/google/credential').send({}).expect(400);
  });

  it('rejects with 403 when the provider is not configured', async () => {
    const d = await createTestApp({ googleVerifier: new FakeGoogleIdTokenVerifier() });
    await request(d.app.getHttpServer())
      .post('/api/v1/auth/oauth/google/credential')
      .send({ credential: 'fake-jwt' })
      .expect(403);
    await d.close();
  });
});
```

Also add `FakeGoogleIdTokenVerifier` to the existing import block at the top of the file:

```ts
import {
  createTestApp,
  refreshCookie,
  FakeOauthHttp,
  FakeGoogleIdTokenVerifier,
  OAUTH_TEST_CONFIG,
  type TestApp,
} from './app';
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: FAIL — every new test 404s (route doesn't exist yet).

- [ ] **Step 7: Add `handleCredential` to `OauthService`**

In `apps/server/src/auth/oauth.service.ts`, change the import line:

```ts
import { Inject, Injectable } from '@nestjs/common';
```

to:

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
```

Add the verifier import, right after the `OAUTH_HTTP` import:

```ts
import { GOOGLE_ID_TOKEN_VERIFIER, type GoogleIdTokenVerifier } from './google-id-token.verifier';
```

Add the constructor parameter, right after the existing `@Inject(OAUTH_HTTP)` one:

```ts
    @Inject(OAUTH_HTTP) private readonly http: OauthHttp,
    @Inject(GOOGLE_ID_TOKEN_VERIFIER) private readonly verifier: GoogleIdTokenVerifier,
  ) {}
```

(this replaces the current `) {}` line that ends the constructor).

Add the new public method, right after `handleCallback` (before the `private async resolveAccount` method):

```ts
  /**
   * Verify a Google Identity Services credential (One Tap / rendered-button ID token) and resolve
   * the account through the same logic `handleCallback` uses. Unlike that redirect flow, failures
   * here are ordinary REST errors (this is a JSON call, not a top-level navigation that must always
   * land somewhere) — no redirect/error-query-param plumbing needed.
   */
  async handleCredential(
    idToken: string,
    guestUserId: string | undefined,
  ): Promise<IssuedAuth> {
    const cfg = this.authConfig.provider('google');
    if (!cfg) throw new UnauthorizedException('provider_disabled');

    let profile;
    try {
      profile = await this.verifier.verify(idToken, cfg.clientId);
    } catch {
      throw new UnauthorizedException('invalid_credential');
    }
    if (!profile.email || !profile.emailVerified || !profile.sub) {
      throw new UnauthorizedException('email_unverified');
    }

    const user = await this.resolveAccount(
      'google',
      profile.email,
      profile.sub,
      profile.displayName,
      profile.avatarUrl,
      guestUserId,
    );
    return this.auth.issueFor(user);
  }
```

- [ ] **Step 8: Add the controller route**

In `apps/server/src/auth/auth.controller.ts`, add `GoogleCredentialDto` and `GoogleCredentialSchema` to the existing import from `./auth.schemas`:

```ts
import {
  GuestDto,
  RegisterDto,
  UpgradeDto,
  LoginDto,
  GoogleCredentialDto,
  UpdatePreferencesDto,
  GuestSchema,
  RegisterSchema,
  UpgradeSchema,
  LoginSchema,
  GoogleCredentialSchema,
  PreferencesSchema,
  AuthResultSchema,
  AccessResultSchema,
  AuthConfigSchema,
  PublicUserSchema,
} from './auth.schemas';
```

Add the new route right after `login` and before `refresh`:

```ts
  @Post('oauth/google/credential')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in via a Google One Tap / rendered-button ID token' })
  @ApiBody({ schema: apiSchema(GoogleCredentialSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AuthResultSchema) })
  async googleCredential(
    @Body() body: GoogleCredentialDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.authConfig.provider('google')) throw new ForbiddenException('google sign-in disabled');
    const guestUserId = await this.oauth.guestIdFromRefresh(req.cookies?.[REFRESH_COOKIE]);
    return this.finish(res, await this.oauth.handleCredential(body.credential, guestUserId));
  }
```

- [ ] **Step 9: Wire the real verifier into `auth.module.ts`**

In `apps/server/src/auth/auth.module.ts`, add the import:

```ts
import { GOOGLE_ID_TOKEN_VERIFIER, GoogleAuthLibraryVerifier } from './google-id-token.verifier';
```

Add the provider binding, right after the existing `OAUTH_HTTP` binding:

```ts
    { provide: OAUTH_HTTP, useClass: FetchOauthHttp },
    { provide: GOOGLE_ID_TOKEN_VERIFIER, useClass: GoogleAuthLibraryVerifier },
```

- [ ] **Step 10: Run the e2e suite, confirm it passes**

Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS (all cases, old and new).

- [ ] **Step 11: Typecheck**

Run: `yarn workspace @trm/server typecheck`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add apps/server/src/auth/google-id-token.verifier.ts apps/server/src/auth/oauth.service.ts apps/server/src/auth/auth.controller.ts apps/server/src/auth/auth.schemas.ts apps/server/src/auth/auth.module.ts apps/server/test/app.ts apps/server/test/auth.e2e.spec.ts apps/server/package.json yarn.lock
git commit -m "feat(auth): add Google credential sign-in endpoint for One Tap / rendered button"
```

---

### Task 3: Web API client + session store action

**Files:**

- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/store/session.ts`
- Test: `apps/web/src/store/session.test.ts`

**Interfaces:**

- Consumes: `AuthResult` (`apps/web/src/net/rest.ts`) — `{ user: PublicUser; accessToken: string }`.
- Produces: `api.googleCredential(credential: string): Promise<AuthResult>`; `useSession`'s `loginWithGoogleCredential(credential: string): Promise<void>` — Task 5's `LoginScreen` calls this from the GSI callback.

- [ ] **Step 1: Add the API client method**

In `apps/web/src/net/rest.ts`, add right after the existing `login` entry in the `api` object:

```ts
  login: (email: string, password: string) =>
    req<AuthResult>('POST', '/auth/login', { email, password }).then(captureToken),
  googleCredential: (credential: string) =>
    req<AuthResult>('POST', '/auth/oauth/google/credential', { credential }).then(captureToken),
```

- [ ] **Step 2: Write the failing store test**

In `apps/web/src/store/session.test.ts`, add a new `describe` block at the end of the file:

```ts
describe('session store: loginWithGoogleCredential', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applies the returned user on success', async () => {
    vi.spyOn(api, 'googleCredential').mockResolvedValue({
      user: { ...user },
      accessToken: 'tok',
    });
    useSession.setState({ user: null, accessToken: null, error: null });

    await useSession.getState().loginWithGoogleCredential('fake-jwt');

    expect(useSession.getState().user).toEqual(user);
    expect(useSession.getState().error).toBeNull();
  });

  it('sets an error message on failure', async () => {
    vi.spyOn(api, 'googleCredential').mockRejectedValue(new Error('invalid_credential'));
    useSession.setState({ user: null, accessToken: null, error: null });

    await useSession.getState().loginWithGoogleCredential('bad-jwt');

    expect(useSession.getState().user).toBeNull();
    expect(useSession.getState().error).toBe('invalid_credential');
  });
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `yarn workspace @trm/web test --run session.test`
Expected: FAIL — `useSession.getState().loginWithGoogleCredential` is not a function.

- [ ] **Step 4: Add the store action**

In `apps/web/src/store/session.ts`, add the method to the `SessionState` interface, right after `login`:

```ts
  login(email: string, password: string): Promise<void>;
  loginWithGoogleCredential(credential: string): Promise<void>;
```

Add the implementation, right after the `login:` entry in the returned object:

```ts
    login: (email, password) => run(() => api.login(email.trim(), password)),
    loginWithGoogleCredential: (credential) => run(() => api.googleCredential(credential)),
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `yarn workspace @trm/web test --run session.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/store/session.ts apps/web/src/store/session.test.ts
git commit -m "feat(web): add loginWithGoogleCredential session action"
```

---

### Task 4: GSI script loader (`net/google.ts`)

**Files:**

- Create: `apps/web/src/net/google.ts`
- Test: `apps/web/src/net/google.test.ts`

**Interfaces:**

- Produces: `GoogleAccountsId` interface (`{ initialize(config): void; prompt(): void; renderButton(parent, options): void }`); `loadGoogleIdentityServices(): Promise<GoogleAccountsId>`; `googleLocale(locale: string): string` — Task 5's `LoginScreen` imports all three.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/net/google.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('net/google: loadGoogleIdentityServices', () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '';
    delete (window as unknown as { google?: unknown }).google;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with google.accounts.id once the script loads', async () => {
    const { loadGoogleIdentityServices } = await import('./google');
    const fakeAccounts = { initialize: vi.fn(), prompt: vi.fn(), renderButton: vi.fn() };

    const promise = loadGoogleIdentityServices();
    const script = document.head.querySelector('script') as HTMLScriptElement;
    expect(script.src).toBe('https://accounts.google.com/gsi/client');
    (window as unknown as { google: unknown }).google = { accounts: { id: fakeAccounts } };
    script.onload?.(new Event('load'));

    await expect(promise).resolves.toBe(fakeAccounts);
  });

  it('rejects when the script fails to load', async () => {
    const { loadGoogleIdentityServices } = await import('./google');
    const promise = loadGoogleIdentityServices();
    const script = document.head.querySelector('script') as HTMLScriptElement;
    script.onerror?.(new Event('error'));
    await expect(promise).rejects.toThrow();
  });

  it('rejects if the script neither loads nor errors within the timeout', async () => {
    const { loadGoogleIdentityServices } = await import('./google');
    const promise = loadGoogleIdentityServices();
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it('injects the script only once across concurrent calls', async () => {
    const { loadGoogleIdentityServices } = await import('./google');
    const fakeAccounts = { initialize: vi.fn(), prompt: vi.fn(), renderButton: vi.fn() };
    const p1 = loadGoogleIdentityServices();
    const p2 = loadGoogleIdentityServices();
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    const script = document.head.querySelector('script') as HTMLScriptElement;
    (window as unknown as { google: unknown }).google = { accounts: { id: fakeAccounts } };
    script.onload?.(new Event('load'));
    await expect(p1).resolves.toBe(fakeAccounts);
    await expect(p2).resolves.toBe(fakeAccounts);
  });
});

describe('net/google: googleLocale', () => {
  it('maps the app locale to a GSI locale code', async () => {
    const { googleLocale } = await import('./google');
    expect(googleLocale('zh-Hant')).toBe('zh-TW');
    expect(googleLocale('en')).toBe('en');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `yarn workspace @trm/web test --run google.test`
Expected: FAIL — cannot find module `./google`.

- [ ] **Step 3: Implement the loader**

Create `apps/web/src/net/google.ts`:

```ts
// Loads Google Identity Services (GSI) once per page and exposes the narrow `accounts.id` surface
// LoginScreen needs for One Tap + the rendered sign-in button.

interface GoogleCredentialResponse {
  credential: string;
}
interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  use_fedcm_for_prompt?: boolean;
}
interface GoogleButtonOptions {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  locale?: string;
}
export interface GoogleAccountsId {
  initialize(config: GoogleIdConfiguration): void;
  prompt(): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 3000;

let loadPromise: Promise<GoogleAccountsId> | null = null;

/**
 * Injects the GSI script once (module-level singleton — safe to call from multiple mounts) and
 * resolves with `window.google.accounts.id`. Rejects on a load error or a ~3s timeout (some
 * ad-blockers/extensions silently no-op the request instead of firing `onerror`), so callers can
 * always fall back to the legacy redirect button rather than hang.
 */
export function loadGoogleIdentityServices(): Promise<GoogleAccountsId> {
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      const timer = setTimeout(() => {
        reject(new Error('google identity services load timed out'));
      }, LOAD_TIMEOUT_MS);
      script.onload = () => {
        clearTimeout(timer);
        if (window.google?.accounts?.id) resolve(window.google.accounts.id);
        else reject(new Error('google identity services script loaded without window.google'));
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('google identity services script failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return loadPromise;
}

/** Maps the app's locale to a GSI `data-locale`/`locale` option value. */
export const googleLocale = (locale: string): string => (locale === 'zh-Hant' ? 'zh-TW' : 'en');
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `yarn workspace @trm/web test --run google.test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/net/google.ts apps/web/src/net/google.test.ts
git commit -m "feat(web): add Google Identity Services script loader"
```

---

### Task 5: Wire `LoginScreen` to GSI (One Tap + rendered button + fallback)

**Files:**

- Modify: `apps/web/src/screens/LoginScreen.tsx`
- Modify: `apps/web/src/styles/app.css`
- Test: `apps/web/src/screens/LoginScreen.test.tsx`

**Interfaces:**

- Consumes: `loadGoogleIdentityServices`, `googleLocale`, `GoogleAccountsId` (Task 4, `../net/google`); `loginWithGoogleCredential` (Task 3, `useSession`); `config.googleClientId` (Task 1, `AuthConfig`).

- [ ] **Step 1: Write the failing component tests**

In `apps/web/src/screens/LoginScreen.test.tsx`, add the mock at the top of the file (after the existing imports):

```ts
import { loadGoogleIdentityServices } from '../net/google';

vi.mock('../net/google', () => ({
  loadGoogleIdentityServices: vi.fn(),
  googleLocale: () => 'en',
}));
```

Add two new tests at the end of the `describe('LoginScreen', ...)` block:

```tsx
it("renders Google's rendered button and fires One Tap once GSI loads", async () => {
  window.history.replaceState(null, '', '/login');
  const accounts = { initialize: vi.fn(), prompt: vi.fn(), renderButton: vi.fn() };
  vi.mocked(loadGoogleIdentityServices).mockResolvedValue(accounts);
  vi.spyOn(api, 'config').mockResolvedValue({
    passwordLogin: false,
    guest: false,
    providers: { google: true, discord: false },
    googleClientId: 'test-client-id',
  });
  render(<LoginScreen />);

  await waitFor(() => expect(accounts.prompt).toHaveBeenCalled());
  expect(accounts.initialize).toHaveBeenCalledWith(
    expect.objectContaining({ client_id: 'test-client-id' }),
  );
  expect(accounts.renderButton).toHaveBeenCalled();
  expect(screen.getByTestId('google-signin-button')).toBeVisible();
  expect(screen.queryByRole('link', { name: '使用 Google 繼續' })).not.toBeInTheDocument();
});

it('falls back to the legacy redirect button when GSI fails to load', async () => {
  window.history.replaceState(null, '', '/login');
  vi.mocked(loadGoogleIdentityServices).mockRejectedValue(new Error('blocked'));
  vi.spyOn(api, 'config').mockResolvedValue({
    passwordLogin: false,
    guest: false,
    providers: { google: true, discord: false },
    googleClientId: 'test-client-id',
  });
  render(<LoginScreen />);

  const link = await screen.findByRole('link', { name: '使用 Google 繼續' });
  expect(link).toHaveAttribute('href', '/api/v1/auth/oauth/google/start?redirect=%2F');
  expect(screen.getByTestId('google-signin-button')).not.toBeVisible();
});
```

Update the `@testing-library/react` import at the top of the file to include `waitFor`:

```ts
import { render, screen, waitFor } from '@testing-library/react';
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `yarn workspace @trm/web test --run LoginScreen`
Expected: FAIL — `getByTestId('google-signin-button')` finds nothing (element doesn't exist yet); the 4 pre-existing tests in the file still pass unchanged.

- [ ] **Step 3: Update `LoginScreen.tsx`**

Change the imports at the top of `apps/web/src/screens/LoginScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';
import { useUi, readRedirectParam } from '../store/ui';
import { api, type AuthConfig, type OauthProvider } from '../net/rest';
import { MapBackdrop } from '../components/MapBackdrop';
```

to:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';
import { useUi, readRedirectParam } from '../store/ui';
import { api, type AuthConfig, type OauthProvider } from '../net/rest';
import { MapBackdrop } from '../components/MapBackdrop';
import { loadGoogleIdentityServices, googleLocale } from '../net/google';
```

Change the `useTranslation()` destructure:

```tsx
const { t } = useTranslation();
```

to:

```tsx
const { t, i18n } = useTranslation();
```

Add the new session selector, right after the existing `register` selector:

```tsx
const register = useSession((s) => s.register);
const loginWithGoogleCredential = useSession((s) => s.loginWithGoogleCredential);
```

Add new state + a ref, right after the existing `password` state:

```tsx
const [password, setPassword] = useState('');
const [googleWidget, setGoogleWidget] = useState<'pending' | 'ready' | 'failed'>('pending');
const googleButtonRef = useRef<HTMLDivElement>(null);
```

Add a new effect, right after the existing config-loading `useEffect` (the one calling `api.config()`):

```tsx
// Load Google Identity Services once we know the client id, render its own button, and fire
// One Tap. Falls back to the legacy redirect anchor if the script can't load (blocked, offline).
useEffect(() => {
  const clientId = config?.googleClientId;
  if (!config?.providers.google || !clientId) return;
  let live = true;
  void loadGoogleIdentityServices()
    .then((accounts) => {
      if (!live) return;
      accounts.initialize({
        client_id: clientId,
        callback: (resp) => void loginWithGoogleCredential(resp.credential),
        use_fedcm_for_prompt: true,
      });
      if (googleButtonRef.current) {
        accounts.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          locale: googleLocale(i18n.language),
        });
      }
      accounts.prompt();
      setGoogleWidget('ready');
    })
    .catch(() => {
      if (live) setGoogleWidget('failed');
    });
  return () => {
    live = false;
  };
}, [config?.providers.google, config?.googleClientId, i18n.language, loginWithGoogleCredential]);
```

Replace the Google button block inside the `{hasOauth && (...)}` section:

```tsx
{
  config!.providers.google && (
    <a className="oauth-btn oauth-google" href={oauthStartUrl('google')}>
      <GoogleIcon />
      {t('continueWithGoogle')}
    </a>
  );
}
```

with:

```tsx
{
  config!.providers.google && (
    <>
      <div
        className="oauth-google-btn"
        data-testid="google-signin-button"
        ref={googleButtonRef}
        hidden={googleWidget !== 'ready'}
      />
      {googleWidget !== 'ready' && (
        <a className="oauth-btn oauth-google" href={oauthStartUrl('google')}>
          <GoogleIcon />
          {t('continueWithGoogle')}
        </a>
      )}
    </>
  );
}
```

- [ ] **Step 4: Add the container's CSS**

In `apps/web/src/styles/app.css`, add right after the `.oauth-google { ... }` rule:

```css
.oauth-google-btn {
  display: flex;
  justify-content: center;
}
```

- [ ] **Step 5: Run the full LoginScreen suite, confirm it passes**

Run: `yarn workspace @trm/web test --run LoginScreen`
Expected: PASS — all 6 tests (4 pre-existing + 2 new).

- [ ] **Step 6: Run the full web test suite (regression check)**

Run: `yarn workspace @trm/web test`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/screens/LoginScreen.tsx apps/web/src/screens/LoginScreen.test.tsx apps/web/src/styles/app.css
git commit -m "feat(web): render Google's One Tap + sign-in button on LoginScreen"
```

---

### Task 6: Update CLAUDE.md docs

**Files:**

- Modify: `apps/server/CLAUDE.md`
- Modify: `apps/web/CLAUDE.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update the OAuth bullet in `apps/server/CLAUDE.md`**

Find this exact block in the "Auth, lobby, bots" bullet list (note the mid-sentence line
wrapping — match it verbatim):

```
  the controller enforces the flags (`/auth/config` is only a UI hint). **OAuth** (`oauth.service` +
  `oauth.http`, hand-rolled with global `fetch`, no passport): authorization-code + PKCE; the profile
  comes from the provider's userinfo endpoint (no id_token signature work). Bound by **verified
```

Replace it with:

```
  the controller enforces the flags (`/auth/config` is only a UI hint). **OAuth** (`oauth.service` +
  `oauth.http`, hand-rolled with global `fetch`, no passport): authorization-code + PKCE; the profile
  comes from the provider's userinfo endpoint (no id_token signature work) for that redirect flow.
  Google also has a second entry point, `POST /auth/oauth/google/credential`, for a Google Identity
  Services (One Tap / rendered button) ID-token credential — the one place that *does* verify a JWT
  signature, via `google-auth-library` (`google-id-token.verifier.ts`, injected behind
  `GOOGLE_ID_TOKEN_VERIFIER` the same way `OAUTH_HTTP` is). Both entry points converge on the same
  `resolveAccount` logic. Bound by **verified
```

(the unchanged `email** → upgrade a live guest in place, ...` sentence continues right after — this
edit only inserts new sentences before it, it doesn't touch it).

- [ ] **Step 2: Update the Net layer section in `apps/web/CLAUDE.md`**

Find this line in the "Net layer" bullet list:

```
- `net/connection.ts` — bridges the socket to the game store.
```

Add a new line right after it:

```
- `net/google.ts` — loads Google Identity Services (GSI) once per page; `LoginScreen` uses it to
  render Google's own sign-in button + fire One Tap, falling back to the legacy redirect button if
  the script fails to load.
```

- [ ] **Step 3: Update the session bullet in `apps/web/CLAUDE.md`**

Find this line in the "State model: snapshot is authoritative" bullet list:

```
- `store/session.ts` — auth: `playAsGuest` / `login` / `register` / `upgrade` / `logout`, plus
```

Replace it with:

```
- `store/session.ts` — auth: `playAsGuest` / `login` / `register` / `upgrade` / `loginWithGoogleCredential` / `logout`, plus
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/CLAUDE.md apps/web/CLAUDE.md
git commit -m "docs: note the Google credential sign-in path in CLAUDE.md"
```
