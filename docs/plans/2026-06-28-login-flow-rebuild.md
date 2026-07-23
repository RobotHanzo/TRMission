# Rebuild the login flow

## Context

Today login is an **inline panel** (`AuthPanel` inside `screens/HomeScreen.tsx`) shown whenever
`user === null`. There is no `/login` route; the app's custom URL router (`store/ui.ts`) only knows
`home`/`room`/`game`, and "where to go after signing in" is handled by an implicit hack — a
`/room/:code` URL is left untouched while logged out and an effect in `App.tsx` resumes it once a
user appears. Auth methods are email/password + guest only; there is **no OAuth**, and nothing is
configurable.

This change makes login a first-class, separately-routed flow with explicit redirect state, adds
Google + Discord OAuth (bound by email), makes each entry method independently toggleable by env
var, and dresses the login page with a blurred in-game map backdrop.

**Confirmed product decisions (from the user):**
- Three **independent** toggles: `AUTH_PASSWORD_LOGIN_ENABLED`, `AUTH_GUEST_ENABLED`, and each OAuth
  provider (enabled iff its client id + secret are both set).
- A logged-in **guest** who signs in with OAuth (email unused) is **upgraded in place** — same `_id`
  and match history, email + provider identity attached, no password. If that email already belongs
  to another account, sign into the existing account instead (guest abandoned).
- **Auto-link by verified email**: same verified provider email = same account. Only `email_verified`
  (Google) / `verified` (Discord) emails are trusted.

---

## Server

### 1. Config plumbing (injectable, so it's testable)

`env` is a frozen `const` evaluated once at import, so we add raw reads there but expose them through
an **injectable provider** that tests can override.

- **`apps/server/src/config/env.ts`** — add: `authPasswordLogin` (`!== '0'`, default on),
  `authGuest` (`!== '0'`, default on), `googleClientId/Secret`, `discordClientId/Secret`,
  `oauthRedirectBase` (default `corsOrigins[0] ?? 'http://localhost:5173'`), `oauthStateTtl`
  (default `'10m'`).
- **`apps/server/src/auth/auth-config.ts`** (new) — `AuthConfig` injectable deriving, in its
  constructor: `passwordLogin`, `guest`, and `providers.{google,discord}: ProviderConfig | null`
  (non-null iff id+secret set; holds `authorizeUrl`/`tokenUrl`/`userinfoUrl`/`scopes`). Helpers:
  `callbackUrl(provider)`, `webCallbackUrl(target)`, `publicConfig()`. Register in `AuthModule`.

### 2. Public config endpoint + server-side gating

The toggles must be **enforced on the server**, not merely hidden in the UI.

- **`apps/server/src/auth/auth.schemas.ts`** — add `AuthConfigSchema`
  (`{ passwordLogin, guest, providers: { google, discord } }`) via the existing `apiSchema` pattern.
