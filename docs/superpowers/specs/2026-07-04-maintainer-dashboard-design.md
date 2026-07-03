# Maintainer Dashboard — Design & Implementation Plan

## Context

TRMission has **no admin/moderation layer at all**: no roles, no bans, no way to close a stuck
room, no global view of live games — while rich operational data already exists (event-sourced
games, prom-client metrics, rooms, matchHistory). This plan adds a **maintainer dashboard**: a new
separate admin web app (`apps/admin`) backed by new guarded server endpoints. The existing
accounts system is reused; **dashboard access lives in a new, separate Mongo collection**
(`dashboardAccounts`) holding each maintainer's role and permission overrides.

### Decisions made with the user

| Decision | Choice |
|---|---|
| Scope (v1) | All four: Overview + live ops · User management · Game & room moderation · Maintainer admin + audit log |
| Roles model | Named roles → permission sets in code, **plus per-account `extraPermissions` / `deniedPermissions` overrides** |
| Placement | **Separate app `apps/admin`** (`@trm/admin`), served same-origin (required by the Strict refresh cookie) |
| Aesthetic | Light-minimal modern admin language; **dark mode is the primary theme** (both fully supported) |

### Hard constraints (verified in exploration)

- **Hidden-info invariant**: a LIVE game's action log reveals secrets; even its `seed` +
  `contentHash` deterministically encodes every hand. Dashboard exposes full logs/replays **only
  for COMPLETED games** (the existing `status:'COMPLETED'` hard gate in `HistoryRepo.loadReplay`
  stays the single sanctioned exception); LIVE game detail **redacts `seed`** and shows metadata +
  players + `currentSeq` + chat only (chat is already broadcast to all members).
- Guests are real `users` docs with TTL → maintainers must be registered users.
- Server patterns: native Mongo driver repos (`apps/server/src/auth/user.repo.ts` is the
  template), zod-single-source DTOs (`nestjs-zod` + `apiSchema`), guard chaining after
  `AccessTokenGuard`, env in `apps/server/src/config/env.ts`, injectable-config pattern
  (`auth-config.ts`) for testability. swc runtime — never tsx.
- Access tokens are 15-min HS256; `tokenVersion` is not verified per-request today.
- Vite pinned **^5** repo-wide (vitest 2 compat). No charting library exists; graphics are
  hand-drawn SVG. Root `workspaces: ["packages/*", "apps/*", "tooling/*"]` + flat
  `eslint.config.mjs` → a new `apps/admin` needs **no root/turbo changes**.

---

## Part 1 — Visual design direction (`apps/admin`)

**Concept: 行控中心 (Operations Control Center).** The dispatcher's desk for the game's railway
world — calm, precise, instrument-like. It shares the product family's EMU-blue accent but drops
the game's warm-paper playfulness for a neutral graphite console. The railway appears only in the
*status language* and the *numerals* — not as a theme costume.

### Signature elements

1. **Departure-board status strip** — the Overview hero: a full-width live strip of system vitals
   (進行中對局 live games · 開放房間 open rooms · 連線數 sockets · 使用者 users) in large IBM Plex
   Mono tabular numerals. Values tick with a subtle micro-slide when they change (10s poll);
   `prefers-reduced-motion` disables the animation.
