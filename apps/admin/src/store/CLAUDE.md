# Stores (`apps/admin/src/store/`)

App-wide context: `apps/admin/CLAUDE.md`.

## Auth/session gate (`session.ts`)

A 4-phase gate: `booting → unauthenticated | denied | ready`. `restore()` calls `GET /auth/me` (the
same endpoint the game app uses — a session established in either app restores in the other via the
shared httpOnly refresh cookie), then probes `GET /dashboard/me`:

- A guest, or a registered user with no `dashboardAccounts` record (404/403), lands in `denied` —
  **the sign-in itself is valid** (it's also a game login), so `DeniedView` says so plainly and
  offers logout rather than implying the credentials were wrong.
- A successful probe returns `{ role, permissions }` and moves to `ready`.

## Permission gating in the UI

`App.tsx`'s `NAV` array maps each nav entry to the permission that must be present in
`session.permissions` to render it; individual action buttons (ban, terminate, close, edit
maintainer) gate the same way via `useSession((s) => s.hasPermission(...))`. **This is UI
convenience only** — the server enforces the same taxonomy independently; never treat a hidden nav
item as the security boundary. The taxonomy itself lives once in `@trm/shared`
(`packages/shared/src/dashboard.ts`), so this UI and the server guard can never drift.

## Routing (`ui.ts`)

A hand-rolled router, not a library — same pattern as the game web app's `store/ui.ts`, smaller. All
paths live under the `/admin` base (`vite.config.ts` `base: '/admin/'`; nginx must serve the same
prefix). `parsePath`/`pathFor` are the only place that encodes the URL shape: `/admin/{view}` for
each `AdminView` (incl. the P6 `reports` UGC-moderation queue), plus an optional `/:param` segment
used as a **detail drawer id** (Users/Games) — pushed to the URL so refresh or a shared link reopens
the same drawer. `gateToLogin`/`leaveLogin` (called from `session.ts`) use `replaceState`, not
`pushState`, so the auth redirect doesn't pollute browser history.

`ui.ts` also persists locale/theme to `localStorage` and applies theme via `data-theme` on `<html>`.
