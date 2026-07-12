# Sign in with Apple (P0-b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sign in with Apple as a credential-only auth provider: the iOS app (`expo-apple-authentication`) sends Apple's identity token to a new `POST /auth/oauth/apple/credential` route, the server verifies it against Apple's JWKS, and the account converges through the existing verified-email `resolveAccount` binding.

**Architecture:** Mirrors the Google credential route landed in P0-a (`docs/superpowers/plans/2026-07-06-mobile-auth-foundation.md`): an injectable verifier seam (`APPLE_ID_TOKEN_VERIFIER`, real impl on `jose`'s remote JWKS, fake in tests), audiences from `AuthConfig`, guest-upgrade carry via body `refreshToken`, and the `x-trm-client: mobile` token-in-body finish. Apple is **not** an `OauthProvider` (no redirect flow, no client secret); identity linking widens to a new `IdentityProvider` type (`'google' | 'discord' | 'apple'`). Apple 4.8 compliance is why this exists — see `docs/superpowers/specs/2026-07-06-mobile-app-design.md` §3.

**Tech Stack:** NestJS + nestjs-zod (zod single-source), `jose` (new dependency: remote JWKS + RS256 verify), vitest/supertest/mongodb-memory-server harness.

## Global Constraints

- Server runs via **swc, never tsx/esbuild**; tests via `yarn workspace @trm/server test --run <substring>`.
- zod is the single source for validation + OpenAPI (`auth.schemas.ts` + `apiSchema()`).
- Injectable-config test pattern: overrides via `new AuthConfig({...})` / `.useValue(...)`, never `process.env` in tests.
- **Apple is credential-only**: `OauthProvider` stays `'google' | 'discord'`; `GET /oauth/apple/start` must keep redirecting with `error=provider_disabled` (the `asProvider` guard already does this — do not extend it).
- Env is **`APPLE_CLIENT_IDS`** — comma list of raw bundle ids / Services IDs accepted as the identity token `aud` (e.g. `tw.trmission.app`). This is NOT the `TEAMID.bundle.id`-format `APPLE_APP_ID` used by `/.well-known`.
- **Hide My Email relay addresses count as verified emails.** Binding stays by email; a relay account will not cross-link with the user's real-email accounts on other providers — accepted per the design spec, documented in code.
- Apple's token-revocation duty for account deletion is **P0-c** scope: at deletion time the app re-runs SIWA for a fresh `authorizationCode` which the server exchanges and revokes. P0-b deliberately stores nothing extra.
- Web `/auth/config` consumers change shape (`providers.apple` added): the three exact-equality assertions in `apps/server/test/auth.e2e.spec.ts` are updated **in this plan** — that is the only permitted edit to that file.
- Never `git add -A`; stage only files this plan touches.

---

### Task 1: Advertise Apple in AuthConfig + `/auth/config`

**Files:**

- Modify: `apps/server/src/config/env.ts` (OAuth section, after `googleMobileClientIds`)
- Modify: `apps/server/src/auth/auth-config.ts`
- Modify: `apps/server/src/auth/auth.schemas.ts` (`AuthConfigSchema`)
- Modify: `apps/server/test/auth.e2e.spec.ts` (three provider-equality assertions ONLY)

**Interfaces:**

- Produces: env `APPLE_CLIENT_IDS` → `AuthConfig.appleClientIds: string[]`, `AuthConfig.appleEnabled: boolean` (getter, true iff non-empty), `AuthConfigOverrides.appleClientIds?: string[]`, and `publicConfig().providers.apple: boolean`. Task 2 consumes `appleClientIds` as the verification audiences.

- [x] **Step 1: Update the three existing `/auth/config` assertions to expect `apple: false` (failing tests)**

In `apps/server/test/auth.e2e.spec.ts`:

1. In `describe('auth: /config endpoint')` (~line 46):

```ts
expect(res.body).toEqual({
  passwordLogin: true,
  guest: true,
  providers: { google: false, discord: false, apple: false },
});
```

2. In `describe('auth: method gating ...')` → `'advertises everything off via /config'` (~line 202):

```ts
expect(res.body).toEqual({
  passwordLogin: false,
  guest: false,
  providers: { google: false, discord: false, apple: false },
});
```

3. In `describe('auth: OAuth (Google + Discord, bound by email)')` → `'advertises both providers via /config'` (~line 262):

```ts
expect(res.body.providers).toEqual({ google: true, discord: true, apple: false });
```

- [x] **Step 2: Run to verify they fail**

Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: FAIL — 3 assertions (`apple: false` missing from actual `providers`).

- [x] **Step 3: Implement**

`apps/server/src/config/env.ts`, after `googleMobileClientIds`:

```ts
  /** Sign in with Apple audiences: bundle ids / Services IDs accepted as identity-token `aud`. */
  appleClientIds: (process.env.APPLE_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
```

`apps/server/src/auth/auth-config.ts` — add to `AuthConfigOverrides`:

```ts
  appleClientIds?: string[];
```

Add the field (beside `googleMobileClientIds`), its constructor line, and a getter:

```ts
  readonly appleClientIds: string[];
```

```ts
this.appleClientIds = overrides?.appleClientIds ?? env.appleClientIds;
```

```ts
  /** Sign in with Apple is credential-only: enabled iff at least one audience is configured. */
  get appleEnabled(): boolean {
    return this.appleClientIds.length > 0;
  }
```

In `publicConfig()`, widen the return type's `providers` to `{ google: boolean; discord: boolean; apple: boolean }` and the value to:

```ts
      providers: {
        google: !!this.providers.google,
        discord: !!this.providers.discord,
        apple: this.appleEnabled,
      },
```

`apps/server/src/auth/auth.schemas.ts` — `AuthConfigSchema` providers:

```ts
  providers: z.object({ google: z.boolean(), discord: z.boolean(), apple: z.boolean() }),
```

- [x] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS (all 27+ tests).

- [x] **Step 5: Commit**

```bash
git add apps/server/src/config/env.ts apps/server/src/auth/auth-config.ts apps/server/src/auth/auth.schemas.ts apps/server/test/auth.e2e.spec.ts
git commit -m "feat(server): advertise Sign in with Apple via auth config"
```

---

### Task 2: Apple identity-token verification + credential route

**Files:**

- Create: `apps/server/src/auth/apple-id-token.verifier.ts`
- Create: `apps/server/test/auth-apple.e2e.spec.ts`
- Modify: `apps/server/package.json` (add `jose` via yarn)
- Modify: `apps/server/src/auth/auth-config.ts` (add `IdentityProvider` type)
- Modify: `apps/server/src/auth/user.repo.ts` (widen `oauth` field + three method signatures)
- Modify: `apps/server/src/auth/oauth.service.ts` (inject verifier, `handleAppleCredential`, widen `resolveAccount`)
- Modify: `apps/server/src/auth/auth.schemas.ts` (`AppleCredentialSchema`/Dto)
- Modify: `apps/server/src/auth/auth.controller.ts` (new route)
- Modify: `apps/server/src/auth/auth.module.ts` (verifier provider)
- Modify: `apps/server/test/app.ts` (`FakeAppleIdTokenVerifier` + `appleVerifier` option)

**Interfaces:**

- Consumes: `AuthConfig.appleClientIds`/`appleEnabled` (Task 1), P0-a's `finish` mobile-header contract and `guestIdFromRefresh(bodyToken ?? cookie)` pattern, `OauthProfile` shape from `oauth.http.ts`.
- Produces:
  - `type IdentityProvider = OauthProvider | 'apple'` (exported from `auth-config.ts`)
  - `interface AppleIdTokenVerifier { verify(idToken: string, audience: string[]): Promise<OauthProfile> }`, DI symbol `APPLE_ID_TOKEN_VERIFIER`, jose-backed `JoseAppleIdTokenVerifier`
  - `OauthService.handleAppleCredential(identityToken: string, fullName: string | undefined, guestUserId: string | undefined): Promise<IssuedAuth>`
  - `POST /api/v1/auth/oauth/apple/credential` body `{ identityToken, fullName?, refreshToken? }` → `AuthResultSchema` shape
  - `FakeAppleIdTokenVerifier` with `profile`, `fail`, `lastAudience` (same idiom as the Google fake)

- [x] **Step 1: Write the failing e2e spec**

Create `apps/server/test/auth-apple.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  createTestApp,
  refreshCookie,
  FakeAppleIdTokenVerifier,
  OAUTH_TEST_CONFIG,
  type TestApp,
} from './app';

let sharedMongod: MongoMemoryServer;
beforeAll(async () => {
  sharedMongod = await MongoMemoryServer.create();
}, 60_000);
afterAll(() => sharedMongod.stop());

let t: TestApp;
let verifier: FakeAppleIdTokenVerifier;
const server = () => t.app.getHttpServer();

beforeAll(async () => {
  verifier = new FakeAppleIdTokenVerifier();
  t = await createTestApp({
    mongod: sharedMongod,
    dbName: 'trm-test-apple',
    authConfig: { ...OAUTH_TEST_CONFIG, appleClientIds: ['tw.trmission.app'] },
    appleVerifier: verifier,
  });
}, 60_000);
afterAll(() => t.close());

describe('apple: /auth/config advertises the provider', () => {
  it('reports apple: true when audiences are configured', async () => {
    const res = await request(server()).get('/api/v1/auth/config').expect(200);
    expect(res.body.providers).toEqual({ google: true, discord: true, apple: true });
  });
});

describe('apple credential sign-in', () => {
  it('creates an account from a verified token (Hide My Email relay) and passes audiences', async () => {
    verifier.profile = {
      sub: 'apple-1',
      email: 'x7q9k2@privaterelay.appleid.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    verifier.fail = false;
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt', fullName: 'Apple Person' })
      .expect(200);
    expect(res.body.user.email).toBe('x7q9k2@privaterelay.appleid.com');
    expect(res.body.user.isGuest).toBe(false);
    expect(res.body.user.displayName).toBe('Apple Person');
    expect(res.body.accessToken).toBeTruthy();
    expect(refreshCookie(res)).toContain('trm_refresh='); // web transport by default
    expect(verifier.lastAudience).toEqual(['tw.trmission.app']);
  });

  it('falls back to the email local part when Apple provides no name', async () => {
    verifier.profile = {
      sub: 'apple-2',
      email: 'localpart@example.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt' })
      .expect(200);
    expect(res.body.user.displayName).toBe('localpart');
  });

  it('auto-links to an existing account with the same verified email', async () => {
    const reg = await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'applelink@example.com', password: 'password123', displayName: 'Linker' })
      .expect(201);
    verifier.profile = {
      sub: 'apple-3',
      email: 'applelink@example.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt' })
      .expect(200);
    expect(res.body.user.id).toBe(reg.body.user.id);
  });

  it('upgrades a mobile guest in place via the body refresh token', async () => {
    const guest = await request(server())
      .post('/api/v1/auth/guest')
      .set('x-trm-client', 'mobile')
      .send({ displayName: 'AppleGuest' })
      .expect(201);
    verifier.profile = {
      sub: 'apple-4',
      email: 'appleguest@example.com',
      emailVerified: true,
      displayName: '',
      avatarUrl: null,
    };
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .set('x-trm-client', 'mobile')
      .send({ identityToken: 'fake-apple-jwt', refreshToken: guest.body.refreshToken })
      .expect(200);
    expect(res.body.user.id).toBe(guest.body.user.id);
    expect(res.body.user.isGuest).toBe(false);
    expect(res.body.refreshToken).toBeTruthy(); // mobile finish: token in body...
    expect(refreshCookie(res)).toBe(''); // ...and no cookie
  });

  it('rejects an unverified email with 401 (no session issued)', async () => {
    verifier.profile = {
      sub: 'apple-5',
      email: 'unverified@example.com',
      emailVerified: false,
      displayName: '',
      avatarUrl: null,
    };
    const res = await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt' })
      .expect(401);
    expect(refreshCookie(res)).toBe('');
  });

  it('rejects a token the verifier cannot validate with 401', async () => {
    verifier.fail = true;
    await request(server())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'garbage' })
      .expect(401);
    verifier.fail = false;
  });

  it('validates the body via the zod pipe', async () => {
    await request(server()).post('/api/v1/auth/oauth/apple/credential').send({}).expect(400);
  });

  it('rejects with 403 when apple is not configured', async () => {
    const d = await createTestApp({
      mongod: sharedMongod,
      dbName: 'trm-test-apple-off',
      appleVerifier: new FakeAppleIdTokenVerifier(),
    });
    await request(d.app.getHttpServer())
      .post('/api/v1/auth/oauth/apple/credential')
      .send({ identityToken: 'fake-apple-jwt' })
      .expect(403);
    await d.close();
  });
});

describe('apple stays credential-only', () => {
  it('the redirect flow rejects apple as a provider', async () => {
    const res = await request(server()).get('/api/v1/auth/oauth/apple/start').expect(302);
    expect(String(res.headers.location)).toContain('error=provider_disabled');
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run auth-apple`
Expected: FAIL — `FakeAppleIdTokenVerifier` is not exported from `./app` (compile error).

- [x] **Step 3: Add the `jose` dependency**

Run: `yarn workspace @trm/server add jose`
Expected: `apps/server/package.json` gains `"jose"` in dependencies; `yarn.lock` updated.

- [x] **Step 4: Create the verifier seam**

Create `apps/server/src/auth/apple-id-token.verifier.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OauthProfile } from './oauth.http';

/** Verifies a Sign in with Apple identity token (RS256 JWT) and normalizes its payload. */
export interface AppleIdTokenVerifier {
  verify(idToken: string, audience: string[]): Promise<OauthProfile>;
}

export const APPLE_ID_TOKEN_VERIFIER = Symbol('APPLE_ID_TOKEN_VERIFIER');

const APPLE_ISSUER = 'https://appleid.apple.com';

/** Apple serializes email_verified as a boolean OR the string "true", depending on era. */
const truthy = (v: unknown): boolean => v === true || v === 'true';

/**
 * Real implementation: jose fetches/caches/rotates Apple's JWKS and enforces signature,
 * issuer, audience, and expiry. Apple puts no display name in the token (the native API
 * surfaces it once, client-side) and has no avatar concept — both stay empty here.
 */
@Injectable()
export class JoseAppleIdTokenVerifier implements AppleIdTokenVerifier {
  private readonly jwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

  async verify(idToken: string, audience: string[]): Promise<OauthProfile> {
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: APPLE_ISSUER,
      audience,
    });
    return {
      sub: String(payload.sub ?? ''),
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: truthy(payload.email_verified),
      displayName: '',
      avatarUrl: null,
    };
  }
}
```

- [x] **Step 5: Widen identity linking to `IdentityProvider`**

`apps/server/src/auth/auth-config.ts`, beside `OauthProvider`:

```ts
/** Providers an account identity can be linked under. Apple is credential-only (no redirect flow). */
export type IdentityProvider = OauthProvider | 'apple';
```

`apps/server/src/auth/user.repo.ts` — import `IdentityProvider` instead of `OauthProvider` and widen the four touchpoints:

```ts
import type { IdentityProvider } from './auth-config';
```

```ts
  /** Linked OAuth identities: provider → the provider's subject id. Binding key stays `email`. */
  oauth?: Partial<Record<IdentityProvider, string>>;
```

and change the `provider` parameter type from `OauthProvider` to `IdentityProvider` on `attachOauthToGuest`, `linkOauthIdentity`, and `createOauthUser` (signatures only — bodies unchanged).

`apps/server/src/auth/oauth.service.ts` — change `resolveAccount`'s first parameter:

```ts
  private async resolveAccount(
    provider: IdentityProvider,
```

with `IdentityProvider` added to the existing `./auth-config` import.

- [x] **Step 6: Service handler + route + schema + module + fake**

`apps/server/src/auth/auth.schemas.ts`:

```ts
export const AppleCredentialSchema = z.object({
  identityToken: z.string().min(1),
  /** Apple surfaces the user's name ONCE, client-side, on first authorization — pass it through. */
  fullName: z.string().trim().max(48).optional(),
  /** Mobile only: the app's refresh token, so a signed-in guest upgrades in place. */
  refreshToken: z.string().min(1).optional(),
});
```

```ts
export class AppleCredentialDto extends createZodDto(AppleCredentialSchema) {}
```

`apps/server/src/auth/oauth.service.ts` — inject the verifier (constructor, beside the Google one):

```ts
import { APPLE_ID_TOKEN_VERIFIER, type AppleIdTokenVerifier } from './apple-id-token.verifier';
```

```ts
    @Inject(APPLE_ID_TOKEN_VERIFIER) private readonly appleVerifier: AppleIdTokenVerifier,
```

and add the handler after `handleCredential`:

```ts
  /**
   * Verify a Sign in with Apple identity token and resolve the account through the same
   * verified-email binding. Hide My Email relay addresses count as verified: Apple owns
   * deliverability, and a relay account simply won't cross-link with the user's real-email
   * accounts on other providers (accepted trade-off — see the mobile design spec).
   */
  async handleAppleCredential(
    identityToken: string,
    fullName: string | undefined,
    guestUserId: string | undefined,
  ): Promise<IssuedAuth> {
    const audiences = this.authConfig.appleClientIds;
    if (audiences.length === 0) throw new UnauthorizedException('provider_disabled');

    let profile;
    try {
      profile = await this.appleVerifier.verify(identityToken, audiences);
    } catch {
      throw new UnauthorizedException('invalid_credential');
    }
    if (!profile.email || !profile.emailVerified || !profile.sub) {
      throw new UnauthorizedException('email_unverified');
    }

    const user = await this.resolveAccount(
      'apple',
      profile.email,
      profile.sub,
      fullName ?? profile.displayName,
      profile.avatarUrl,
      guestUserId,
    );
    return this.auth.issueFor(user);
  }
```

`apps/server/src/auth/auth.controller.ts` — import `AppleCredentialDto, AppleCredentialSchema` from `./auth.schemas`, then add after `googleCredential`:

```ts
  @Post('oauth/apple/credential')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with Apple via a native identity token' })
  @ApiBody({ schema: apiSchema(AppleCredentialSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(AuthResultSchema) })
  async appleCredential(
    @Body() body: AppleCredentialDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.authConfig.appleEnabled) throw new ForbiddenException('apple sign-in disabled');
    const guestUserId = await this.oauth.guestIdFromRefresh(
      body.refreshToken ?? req.cookies?.[REFRESH_COOKIE],
    );
    return this.finish(
      req,
      res,
      await this.oauth.handleAppleCredential(body.identityToken, body.fullName, guestUserId),
    );
  }
```

`apps/server/src/auth/auth.module.ts` — import and register the provider (beside the Google verifier):

```ts
import { APPLE_ID_TOKEN_VERIFIER, JoseAppleIdTokenVerifier } from './apple-id-token.verifier';
```

```ts
    { provide: APPLE_ID_TOKEN_VERIFIER, useClass: JoseAppleIdTokenVerifier },
```

`apps/server/test/app.ts` — import the seam, add the fake, option, and override branch:

```ts
import {
  APPLE_ID_TOKEN_VERIFIER,
  type AppleIdTokenVerifier,
} from '../src/auth/apple-id-token.verifier';
```

```ts
  /** Stub Apple identity-token verification (Sign in with Apple credential flow). */
  appleVerifier?: AppleIdTokenVerifier;
```

```ts
if (opts.appleVerifier)
  builder = builder.overrideProvider(APPLE_ID_TOKEN_VERIFIER).useValue(opts.appleVerifier);
```

```ts
/** A controllable stand-in for Apple identity-token verification. */
export class FakeAppleIdTokenVerifier implements AppleIdTokenVerifier {
  profile: OauthProfile | null = null;
  fail = false;
  lastAudience: string[] | null = null;
  async verify(_idToken: string, audience: string[]): Promise<OauthProfile> {
    this.lastAudience = audience;
    if (this.fail || !this.profile) throw new Error('fake apple verify failed');
    return this.profile;
  }
}
```

- [x] **Step 7: Run the spec + neighbors**

Run: `yarn workspace @trm/server test --run auth-apple`
Expected: PASS (all 10 tests)
Run: `yarn workspace @trm/server test --run auth.e2e`
Expected: PASS
Run: `yarn workspace @trm/server test --run auth-mobile`
Expected: PASS

- [x] **Step 8: Commit**

```bash
git add apps/server/package.json yarn.lock apps/server/src/auth/apple-id-token.verifier.ts apps/server/src/auth/auth-config.ts apps/server/src/auth/user.repo.ts apps/server/src/auth/oauth.service.ts apps/server/src/auth/auth.schemas.ts apps/server/src/auth/auth.controller.ts apps/server/src/auth/auth.module.ts apps/server/test/app.ts apps/server/test/auth-apple.e2e.spec.ts
git commit -m "feat(server): Sign in with Apple credential route"
```

---

### Task 3: Full-suite regression + docs

**Files:**

- Modify: `CLAUDE.md` (root — mobile env-var paragraph from P0-a)
- Modify: `apps/server/CLAUDE.md` (auth section — mobile transport paragraph from P0-a)

- [x] **Step 1: Run the full validation gates**

Run: `yarn workspace @trm/server test`
Expected: all specs PASS.
Run: `yarn typecheck`
Expected: clean.
Run: `yarn lint`
Expected: clean.

- [x] **Step 2: Document**

Root `CLAUDE.md`, in the "Mobile clients:" paragraph, change the `GOOGLE_MOBILE_CLIENT_IDS` sentence region to also cover Apple — insert after the `GOOGLE_MOBILE_CLIENT_IDS (…)` clause:

```markdown
`APPLE_CLIENT_IDS` (comma list of bundle ids / Services IDs accepted as Sign in with Apple
identity-token audiences — enables `POST /auth/oauth/apple/credential`),
```

`apps/server/CLAUDE.md`, at the end of the **Mobile transport** block added by P0-a, append:

```markdown
**Sign in with Apple** is credential-only: `POST /auth/oauth/apple/credential`
(`{identityToken, fullName?, refreshToken?}`) verifies against Apple's JWKS
(`apple-id-token.verifier.ts`, audiences = `APPLE_CLIENT_IDS`) and converges on
`resolveAccount` under the `'apple'` identity — Hide My Email relay addresses are
treated as verified emails and simply don't cross-link with other providers. There is
no `/oauth/apple/start`; Apple never enters the redirect flow.
```

- [x] **Step 3: Commit**

```bash
git add CLAUDE.md apps/server/CLAUDE.md
git commit -m "docs: document Sign in with Apple credential auth"
```