2. **Signal-aspect status language** — statuses use railway signal aspects, always paired with a
   text label (colour-blind safe, matching the game's accessibility care):
   ● green *clear* = healthy/LIVE/active · ● amber *caution* = degraded/LOBBY/pending ·
   ● red *stop* = disabled/CLOSED/TERMINATED/error (and the leak counter whenever it is > 0).

### Design tokens (`apps/admin/src/styles/tokens.css`, prefix `--oc-`)

| Token | Dark (default) | Light |
|---|---|---|
| `--oc-bg` | `#0f1215` | `#f6f7f8` |
| `--oc-surface` | `#16191d` | `#ffffff` |
| `--oc-surface-2` (raised/hover) | `#1c2126` | `#eff1f3` |
| `--oc-line` (hairlines) | `#262c33` | `#e3e6e9` |
| `--oc-ink` / `--oc-ink-soft` | `#e7eaed` / `#9aa3ad` | `#16191d` / `#5c646d` |
| `--oc-accent` (EMU-blue family) | `#4f9ddf` | `#0f5fa6` |
| `--oc-signal-clear` | `#35c07d` | `#1e8e5a` |
| `--oc-signal-caution` | `#e3a63b` | `#b07514` |
| `--oc-signal-stop` | `#e05252` | `#bc3535` |

Radius `8px` (more instrumental than the game's 10/16), 4-px spacing scale. Elevation in dark =
lighter surface + hairline (no shadows); light theme may use one soft shadow level.

### Typography & layout

- **UI/body**: the repo's CJK stack (`'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui`)
  — zh-Hant primary, so the type system is CJK-first. **Data voice**: `'IBM Plex Mono',
  ui-monospace` with `font-variant-numeric: tabular-nums` for every numeral, id, digest, room
  code, and the board strip. Mono-as-display is the one deliberate aesthetic risk.
- Scale: 13px table/body · 11px uppercase eyebrows, `+0.08em` tracking (timetable headers) ·
  15px section titles · 28–32px mono stat numerals.
- **Left rail nav** (208px ↔ 56px icons; lucide, `size={16}`): 總覽 Overview · 使用者 Users ·
  對局 Games · 房間 Rooms · 維護者 Maintainers · 稽核 Audit — items render only when the matching
  permission is held. **Top status strip** (~40px): health signal dot, engine/content version
  chips (mono), theme toggle, account chip with role badge, logout.
- Content: fluid full-width (no reading-column cap), real `<table>` elements, sticky headers,
  40px rows, hairline dividers, right-aligned numerics, hover highlight. Detail views open as a
  **right-side drawer** over the table so list context is never lost.
- Sparklines (commands/connections over the session): **hand-rolled SVG** — consistent with the
  repo's self-drawn-graphics ethos, zero new deps. Data accumulates client-side from the overview
  poll (no TSDB; session-local history is honest). Consult the `dataviz` skill when implementing.
- Theming: `data-theme` on `<html>`, **dark default**, pre-paint inline script in `index.html`
  (web's pattern), own localStorage key `trm.admin.theme`.
- Quality floor: AA contrast both themes, `:focus-visible` accent rings, keyboard-operable tables
  and drawers, `prefers-reduced-motion` respected, responsive to ~768px (rail collapses; tables
  scroll inside their own container).

*Anti-generic check*: not near-black + acid accent (neutral graphite + product-anchored blue);
not cream + serif (that's the game's look — the admin deliberately contrasts); no gradient-KPI
template (the hero is a subject-grounded departures board); status colors are a railway
signalling system; typography is CJK-first with a mono instrument voice.

---

## Part 2 — Server architecture

### 2.1 Shared permission taxonomy — `packages/shared/src/dashboard.ts` (new)

Shared because server enforces and admin UI gates from the same values (`@trm/shared`'s charter:
defined once so nothing drifts). Pure consts — no engine-purity impact. Export from `index.ts`.

```ts
DASHBOARD_PERMISSIONS = ['overview.read','users.read','users.ban','games.read','games.readLog',
  'games.terminate','rooms.read','rooms.close','maintainers.read','maintainers.write','audit.read']
DashboardRole = 'owner' | 'admin' | 'moderator' | 'viewer'
ROLE_PERMISSIONS: viewer = reads (overview/users/games/rooms); moderator = +users.ban,
  games.readLog, games.terminate, rooms.close; admin = +maintainers.read, audit.read;
  owner = everything (only owner has maintainers.write)
effectivePermissions(role, extra, denied) → Set   // (role ∪ extra) − denied
```

### 2.2 New module `apps/server/src/dashboard/`

```
dashboard.module.ts              # imports AuthModule + GameModule (+ Lobby/History for repos); add to app.module.ts
dashboard-config.ts              # injectable { ownerEmails } from env — auth-config.ts pattern
dashboard-account.repo.ts        # dashboardAccounts; audit.repo.ts + audit.service.ts # dashboardAudit
require-permission.decorator.ts  # @RequirePermission('x') → SetMetadata
dashboard.guard.ts               # async guard, one repo read per request
dashboard.schemas.ts             # zod DTOs (createZodDto + apiSchema)
dashboard.service.ts / dashboard-users.service.ts / dashboard-games.service.ts
dashboard.controller.ts / dashboard-users.controller.ts / dashboard-games.controller.ts /
dashboard-maintainers.controller.ts        # all under @Controller('api/v1/dashboard')
dashboard-bootstrap.ts           # onApplicationBootstrap owner seeding
```

**`DashboardAccountDoc`** (`_id` = `users._id`): `role`, `extraPermissions?`, `deniedPermissions?`,
`grantedBy` (userId or `'system:env'`), `grantedAt`, `updatedAt`. Index `{role:1}` (last-owner
count). Native-driver repo per `user.repo.ts` conventions.

**`AuditEntryDoc`**: `_id: ObjectId` (time-ordered, natural cursor), `actorId`, `actorName`
(denormalized — guests TTL-expire; the log stays self-contained), `action`
(`user.ban|user.unban|game.terminate|room.close|maintainer.grant|maintainer.update|maintainer.revoke|bootstrap.grant`),
`target?: {type,id}`, `params?`, `at`. Index `{at:-1}`. Repo exposes **only `append` + `list`** —
append-only enforced by surface (test asserts it). **Audit writes are explicit service calls**
(~7 mutating endpoints; an interceptor would need per-route metadata anyway), made *after* the
mutation succeeds, and a failed audit write throws.

**Bootstrap (decision: boot-time seeding).** Env `DASHBOARD_OWNER_EMAILS` (comma list) →
`env.dashboardOwnerEmails` in `config/env.ts` → `DashboardConfig`. `onApplicationBootstrap`: for
each email, `UserRepo.findByEmail`; if found and `!isGuest`, upsert `{role:'owner'}` as
`'system:env'`, audit `bootstrap.grant` only when something actually changed (no reboot spam);
unknown emails warn + skip. Keeps the guard at exactly one DB read (no email in the JWT); env is
authoritative at boot (self-heals accidental owner demotion). Documented trade-off: an owner
registered after boot needs a restart to be picked up.

**Guard.** Class-level `@UseGuards(AccessTokenGuard, DashboardGuard)`. DashboardGuard: guest →
**404**; no `dashboardAccounts` doc → **404** (nondisclosing, mirrors history); compute effective
permissions, attach `req.dashboard = {role, permissions}`; route metadata via
`Reflector.getAllAndOverride` — no metadata = any maintainer (only `/me`); missing permission →
**403** (caller is a proven maintainer; lets the UI distinguish). **Revocation is instant** —
permissions come from Mongo per request, never from tokens.

### 2.3 Ban (UserDoc extension + chokepoints)

`UserDoc` += optional `disabledAt?/disabledBy?/disabledReason?` (back-compat, no migration).
`UserRepo` += `setDisabled` (also `$inc tokenVersion` — free future-proofing), `clearDisabled`,
list/search queries, **new index `{createdAt:-1}`**. Enforcement (minimal diffs in existing files):

1. Ban time: `setDisabled` + existing `SessionRepo.revokeAllForUser` → refresh dies immediately.
2. `AuthService.issue()` (the single private mint path: guest/register/login/upgrade/OAuth) →
   `ForbiddenException` if `disabledAt`.
3. `AuthService.refresh()` → reject disabled after the user lookup (belt-and-braces).
4. ws-ticket minting in `LobbyService` (start/ticket/spectateTicket) → one `findById` check.

**Decision: `AccessTokenGuard` is NOT touched** — a per-request Mongo read would only close a
≤15-min window on read-mostly REST; every abusive capability (sessions, refresh, game tickets) is
closed by 1–4. Document the residual window in the ban endpoint's OpenAPI summary. An already-open
WS stays bound until disconnect; reconnect needs a fresh ticket, which is refused.

### 2.4 Endpoint surface (all zod-schema'd; global throttler untouched)

| Route | Permission | Notes |
|---|---|---|
| `GET /dashboard/me` | (any maintainer) | `{userId, displayName, role, permissions[]}` — drives UI gating |
| `GET /dashboard/overview` | `overview.read` | Counts: `games.countDocuments({status:'LIVE'})` **and** `GameRegistry.size` as `liveGames:{db,inMemory}`; rooms LOBBY/STARTED; users total/guests/registered/disabled/new-24h; active `authSessions`. Metrics via `MetricsService.registry.getMetricsAsJSON()` whitelist-flattened (`trm_active_connections`, `trm_commands_total`, rejections by code, `trm_security_leak_blocked_total`, memory, apply-time avg). Versions per `health.controller.ts` + uptime |
| `GET /dashboard/users?q&filter&limit&cursor` | `users.read` | No `q`: `{createdAt:-1,_id}` cursor. With `q`: exact `_id` ∪ anchored ci-regex on email/displayName — **escape regex metachars** (`escapeRegExp` helper). Explicit projection; never `passwordHash`/oauth subs/`tokenVersion` |
| `GET /dashboard/users/:id` | `users.read` | + `disabledBy/Reason`, locale, `activeSessions` (new `SessionRepo.countActiveForUser`), active rooms, `history` via existing `HistoryRepo.listForUser` |
| `POST /dashboard/users/:id/disable {reason?}` / `enable` | `users.ban` | Refuses self-ban and banning anyone holding a `dashboardAccounts` doc (revoke role first). Audit |
| `GET /dashboard/games?status&limit&cursor` | `games.read` | Existing `{status:1,updatedAt:-1}` index; row incl. `inMemory: !!registry.get(id)` |
| `GET /dashboard/games/:id` | `games.read` | Metadata + players (names via `HistoryRepo.displayNames`) + bots + spectators + room code (new sparse `{gameId:1}` index + `findByGameId` on RoomRepo) + chat transcript. **LIVE → redact `seed`**; never state/actions |
| `GET /dashboard/games/:id/log` | `games.readLog` | `gameEvents` ordered, **only if COMPLETED**; else 409 (inside the dashboard, be honest, not nondisclosing) |
| `GET /dashboard/games/:id/replay` | `games.readLog` | Calls `HistoryRepo.loadReplay` directly — bypasses *membership*, never the COMPLETED gate (which stays in exactly one place) |
| `POST /dashboard/games/:id/terminate {reason?}` | `games.terminate` | §2.5. Audit |
| `GET /dashboard/rooms?status&limit&cursor` | `rooms.read` | Existing index; `LobbyService.toView`-shaped rows |
| `POST /dashboard/rooms/:code/close {reason?}` | `rooms.close` | **LOBBY only** (CAS on status); STARTED-with-LIVE-game → 409 "terminate the game instead". Web lobby polls, so no push needed. Audit |
| `GET /dashboard/maintainers` | `maintainers.read` | Joined with `users`; flags dangling (TTL-expired) accounts; shows effective permissions |
| `PUT /dashboard/maintainers/:userId` / `DELETE` | `maintainers.write` (owner-only via role map) | Target must exist, `!isGuest`, not disabled; **self-modification 403** (covers self-demotion/lockout); **last-owner 409** via `countOwners()` (benign TOCTOU noted — no transactions in this codebase; boot seeding re-heals). Audit grant/update/revoke with old→new params |
| `GET /dashboard/audit?limit&cursor` | `audit.read` | Reverse-chron `_id` cursor |

### 2.5 Force-terminate — minimal hub touch

New `GameDoc.status` value **`'TERMINATED'`** (+ `terminatedAt/By/Reason?`) in
`persistence/types.ts`. All status consumers verified; two one-line hardenings in
`game-store.ts`:

- `loadForRecovery`: add `status: {$ne:'TERMINATED'}` — **critical**, else a member reconnect
  resurrects the game (keep COMPLETED rehydration working, hence `$ne` not `'LIVE'`).
- `recordCompletion`: CAS the games update to `{_id, status:'LIVE'}` so a racing bot move reaching
  GAME_OVER can't overwrite TERMINATED→COMPLETED.

Service flow: **(1)** CAS `LIVE→TERMINATED` (0 matched → 404 unknown / 409 not-live) →
**(2)** `hub.evictMatch(gameId, msg)` → **(3)** `RoomRepo.closeByGameId` (STARTED→CLOSED) →
**(4)** audit. DB flips *before* eviction so a racing reconnect hits the recovery filter.

`hub.evictMatch` — the **only** `hub.ts` change, purely additive: drain via
`match.queue.run(async () => {})` (serializes behind in-flight commands); send all members +
spectators a `rejectionFrame(0, RejectionCode.NOT_IN_GAME, 'errors:gameTerminated', message)`
(**no proto/codec changes** — reuses the existing frame + a new messageKey string); delete
`members/spectators/bots/chatLog/lastCamera` entries; `registry.remove(gameId)`. Bot driver needs
no change (`driveBots` re-fetches from the registry each iteration and exits). Terminated games
produce no `matchHistory` entry and are not replayable — correct, no final scores exist.

---

## Part 3 — `apps/admin` app

Scaffold mirrors `apps/web` (trimmed): deps `@trm/shared`, react 19, zustand 5, i18next +
react-i18next, lucide-react; dev deps vite **^5.4**, @vitejs/plugin-react, vitest 2 + RTL + jsdom,
TS 5.7. Scripts identical to web (`lint: eslint src`). `vite.config.ts`: **`base:'/admin/'`**,
port 5174, proxy `/api`→:3001 (no `/ws` — REST-only), embedded vitest config like web's.
`index.html`: pre-paint theme script defaulting **dark** (`trm.admin.theme`), title
「TRMission 維運後台」.

```
src/
  main.tsx, App.tsx            # booting gate → LoginView | DeniedView | shell (rail + strip + active view)
  net/rest.ts                  # trimmed copy of web's (in-memory token, single-flight 401→refresh→retry) + dashboard api methods
  store/session.ts             # booting → unauthenticated | denied | ready; hasPermission()
  store/ui.ts                  # hand-rolled router (web's pattern), BASE '/admin'
  i18n/index.ts                # zh-Hant primary + en fallback (compact admin set)
  styles/tokens.css, admin.css # Part 1 tokens + component styles
  components/                  # DataTable, CursorPager, StatTile, Sparkline, SignalBadge, Drawer, ConfirmDialog, PermissionGate
  views/ LoginView DeniedView OverviewView UsersView UserDetailView GamesView GameDetailView
         RoomsView MaintainersView AuditView
```

- `session.restore()`: `api.me()` (refresh-cookie path) → guest → `denied`; else
  `api.dashboardMe()` → 404 → `denied`; ok → `ready` with permission Set. `login()` uses the
  existing `/auth/login` (same-origin Strict cookie works); DeniedView states plainly that the
  session is also a game login and offers logout.
- **OAuth**: not reimplemented (its callback redirects to the game SPA). LoginView links to the
  main app's `/login` — the shared refresh cookie then restores in the admin app (domain-scoped
  cookie: works in prod same-origin and in dev across :5173/:5174).
- Routes: `/admin` `/admin/users(/:id)` `/admin/games(/:id)` `/admin/rooms` `/admin/maintainers`
  `/admin/audit` `/admin/login`. Nav items and action buttons render only with the matching
  permission; server protections (self-row, last-owner) render as disabled controls.
- Views: Overview (departure-board strip, 10s poll, sparklines, signal legend, version chips);
  Users (search + filter + cursor table → drawer with history/sessions + disable/enable w/
  reason ConfirmDialog); Games (status tabs, `inMemory` badge → drawer: metadata, players, chat;
  log/replay panels only when COMPLETED + `games.readLog`; Terminate with confirm+reason);
  Rooms (+ Close for LOBBY); Maintainers (role editor + extra/denied permission checkboxes);
  Audit (reverse-chron table). Use the `frontend-design` + `dataviz` skills when building.

## Part 4 — Deployment (same-origin) & config

- `apps/web/Dockerfile`: add `RUN yarn workspace @trm/admin build` +
  `COPY --from=build /app/apps/admin/dist /usr/share/nginx/html/admin`.
- `apps/web/nginx.conf`: `location ^~ /admin { try_files $uri $uri/ /admin/index.html; }`
  (before the SPA fallback; `^~` beats the OG regex locations).
- Compose: `DASHBOARD_OWNER_EMAILS: ${DASHBOARD_OWNER_EMAILS:-}` on the server service; update
  `.env.example`, root + server CLAUDE.md env lists, README dev note
  (`yarn workspace @trm/admin dev` → `http://localhost:5174/admin/`).

## Part 5 — Testing & verification

**Server e2e** (vitest + mongodb-memory-server via `test/app.ts`; extend `TestAppOptions` with a
`dashboardConfig` override mirroring `authConfig`):

- `dashboard-auth`: 401/404/403 posture matrix; guest 404; **instant revocation** (delete account
  doc → same token 404s); extra/denied permission arithmetic.
- `dashboard-bootstrap`: seeding, idempotent reboot (single audit row), unknown email skipped.
- `dashboard-ban`: login 403 / refresh 401 / ticket 403 after ban; stale access token still reads
  (pins the documented ≤15-min window); unban restores; self-ban + ban-a-maintainer refused.
- `dashboard-terminate` (the risky one): real-protobuf socket bind → terminate → members+spectators
  got the `errors:gameTerminated` rejection frame; game TERMINATED, room CLOSED, registry empty;
  fresh ticket + hello → NOT_IN_GAME (resurrection blocked); repeat terminate → 409.
- `dashboard-maintainers`: CRUD, owner-only write, self-modification 403, last-owner 409, audit
  rows for every mutation, audit repo has no update/delete surface.
- `dashboard-read`: overview counts + metric keys; regex-escape probe (`q="a+b"`); **LIVE game
  detail JSON contains no `seed` key anywhere** (mini leak test); log 409 for LIVE; replay 200
  for COMPLETED without membership.
- **Full existing suite must pass untouched** — especially `wire-game.e2e` (leak guard),
  `persistence.spec`, `bots.e2e`, auth suites. No engine/proto/codec edits anywhere in this plan.

**Admin app**: session gate tests (guest/404→denied), nav + action permission-gating, table
rendering from mocked fetch, router mapping — vitest + RTL like web.

**End-to-end verification**: `docker compose up -d mongo` → server dev with
`DASHBOARD_OWNER_EMAILS=<your email>` → register that account → `yarn workspace @trm/admin dev` →
log in at `http://localhost:5174/admin/`, walk every view in both themes; start a bot game from
the web app and watch Overview counts move; terminate it from the dashboard and confirm the web
client lands back in the lobby gracefully; confirm `/docs` shows the new tagged endpoints. Run
the `verify` skill before committing each phase.

## Part 6 — Sequencing (each step independently verifiable, committed per repo convention)

1. **Shared taxonomy** (`@trm/shared` dashboard.ts + `effectivePermissions` unit test).
2. **Server foundation** (env, config, repos, decorator, guard, bootstrap, module, `/me`) →
   auth + bootstrap specs.
3. **Read-only endpoints** (overview, users, games, log/replay, rooms, audit + new indexes) →
   read spec. *No mutation risk yet.*
4. **Ban** (UserDoc fields, chokepoints, endpoints) → ban spec + full auth/lobby regression.
5. **Terminate + room close** (status union, recovery/completion filters, `evictMatch`,
   endpoints) → terminate spec + **entire server suite**.
6. **Maintainers CRUD** → maintainers spec.
7. **Admin shell** (scaffold, rest/session/ui, i18n, tokens.css, Login/Denied, nav gating).
8. **Admin views** (Overview → Users → Games/Rooms → Maintainers/Audit; moderation buttons last).
9. **Deploy + docs** (Dockerfile, nginx, compose env, CLAUDE.md/README/.env.example) →
   compose build + `/admin/` smoke test.

### Risk containment

| Touch | Containment |
|---|---|
| `ws/hub.ts` | One additive method; drains via match queue; wire e2e suite is the gate |
| `persistence/game-store.ts` | Two one-line status-filter changes + resurrection test |
| `auth/auth.service.ts` | One check in the single `issue()` chokepoint + one in `refresh()` |
| `auth/access-token.guard.ts` | **Not touched** (decision — ban window documented instead) |
| proto / codec / engine | **Not touched** (termination reuses `rejectionFrame` + a messageKey) |

### Critical files

- `apps/server/src/ws/hub.ts` — `evictMatch` (only realtime-path touch)
- `apps/server/src/persistence/game-store.ts` + `types.ts` — status union + recovery filters
- `apps/server/src/auth/user.repo.ts` — disabled fields, search, `createdAt` index (repo template)
- `apps/server/src/auth/auth.service.ts` — ban chokepoints
- `apps/server/src/app.module.ts` — module registration
- `packages/shared/src/dashboard.ts` (new) — permission taxonomy
- `apps/web/src/net/rest.ts` + `apps/web/src/store/ui.ts` — templates the admin app trims/mirrors
- `apps/web/Dockerfile` + `apps/web/nginx.conf` — deployment
