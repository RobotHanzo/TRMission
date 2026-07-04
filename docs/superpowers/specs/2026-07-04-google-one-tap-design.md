# Google sign-in: One Tap + rendered popup button

## Problem

`LoginScreen`'s Google entry is a plain `<a>` that does a full-page redirect
into the hand-rolled authorization-code+PKCE flow
(`oauth.service.ts`/`oauth.http.ts`): browser → `accounts.google.com` → back
to `/login/callback`. That's the only Google entry point today — no One Tap
nudge, and no use of Google's own Identity Services (GSI) widgets, which is
what Google's current web guidance
(https://developers.google.com/identity/gsi/web/guides/migration#rendered_1)
describes as the replacement for the old `gapi.auth2` button/One Tap APIs.

## Goal

Add Google One Tap (the automatic corner prompt) and switch the clickable
entry point to Google's own rendered "Sign in with Google" button (native
popup/FedCM UI), both authenticating via a signed ID token (JWT) handed
straight to the browser — no authorization code, no page navigation. Discord
is untouched. The existing redirect flow for Google stays wired up server-side
as a fallback for browsers that can't run GSI (script blocked, etc.).

## Non-goals

- No removal of `GET /auth/oauth/google/start`/`/callback` — kept exactly as
  today, still reachable, just no longer the primary UI path.
- No change to Discord's flow, to `AuthConfig`'s provider-enabled semantics, or
  to how guest-upgrade/auto-link/create-new account resolution works
  conceptually — the new path reuses the same resolution logic, just reached
  via a different entry.
- No CSP changes. `main.ts` already runs with CSP off (noted in
  `apps/server/CLAUDE.md` as "tighten in prod"); loading
  `accounts.google.com/gsi/client` needs nothing new today.
- No change to how the app decides `googleClientId` availability — mirrors
  the existing `providers.google` boolean (both derived from the same
  configured `AuthConfig.provider('google')`).

## Design

### Backend (`apps/server/src/auth/`)

**New dependency:** `google-auth-library` — used only for
`OAuth2Client.verifyIdToken`, not as a general auth framework. ID-token
verification (JWKS fetch/cache/rotation, `alg`/`aud`/`iss`/`exp` checks) is
security-sensitive enough that hand-rolling it (like `oauth.http.ts` does for
the authorization-code exchange) isn't worth it here — there's no code
exchange step for One Tap/rendered-button credentials to lean on, the JWT
signature itself is the only proof.

**New DI seam**, parallel to the existing `OAUTH_HTTP` token:

```ts
// google-id-token.verifier.ts
export interface GoogleIdTokenVerifier {
  verify(idToken: string, audience: string): Promise<OauthProfile>;
}
export const GOOGLE_ID_TOKEN_VERIFIER = Symbol('GOOGLE_ID_TOKEN_VERIFIER');
```

Real implementation wraps `new OAuth2Client().verifyIdToken({ idToken, audience })`
and maps the payload (`sub`, `email`, `email_verified`, `name`, `picture`) into
the existing `OauthProfile` shape (`oauth.http.ts`) — the same normalized shape
`resolveAccount` already consumes from the redirect flow. Throws on any
verification failure (bad signature, expired, wrong audience, missing/
unverified email); the caller translates that to `UnauthorizedException`.

**`OauthService` gets a new public method**, alongside the existing (private)
`resolveAccount` used by `handleCallback`:

```ts
async handleCredential(
  idToken: string,
  guestUserId: string | undefined,
): Promise<IssuedAuth> {
  const cfg = this.authConfig.provider('google');
  if (!cfg) throw new UnauthorizedException('provider_disabled');
  const profile = await this.verifier.verify(idToken, cfg.clientId);
  if (!profile.email || !profile.emailVerified) {
    throw new UnauthorizedException('email_unverified');
  }
  const user = await this.resolveAccount('google', profile.email, profile.sub,
    profile.displayName, profile.avatarUrl, guestUserId);
  return this.auth.issueFor(user);
}
```

No new redirect/error-query-param plumbing: unlike `handleCallback` (a
top-level navigation that must always land somewhere), this is a normal
JSON call, so failures just throw and the controller's caller sees a REST
error — same shape as `login`/`register` failing on bad credentials.

`OauthService`'s constructor takes `@Inject(GOOGLE_ID_TOKEN_VERIFIER) private readonly verifier`,
same injection style as the existing `@Inject(OAUTH_HTTP)`. `auth.module.ts`
binds it to the real `google-auth-library`-backed implementation (parallel to
its existing `OAUTH_HTTP` binding); `test/app.ts` overrides it with
`FakeGoogleIdTokenVerifier` the same way it overrides `OAUTH_HTTP` today.

**New controller route**, JSON not a browser navigation (`AuthController`):

```ts
@Post('oauth/google/credential')
@HttpCode(200)
@ApiBody({ schema: apiSchema(GoogleCredentialSchema) })
@ApiResponse({ status: 200, schema: apiSchema(AuthResultSchema) })
async googleCredential(
  @Body() body: GoogleCredentialDto,
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
) {
  const guestUserId = await this.oauth.guestIdFromRefresh(req.cookies?.[REFRESH_COOKIE]);
  return this.finish(res, await this.oauth.handleCredential(body.credential, guestUserId));
}
```

