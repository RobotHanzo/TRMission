# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`apps/admin` is the maintainer dashboard: a REST-only React + Vite + TypeScript app deployed
same-origin under `/admin/` (the Strict refresh cookie requires this — never point it at a
different origin than the game server). It reuses game accounts for sign-in but gates everything
behind a separate `dashboardAccounts` permission model. A LIVE game's hidden information (state,
action log, even the seed) must never reach this surface.

```bash
yarn workspace @trm/admin dev         # vite on :5174/admin/ (proxies /api → :3001)
yarn workspace @trm/admin build       # vite build
yarn workspace @trm/admin typecheck   # tsc --noEmit
yarn workspace @trm/admin lint        # eslint src
yarn workspace @trm/admin test        # vitest run + @testing-library/react
yarn workspace @trm/admin test:watch  # vitest (watch mode)

# Single test file (vitest substring match on file path):
yarn workspace @trm/admin test App.test
yarn workspace @trm/admin test FeaturesView.test
```

**Pin:** Vite is held at **^5** for vitest 2 compatibility, same as `apps/web` — do not bump to Vite 6.

## Auth/session gate

`store/session.ts` drives a 4-phase gate: `booting → unauthenticated | denied | ready`. `restore()`
calls `GET /auth/me` (the same endpoint the game app uses — a session established in either app
restores in the other via the shared httpOnly refresh cookie), then probes `GET /dashboard/me`:

- A guest, or a registered user with no `dashboardAccounts` record (404/403), lands in `denied` —
  **the sign-in itself is valid** (it's also a game login), so `DeniedView` says so plainly and
  offers logout rather than implying the credentials were wrong.
- A successful probe returns `{ role, permissions }` and moves to `ready`.

`net/rest.ts` is a trimmed copy of the game web app's REST client: in-memory access token +
single-flight 401→`/auth/refresh`→retry (concurrent 401s must share one rotation, or the server's
refresh-reuse detection burns the whole session family — see the comment in `tryRefresh`).

## Permission model

`DASHBOARD_PERMISSIONS`/`DASHBOARD_ROLES`/`effectivePermissions` live once in `@trm/shared`
(`packages/shared/src/dashboard.ts`) so the server guard and this UI can never drift. Roles
(`viewer < moderator < admin < owner`) expand to fixed permission sets in code; only per-account
`extraPermissions`/`deniedPermissions` overrides are stored data — **denied always wins, even over
extra**. `App.tsx`'s `NAV` array maps each nav entry to the permission that must be present in
`session.permissions` to render it; individual action buttons (ban, terminate, close, edit
maintainer) gate the same way via `useSession((s) => s.hasPermission(...))`. This is UI convenience
only — the server enforces the same taxonomy independently; never treat a hidden nav item as the
security boundary.

This is a **separate system** from per-account `UserFeature` flags (`@trm/shared`'s
`USER_FEATURES`, e.g. `mapBuilder`/`replayReview`) managed from the Users/Features views —
dashboard permissions gate _this app_, user features gate capabilities in the _game_ app.

## Routing (`store/ui.ts`)

A hand-rolled router, not a library — same pattern as the game web app's `store/ui.ts`, smaller.
All paths live under the `/admin` base (`vite.config.ts` `base: '/admin/'`; nginx must serve the
same prefix). `parsePath`/`pathFor` are the only place that encodes the URL shape:
`/admin/{view}` for each `AdminView` (incl. the P6 `reports` UGC-moderation queue), plus an
optional `/:param` segment used as a **detail drawer id** (Users/Games) — pushed to the URL so
refresh or a shared link reopens the same drawer.
`gateToLogin`/`leaveLogin` (called from `store/session.ts`) use `replaceState`, not `pushState`, so
the auth redirect doesn't pollute browser history.

## View pattern

Every list view (`UsersView`, `GamesView`, `RoomsView`, `MaintainersView`) follows the same shape:
cursor-paginated `GET /dashboard/...` list + tabs/filter + search, each row opening a `Drawer` that
fetches its own detail on mount. Destructive actions (disable user, terminate game, close room,
revoke maintainer) always go through `ConfirmDialog`, and the ones with real irreversible
consequences (`terminate`, `disable`) pass `withReason` — read the `*ConfirmBody` i18n strings
before changing this flow; they document exact consequences (e.g. terminating a game ends it with
no scores and it can never be replayed; a disabled account's already-issued access tokens keep
read-only access for up to 15 minutes). `AccountSelectorModal` is the shared search-as-you-type
picker used wherever a flow needs to target an arbitrary account (grant maintainer, grant a
feature).

`GamesView`'s action log (`GET /dashboard/games/:id/log`) is only ever fetched/rendered for
`COMPLETED` games (`games.readLog` permission) — a live game's log would reveal hidden information,
and the seed itself is withheld by the server (`seed` is `undefined`) while a game is `LIVE`.

## i18n & design system

`i18n/index.ts` hardcodes both locale tables inline (no external JSON) — zh-Hant primary, en
fallback, **same key tree in both**; adding a string means adding it to both objects. `store/ui.ts`
persists locale/theme to `localStorage` and applies theme via `data-theme` on `<html>`.

`styles/tokens.css` defines the "Operations Control Center" design tokens (`--oc-*` CSS variables,
dark as the primary theme) — a neutral graphite dispatcher console. Status is always communicated
via **signal aspects** (`clear`/`caution`/`stop`, railway semaphore colours) through `SignalBadge`,
always paired with a text label, never colour alone. All component class names are `oc-`-prefixed;
follow that convention for new UI rather than introducing a new prefix or a CSS-in-JS approach.

## Testing

`vitest.setup.ts` polyfills `window.matchMedia` (jsdom lacks it; the theme resolver touches it) and
runs `@testing-library/react`'s `cleanup` after each test. `App.test.tsx` shows the standard pattern
for permission-gated integration tests: `stubFetch` maps URL substrings to canned
`{status, body}` responses (routes are matched by `url.includes(path)`, so order/specificity
matters if you add overlapping paths), and tests reset `useUi`/`useSession` state in `beforeEach`
since both are module-level zustand stores that persist across tests otherwise.
