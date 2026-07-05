# Admin panel: delegate login to the main app via redirect

## Problem

`apps/admin` (the maintainer dashboard) has its own email/password login form
(`views/LoginView.tsx`), duplicated from `apps/web`'s login. This is pure
duplication: both apps already share one cookie jar (same nginx origin in
prod; same-site even cross-port in dev), and `DashboardGuard` on the server
never requires a separate admin credential — it just checks whether the
_existing_ logged-in user has a `dashboardAccounts` record. Signing in via
admin's form does nothing admin-specific; it's the same
`POST /auth/login` the web app already exposes with a fuller UI (guest,
register, OAuth).

## Goal

Remove admin's login dialog. When an admin visitor has no valid session,
bounce them to the main app's `/login` (reusing its existing `?redirect=`
mechanism), and resume back at the exact admin URL they started from once
they sign in there.

## Non-goals

- No shared auth component/package between the two apps — the coupling stays
  purely "shared cookie + a redirect round-trip," which is what already
  half-exists via `redirect=`/`safeRedirect`.
- No server-side changes. The server's `safeRedirect` (used today for OAuth)
  already accepts any same-origin leading-`/` path, so `redirect=/admin/...`
  needs no new validation.
- `DeniedView` (a valid main-app login without a `dashboardAccounts` record)
  is unchanged — that's a distinct, correct state, not a login dialog.
- No UI changes to `apps/web`'s `LoginScreen`/`LoginCallback` — they stay
  fully generic; nothing admin-specific is shown even when arriving via an
  admin-bound redirect.

## Design

### Deployment topology (why this works)

In production, `apps/web/nginx.conf` serves `apps/web`'s build at `/` and
`apps/admin`'s build under `^~ /admin`, and proxies `/api` + `/ws` to the
server container — one origin, one cookie jar
(`apps/web/Dockerfile` builds and copies both bundles into the same nginx
image). In local dev the two Vite dev servers run on different ports
(web `:5173`, admin `:5174`), which are different _origins_ for same-origin
XHR purposes but the same _site_ for cookie scoping (site = scheme + eTLD+1,
port-independent) — so the shared `trm_refresh` cookie (`SameSite=Strict`)
already works across both dev ports today. What doesn't work automatically
in dev is a plain relative-path browser redirect between the two apps, since
`/login` typed into admin's origin (`:5174`) would hit admin's own dev
server, not web's. That's handled with a small dev-only origin config below.

### `apps/admin` changes

Remove:

- `views/LoginView.tsx` (the email/password form) entirely.
- `store/session.ts`'s `login`/`loading`/`error` fields — used only by
  `LoginView`, confirmed no other consumer.
- `store/ui.ts`'s `gateToLogin`/`leaveLogin`, the `'login'` member of
  `AdminView`, and the `/admin/login` branch in `parsePath`.
- `net/rest.ts`'s `api.login`/`AuthResult`/`captureToken` — admin never
  performs a login itself; it only _restores_ a session, and `api.me()`'s
  existing 401→`/auth/refresh` path (using the shared refresh cookie)
  already covers that.
- The now-orphaned `login.*` i18n keys (`email`/`password`/`submit`/
  `oauthHint`/`openMain`) from `i18n/index.ts`'s `zh-Hant`/`en` dictionaries.

Add a small helper, e.g. `src/lib/mainApp.ts`:

```ts
const DEV_WEB_ORIGIN = import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:5173';
const webOrigin = () => (import.meta.env.DEV ? DEV_WEB_ORIGIN : ''); // '' → relative, same-origin in prod
export const mainLoginUrl = (returnTo: string) =>
  `${webOrigin()}/login?redirect=${encodeURIComponent(returnTo)}`;
```

Change `store/session.ts`: where `restore()`'s catch block and `logout()`
currently call `gateToLogin()`, instead do a full navigation:

```ts
window.location.href = mainLoginUrl(window.location.pathname + window.location.search);
```

This preserves the exact admin deep link (e.g. `/admin/users/42`) as the
return target.

Change `App.tsx`: drop the `LoginView` import/branch. The `'unauthenticated'`
phase renders the same loading UI as `'booting'` — the redirect fires
synchronously from the store, so this state is visible for at most an
instant before the browser navigates away.

### `apps/web` changes

`store/ui.ts`'s `navigateAfterAuth()` currently matches a hardcoded whitelist
of known internal views (room/history/replay/maps/map-editor) and silently
falls back to home for anything else — `/admin` would hit that fallback
today and strand the user on the web home screen. Add a branch, checked
before the final fallback:

```ts
const DEV_ADMIN_ORIGIN = import.meta.env.VITE_ADMIN_ORIGIN ?? 'http://localhost:5174';
const adminOrigin = () => (import.meta.env.DEV ? DEV_ADMIN_ORIGIN : '');
...
if (target === '/admin' || target.startsWith('/admin/')) {
  window.location.href = `${adminOrigin()}${target}`;
  return;
}
```

Unlike the other branches (which do SPA-internal `replacePath`/`set`), this
is a **hard** navigation, since `/admin` is a separate build this router
cannot render.

No other web changes are needed:

- `safePath`/`readRedirectParam` already accept `/admin...` as a valid
  same-origin target.
- `syncFromUrl` needs no `/admin` case: in prod nginx never routes `/admin`
  requests to the web bundle, and in dev the web dev server never receives
  `/admin` requests either (admin's dev server owns that path on its own
  port). Web's router only ever sees `/admin` as a `redirect=` _value_,
  never as its own current path.
- OAuth needs no server changes: `redirect=/admin/...` already round-trips
  unchanged through `safeRedirect`, lands on `/login/callback` (always the
  web app, per `OAUTH_REDIRECT_BASE`), and `navigateAfterAuth()`'s new branch
  handles the final hop from there — same code path as password login.

### Side effect worth noting

If a visitor already has a valid game session (cookie still good) and hits
`/admin` while admin's own client-side session state is momentarily
unauthenticated, `syncFromUrl`'s existing `LOGIN_PATH` handling (`authed` →
`navigateAfterAuth()` immediately, no form shown) means they bounce through
web and back to admin without ever seeing a login form. The redirect dance
is invisible when already signed in.

### Tests to update

- `apps/admin/src/store/session.test.ts` — the `'no session at all →
unauthenticated'` case still holds (phase becomes `unauthenticated`), but
  `restore()` now performs `window.location.href = ...`; the test needs to
  stub/observe that assignment rather than let jsdom attempt a real
  navigation.
- `apps/admin/src/store/ui.test.ts` — drop the `parsePath('/admin/login')`
  expectation; `'login'` is no longer a valid `AdminView`.
- `apps/admin/src/App.test.tsx` — add a case asserting the redirect fires
  for the unauthenticated phase, using the same stubbing seam as
  `session.test.ts`.

## Open risk (accepted, not mitigated)

If cookies are fundamentally not working for a visitor (disabled entirely,
or some unusual browser policy), the admin→web→admin bounce could repeat.
This isn't a true infinite loop — logging in on the web side always requires
active user input, it's not an auto-resubmit — and it's an inherent
limitation of cookie-based auth that already exists for the web app itself.
Not worth a loop guard.