`GoogleCredentialSchema = z.object({ credential: z.string().min(1) })` in
`auth.schemas.ts`, matching GIS's `CredentialResponse.credential` field name.
Reading the guest id from the refresh cookie mirrors `oauthStart` exactly —
this is a same-origin fetch (`credentials: 'include'`), so the `Strict`
`trm_refresh` cookie rides along same as any other same-site XHR.

**`AuthConfig.publicConfig()`** gains an optional `googleClientId`:

```ts
providers: { google: !!this.providers.google, discord: !!this.providers.discord },
...(this.providers.google ? { googleClientId: this.providers.google.clientId } : {}),
```

Client IDs are not secret (they're embedded in public web pages by design);
only the client *secret* stays server-only. `AuthConfigSchema` gets
`googleClientId: z.string().optional()`.

**Testing seam:** `test/app.ts` gets a `FakeGoogleIdTokenVerifier` next to
the existing `FakeOauthHttp`, overridable via `.overrideProvider(GOOGLE_ID_TOKEN_VERIFIER)`,
so e2e specs never call Google's real JWKS endpoint. New e2e cases in
whatever spec currently covers `oauth.service`'s redirect flow, re-run through
`handleCredential` instead: new account, existing-email auto-link, guest
upgrade-in-place, unverified email rejected, disabled provider rejected.

### Frontend (`apps/web/src/`)

**`net/rest.ts`**: `AuthConfig` gains `googleClientId?: string`; new
`api.googleCredential = (credential: string) => req<AuthResult>('POST', '/auth/oauth/google/credential', { credential })`.

**New `net/google.ts`** — loads the GSI script once (module-level singleton
promise) and exposes a thin wrapper:

```ts
export function loadGoogleIdentityServices(): Promise<typeof google>;
```

Injects `<script src="https://accounts.google.com/gsi/client" async defer>`,
resolves on `onload`, rejects on `onerror` **or a ~3s timeout** (some
ad-blockers/extensions silently no-op the request instead of firing
`onerror`) so callers can always fall back rather than hang.

**`LoginScreen.tsx`** changes:
- On mount (once `config.providers.google && config.googleClientId` is
  known), attempt `loadGoogleIdentityServices()`.
  - **On success:** `google.accounts.id.initialize({ client_id: config.googleClientId, callback: handleCredential, use_fedcm_for_prompt: true })`;
    `google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', locale: googleLocale(i18n.language), text: 'continue_with' })`
    replacing today's custom `<a className="oauth-google">` anchor+`GoogleIcon`;
    then `google.accounts.id.prompt()` to fire One Tap. `googleLocale` maps
    `zh-Hant` → `zh-TW`, `en` → `en`.
  - **On failure** (script blocked/network error): render the existing
    anchor button (`oauthStartUrl('google')`) unchanged — this is the
    concrete fallback path.
  - Discord's button is untouched either way.
- `handleCredential({ credential })` calls a new `loginWithGoogleCredential`
  session action.

**`store/session.ts`**: new action `loginWithGoogleCredential(credential: string)`,
structurally identical to `login`/`register` — calls `api.googleCredential`,
applies `{user, accessToken}` on success, sets the existing `error` field on
failure. Reuses `LoginScreen`'s existing `{error && <p className="error">}`
block; no new error UI.

### Data flow summary

```
User sees One Tap prompt OR clicks Google's rendered button
  → GSI resolves an ID token JWT in-browser (no server round trip yet)
  → handleCredential POSTs { credential } to /auth/oauth/google/credential
  → server verifies JWT (google-auth-library) → resolveAccount (same logic
    as the redirect flow: guest-upgrade / auto-link / create) → issueFor
  → { user, accessToken } + Set-Cookie trm_refresh, same as login/register
  → session store applies it, LoginScreen's existing `navigateAfterAuth()`
    effect fires (unchanged — it already reacts to `user` being set)
```

## Tests to update

- New server e2e spec (or cases added to wherever OAuth e2e lives) exercising
  `handleCredential` via `FakeGoogleIdTokenVerifier`: new account, existing-
  email auto-link, guest upgrade-in-place, unverified-email rejection,
  provider-disabled rejection.
- `apps/web/src/screens/LoginScreen.test.tsx`: GSI-available path renders the
  container for `renderButton`/calls `prompt()`; GSI-failure path still
  renders the legacy anchor with the correct `href`.
- `apps/web/src/store/session.test.ts` (or equivalent): `loginWithGoogleCredential`
  success/failure mirror the existing `login` test cases.

## Open risk (accepted, not mitigated)

Google's FedCM rollout continues to evolve browser-by-browser; `use_fedcm_for_prompt: true`
is the currently-recommended setting, but exact One Tap suppression behavior
(e.g. Chrome's own cooldown after a dismissal) is entirely Google's client-side
logic, not something this app controls or needs to replicate.
