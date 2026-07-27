# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`apps/admin` is the maintainer dashboard: a REST-only React + Vite + TypeScript app deployed
same-origin under `/admin/` (the Strict refresh cookie requires this — never point it at a
different origin than the game server). It reuses game accounts for sign-in but gates everything
behind a separate `dashboardAccounts` permission model. **A LIVE game's hidden information (state,
action log, even the seed) must never reach this surface.**

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

## Where the per-area docs live

Read the one for the area you're touching (Claude Code loads them on demand).

| Area                                                    | Doc                                   |
| ------------------------------------------------------- | ------------------------------------- |
| Session gate, permission gating, routing                | `src/store/CLAUDE.md`                 |
| REST client + single-flight refresh                     | `src/net/CLAUDE.md`                   |
| List/drawer view pattern, confirm flows, log visibility | `src/views/CLAUDE.md`                 |
| "Operations Control Center" tokens, signal aspects      | `src/styles/CLAUDE.md`                |
| Locale tables                                           | `src/i18n/CLAUDE.md`                  |
| Sentry, error boundary, replay policy                   | `src/observability/CLAUDE.md`         |
| Server-side dashboard API, audit, purge                 | `apps/server/src/dashboard/CLAUDE.md` |

## Two separate gating systems (don't conflate them)

**Dashboard permissions** gate _this app_. `DASHBOARD_PERMISSIONS`/`DASHBOARD_ROLES`/
`effectivePermissions` live once in `@trm/shared` (`packages/shared/src/dashboard.ts`) so the server
guard and this UI can never drift. Roles (`viewer < moderator < admin < owner`) expand to fixed
permission sets in code; only per-account `extraPermissions`/`deniedPermissions` overrides are
stored data — **denied always wins, even over extra**. The UI-side gating is convenience only; the
server enforces the taxonomy independently (`src/store/CLAUDE.md`).

**User features** (`@trm/shared`'s `USER_FEATURES`, e.g. `mapBuilder`/`replayReview`), managed from
the Users/Features views, gate capabilities in the _game_ app — not here.

## Testing

`vitest.setup.ts` polyfills `window.matchMedia` (jsdom lacks it; the theme resolver touches it) and
runs `@testing-library/react`'s `cleanup` after each test. `App.test.tsx` shows the standard pattern
for permission-gated integration tests: `stubFetch` maps URL substrings to canned `{status, body}`
responses (routes are matched by `url.includes(path)`, so order/specificity matters if you add
overlapping paths), and tests reset `useUi`/`useSession` state in `beforeEach` since both are
module-level zustand stores that persist across tests otherwise.
