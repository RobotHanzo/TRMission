# CLAUDE.md

`src/auth/` issues every credential the server trusts. Guests are real `users` docs (`isGuest`, TTL);
access tokens are HS256 with rotating refresh tokens and **family reuse-detection** (single-doc CAS,
no transactions). `token.service` also mints the short-lived **ws-game ticket** the gateway verifies
on `ClientHello`.

Which entry methods are on is an injectable `AuthConfig` (derived from env; tests override it via
`new AuthConfig(overrides)`); **the controller enforces the flags** — `/auth/config` is only a UI hint.

Account **features** (`UserDoc.features`, taxonomy in `@trm/shared/features`) are read **per request**
via `FeatureGuard` / `@RequireFeature` — never token claims, so a grant or revoke applies on the
target's very next request. `RegisteredUserGuard` excludes guests from mutations.

## OAuth (`oauth.service` + `oauth.http`)

Hand-rolled with global `fetch`, no passport: authorization-code + PKCE, and the profile comes from
the provider's **userinfo** endpoint (no `id_token` signature work) for that redirect flow. Google
also has a second entry point, `POST /auth/oauth/google/credential`, for a Google Identity Services
(One Tap / rendered button) ID-token credential — the one place that **does** verify a JWT signature,
via `google-auth-library` (`google-id-token.verifier.ts`, injected behind `GOOGLE_ID_TOKEN_VERIFIER`
the same way `OAUTH_HTTP` is). Both entry points converge on the same `resolveAccount` logic, bound by
**verified email** → upgrade a live guest in place, else auto-link the same-email account, else create
a passwordless user. The only network seam is `OAUTH_HTTP` (faked in e2e).

**Cookie rules that bite**: the OAuth nonce cookie `trm_oauth` is **`SameSite=Lax`** (the provider
callback is a cross-site top-level navigation — a Strict cookie would be withheld, breaking every
callback), while `trm_refresh` stays **Strict** (set in the callback, read by the same-origin
`/auth/refresh`). That requires the **web app and API to be the same registrable domain** — keep
`OAUTH_REDIRECT_BASE` on the SPA's origin. A logged-in guest's id is read from the refresh cookie at
`/oauth/:p/start` (`SessionRepo.peekUserId`, no rotation) and carried in the signed `state`, because
the callback arrives cross-site without the cookie.

## Mobile transport

No SameSite cookie can reach a native app, so: `x-trm-client: mobile` on any issuance route returns
the refresh token **in the body**; `/auth/refresh` + `/auth/logout` take `{refreshToken}` in the body
(body-in → body-out, never a cookie). Guest TTLs slide forward on refresh.

The OAuth redirect flow with `?client=mobile` ends at
`trmission:///m/callback?code=<single-use exchange code>` — a custom-scheme redirect, **not** an
`https://` universal link: ASWebAuthenticationSession (iOS) and the Android Custom Tab equivalent only
complete an in-flight auth session on a URL-scheme match, never via Associated Domains/App Links
(`AuthConfig.mobileCallback`). Codes are minted in `mobile-code.repo.ts` and redeemed by
`POST /auth/mobile/exchange` for a fresh token pair; a signed-in guest is carried via
`POST /auth/mobile/carry` → `?carry=` (the cookie-free analogue of the refresh-cookie peek). Google ID
tokens verify against `AuthConfig.googleAudiences()` (web + `GOOGLE_MOBILE_CLIENT_IDS`).

The builder WebView's session handoff is `GET /api/v1/auth/mobile-web-handoff?code=` — it redeems the
same single-use carry code (`POST /auth/mobile/carry` over Bearer), mints a **NEW web session family**,
sets the normal Strict refresh cookie, and 302s to `/maps` (errors 302 to `/login/callback?error=…`,
never a 500 on a top-level navigation). It is the one sanctioned way a native session becomes a web
cookie session.

## Sign in with Apple

Two entry points:

- **Native (iOS)**: `POST /auth/oauth/apple/credential` (`{identityToken, fullName?, refreshToken?}`)
  verifies against Apple's JWKS (`apple-id-token.verifier.ts`, audiences = `appleAudiences()` —
  `APPLE_CLIENT_IDS` plus the Services ID) and converges on `resolveAccount` under the `'apple'`
  identity. Hide My Email relay addresses are treated as verified emails and simply don't cross-link
  with other providers.
- **Web + Android**: a DEDICATED redirect-flow route pair `GET /oauth/apple/start` +
  `POST /oauth/apple/callback` (declared before the `:provider` routes; `asProvider` still rejects
  `apple`, so Apple stays outside `OAUTH_PROVIDERS`), enabled when `APPLE_SERVICES_ID` is set.

Apple diverges from the shared flow three ways: per-request ES256 client_secret
(`apple-client-secret.ts`, shared with the revoker), identity from the token response's `id_token`
(no userinfo; exchange seam `apple-redirect.client.ts`, faked in e2e), and a `response_mode=form_post`
callback that arrives as a **CROSS-SITE POST** — so its nonce cookie (`trm_oauth_apple`) is
SameSite=None/HTTPS-only. The callback **ALWAYS** requires that cookie to match the signed state's
nonce; this CSRF binding is a security invariant, independent of `COOKIE_SECURE` (which only governs
the cookie's own Secure attribute — Apple requires the redirect flow's Return URL to be HTTPS, so a
legitimate round trip always carries it). `?client=mobile` hands off via the same `/m/callback`
exchange-code path Discord uses (Android runs this flow in a system browser).

Account deletion (`DELETE /auth/me`, incl. Apple token revocation) lives in `src/account/CLAUDE.md`.

## Env vars

- Token lifetimes: `JWT_ACCESS_TTL`, `WS_TICKET_TTL`, `REFRESH_TTL_MS`, `GUEST_TTL_MS`.
- **Auth methods** (each independently switchable; the web reads `GET /auth/config`, the server
  enforces): `AUTH_PASSWORD_LOGIN_ENABLED` (`0` disables email/password login+register+upgrade),
  `AUTH_GUEST_ENABLED` (`0` disables guest sessions).
- **OAuth** (bound by _verified_ email — same email = same account across providers + password):
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` (a provider
  is enabled only when both are set), `OAUTH_REDIRECT_BASE` (public base URL — builds the provider
  `redirect_uri` and the post-callback web redirect; **must be the same origin that serves the SPA**
  so the Strict refresh cookie survives the callback), `OAUTH_STATE_TTL_MS` (signed-state +
  nonce-cookie lifetime, ms). OAuth carries the provider avatar URL onto the account for display.
- **Mobile / Apple**: `GOOGLE_MOBILE_CLIENT_IDS` (comma list — extra ID-token audiences for the
  iOS/Android Google Sign-In apps), `APPLE_CLIENT_IDS` (comma list of bundle ids / Services IDs
  accepted as Sign in with Apple identity-token audiences — enables
  `POST /auth/oauth/apple/credential`), `APPLE_SERVICES_ID` (the SIWA web/Android redirect flow's
  OAuth client_id — enables `GET/POST /auth/oauth/apple/{start,callback}`; register
  `${OAUTH_REDIRECT_BASE}/api/v1/auth/oauth/apple/callback` as its Return URL), `APPLE_TEAM_ID` +
  `APPLE_KEY_ID` + `APPLE_PRIVATE_KEY` (SIWA token revocation during `DELETE /auth/me`; best-effort
  per TN3194).