- **`apps/server/src/auth/auth.controller.ts`** — inject `AuthConfig`; add public
  `GET /api/v1/auth/config` → `authConfig.publicConfig()`. In `register`/`login`/`upgrade` throw
  `ForbiddenException` when `!passwordLogin`; in `guest` throw when `!guest` (inline checks, matching
  the file's current terse style).

### 3. OAuth (hand-rolled with global `fetch` — no passport)

Authorization-Code + PKCE (S256) for **both** providers. After the token exchange, call the
**userinfo endpoint** (Google `openidconnect.googleapis.com/v1/userinfo`; Discord
`discord.com/api/users/@me`) — this avoids JWKS/id_token signature handling entirely and is uniform.
Require a present, verified email.

- **`apps/server/src/auth/token.service.ts`** — add `signOauthState` / `verifyOauthState`
  (kind `'oauth-state'`, short TTL), mirroring the existing `signWsTicket`/`verifyWsTicket`. Add
  `OauthStatePayload` (`provider`, `redirect`, `nonce`, `codeVerifier`, `guestUserId?`) to
  `auth.types.ts`.
- **`apps/server/src/auth/session.repo.ts`** — add `peekUserId(token)`: read-only family lookup
  (verify `currentHash`, not revoked/expired) that returns `userId` **without rotating**. Needed
  because a top-level navigation to `/start` cannot carry a Bearer header — the guest's identity must
  come from the `trm_refresh` cookie (present, same-site) and be embedded in `state`, since at the
  cross-site **callback** the refresh cookie is absent.
- **`apps/server/src/auth/user.repo.ts`** — extend `UserDoc` with `oauth?: { google?, discord? }`
  (provider subject ids; binding key stays `email`). Add `attachOauthToGuest` (in-place upgrade:
  `isGuest:false`, set email + `oauth.<p>`, unset `guestExpiresAt`, `$inc tokenVersion`),
  `linkOauthIdentity`, `createOauthUser` (like `createRegistered` but no `passwordHash`).
- **`apps/server/src/auth/oauth.http.ts`** (new) — DI token `OAUTH_HTTP` + default `FetchOauthHttp`
  (`exchangeCode`, `fetchProfile`) normalizing to `{ sub, email, emailVerified, displayName }`. The
  only seam that hits the network → e2e overrides it.
- **`apps/server/src/auth/oauth.service.ts`** (new) — `buildAuthorize(provider, redirect,
  guestUserId?)` (validate redirect, gen nonce + PKCE, sign state, build authorize URL) and
  `handleCallback(provider, code, state, nonceCookie)`: verify state signature + provider +
  `nonce === cookie`, exchange code, fetch profile, require verified email, then resolve account:
  **(a)** state has `guestUserId` & still a guest & email unused → `attachOauthToGuest`; **(b)** else
  `findByEmail` → link identity + issue; **(c)** else `createOauthUser` (catch `E11000` → re-find +
  link). Reuse `AuthService.issue`.
- **`apps/server/src/auth/auth.controller.ts`** — two **unguarded** navigation routes:
  - `GET oauth/:provider/start` — 404/redirect if provider disabled; `peekUserId(trm_refresh)` → if
    guest, pass `guestUserId`; set nonce cookie **`trm_oauth`** and `302` to the provider.
  - `GET oauth/:provider/callback` — on success `setRefresh(res, …)` (reuse), clear `trm_oauth`,
    `302 → ${base}/login/callback?redirect=<validated>`; on failure `302 → …?error=<code>`.
    Mark `@ApiExcludeEndpoint()` (browser redirects, not JSON).

**Security invariants (must hold):**
- **`trm_oauth` nonce cookie is `SameSite=Lax`** (httpOnly, `secure: env.cookieSecure`,
  `path:/api/v1/auth/oauth`, ~10 min). **Not `Strict`** — the callback is a cross-site top-level
  navigation, and a Strict cookie would be withheld, breaking every callback.
- **`trm_refresh` stays `SameSite=Strict`** — it is *set* in the cross-site callback response (fine)
  and *read* by the subsequent **same-origin** `/auth/refresh` fetch (fine). This relies on the web
  app and API being the **same registrable domain** (they are: nginx serves `/api` + the SPA on one
  origin). Document this as a hard deployment constraint.
- **Open-redirect guard**: validate `redirect` is a same-origin path (starts with single `/`, no
  `//`, no `\`, no `://`; default `/`) both when signing `state` and before emitting `Location`.
- PKCE for both providers; require `email_verified`/`verified` (coerce Google's occasional string
  `"true"`). Residual, accepted: password signups are never email-verified, so a verified-email OAuth
  login can auto-link into a same-email password account.

### 4. Module wiring

- **`apps/server/src/auth/auth.module.ts`** — add `AuthConfig`, `OauthService`,
  `{ provide: OAUTH_HTTP, useClass: FetchOauthHttp }`.

---

## Web

### 5. Routing + redirect state (`store/ui.ts`, `App.tsx`)

- **`store/ui.ts`** — add `View` values `'login' | 'loginCallback'`; path patterns `/login` and
  `/login/callback`; `readRedirectParam()` (validate same-origin path, default `/`); a
  `navigateLogin(returnTo)` helper. Rework `syncFromUrl(authed)`: `/login` (bounce to redirect target
  if already authed) · `/login/callback` · `/room/:code` (`authed ? room : navigateLogin('/room/'+code)`)
  · else (`authed ? home : navigateLogin('/')`). This **replaces** the implicit "keep URL while
  logged out + resume" logic.
- **`App.tsx`** — render `login`/`loginCallback` views **full-bleed** (bypass the `.app-main`
  reading-width column) so the backdrop fills the screen; delete the old `/room/:code` resume effect
  (superseded by `?redirect=`); keep `restore()` on mount, popstate, theme/locale effects.

### 6. Screens

- **`net/rest.ts`** — add `AuthConfig` type + `api.config()` (`GET /auth/config`).
- **`screens/LoginScreen.tsx`** (new) — full-page: `<MapBackdrop/>` + scrim + centered `.card`.
  Fetch `api.config()` on mount; render the guest tab / email+password tab only when enabled (reuse
  the existing `AuthPanel` form markup); render OAuth buttons as plain
  `<a href="/api/v1/auth/oauth/<p>/start?redirect=<enc>">` for enabled providers; show
  `authUnavailable` if nothing is enabled; surface `?error`. On successful guest/password auth,
  navigate to `readRedirectParam()`.
- **`screens/LoginCallback.tsx`** (new) — spinner; relies on `App`'s `restore()` → when `user` set,
  navigate to the redirect target; on `?error` (or no user) show a message + link back to `/login`.
- **`screens/HomeScreen.tsx`** — remove `AuthPanel` and the `if (!user) return <AuthPanel/>` guard
  (logged-out users are now redirected to `/login`). Keep the lobby + the guest `UpgradePanel`.

### 7. Blurred map backdrop

- **`components/Geography.tsx`** (new) — extract the (currently private) `Geography()` JSX out of
  `components/Board.tsx` and export it; import it back into `Board.tsx` (pure move, no behavior
  change).
- **`components/MapBackdrop.tsx`** (new) — static, memoized, non-interactive
  `<svg className="board" viewBox={VIEWBOX} style={{'--inv-scale': 0.53}}>` with `<Geography/>` +
  `ROUTES` (base colors via `colorOf`, reusing `.bed`/`.slot`/ferry markup) + `CITIES` dots/hubs.
  **No labels, no glow, no pan/zoom, no snapshot.** Reuses `game/content`, `game/routeGeometry`,
  `game/geography`, `theme/colors`. Must `import '../styles/game.css'` (board classes live there and
  are otherwise only loaded in-game). Theming is automatic — board classes read `--tr-sea/-land/...`
  which flip with `data-theme`.
- **`styles/app.css`** (or a new `login.css`) — `.login-screen` (full viewport, centered),
  `.login-backdrop` (`position:absolute; inset:0; filter:blur(8px); opacity:.5;
  transform:scale(1.08); overflow:hidden; pointer-events:none`), `.login-scrim` (token gradient
  toward `--tr-paper` for card legibility in both themes), `.oauth-btn`/`.oauth-divider`.
- **`i18n/index.ts`** — add zh-Hant + en strings: `continueWithGoogle`, `continueWithDiscord`,
  `orContinueWith`, `authUnavailable`, `oauthError`, `signingIn`, `backToLogin` (+ any login title).

---

## Tests & docs

- **`apps/server/test/app.ts`** — add a `createTestApp` variant that `.overrideProvider(AuthConfig)`
  (providers enabled) + `.overrideProvider(OAUTH_HTTP)` (fake canned verified profile). Default app
  leaves providers off, so existing specs + `/auth/config` defaults stay green.
- **`apps/server/test/auth.e2e.spec.ts`** — add: `/auth/config` shape + gating (password-off →
  register/login/upgrade `403`; guest-off → guest `403`); OAuth `start` sets `trm_oauth` + `302` with
  `state`; callback (replay state + nonce cookie + fake profile) → `Set-Cookie trm_refresh` + `302` to
  `/login/callback`, then refresh → `/auth/me` works; guest-in-place upgrade (same `_id`); email
  auto-link (same `_id`); unverified email → `?error`. Keep all existing specs passing.
- **`apps/web`** — optional `LoginScreen.test.tsx` (mock `api.config()`, assert methods render per
  flags; `MapBackdrop` renders in jsdom — it's static SVG, no `DOMMatrix`).
- **Docs/config** — create the missing auth/OAuth section in **`apps/server/.env.example`**; update
  **`docker-compose.yml`** (`server` service env), root **`CLAUDE.md`** "Server env vars",
  **`apps/server/CLAUDE.md`** (OAuth flow + Lax-nonce + same-site constraint) and
  **`apps/web/CLAUDE.md`** (`/login` + `/login/callback`, `MapBackdrop`).

---

## Critical files

Modify: `apps/server/src/config/env.ts`, `apps/server/src/auth/{auth.controller,auth.service,token.service,session.repo,user.repo,auth.module,auth.schemas,auth.types}.ts`,
`apps/web/src/store/ui.ts`, `apps/web/src/App.tsx`, `apps/web/src/screens/HomeScreen.tsx`,
`apps/web/src/net/rest.ts`, `apps/web/src/components/Board.tsx`, `apps/web/src/i18n/index.ts`.
Create: `apps/server/src/auth/{auth-config,oauth.service,oauth.http}.ts`,
`apps/web/src/screens/{LoginScreen,LoginCallback}.tsx`,
`apps/web/src/components/{Geography,MapBackdrop}.tsx`.

## Verification

```bash
yarn typecheck && yarn lint
yarn workspace @trm/server test --run auth.e2e   # gating + full OAuth via fake OAUTH_HTTP (no network)
yarn workspace @trm/web test
yarn workspace @trm/web build
```

Manual (dev): `docker compose up -d mongo`, then `yarn workspace @trm/server dev` +
`yarn workspace @trm/web dev`; drive `http://localhost:5173` via the browser MCP:
- Logged out `/` → redirects to `/login?redirect=%2F`; screenshot the blurred map backdrop + card;
  toggle dark mode → backdrop tokens flip.
- Guest login → lands on `/`. Deep-link: `/room/ABCD` logged out → `/login?redirect=%2Froom%2FABCD`
  → after guest login lands on `/room/ABCD`.
- `AUTH_PASSWORD_LOGIN_ENABLED=0` (restart) → `/auth/config` `passwordLogin:false`, password tab
  hidden, `POST /auth/login` → `403`. Same for `AUTH_GUEST_ENABLED=0`.
- Network panel: `trm_refresh` is `HttpOnly; SameSite=Strict; Path=/api/v1/auth`; `trm_oauth` is
  `SameSite=Lax; Path=/api/v1/auth/oauth`.

Real OAuth (needs provider apps): register redirect URIs **exactly**
`http://localhost:5173/api/v1/auth/oauth/{google,discord}/callback`, set the client id/secret +
`OAUTH_REDIRECT_BASE=http://localhost:5173`. Verify: Google/Discord consent → `/login/callback` →
authenticated on `/` with **no token in the URL**; guest-in-place (same id after OAuth);
email auto-link (password account + same verified email → same id); unverified email → visible
`oauthError`.
