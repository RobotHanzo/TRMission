# Admin Panel: Custom Maps, Replay Viewer, Commit Hashes — Design

## Problem

Three independent gaps in `apps/admin`:

1. **No visibility into user-authored custom maps.** `apps/server/src/maps/` already has full
   CRUD/sharing for custom maps, but every operation is owner-scoped (`requireOwned`, 404-not-403).
   A maintainer has no way to list, inspect, or moderate any user's custom map.
2. **No way to watch a finished game.** `GET /dashboard/games/:gameId/replay` already exists
   (bypasses membership, still COMPLETED-only) but nothing in `apps/admin` calls it, and the
   interactive board renderer only exists in `apps/web`. There's also no admin-specific permission
   for it — the closest is `games.readLog` (moderator+), which the user wants kept separate from a
   new viewer-tier `games.viewReplay`.
3. **No build identity in the versions panel.** `OverviewView`'s existing "versions" tile shows
   `engineVersion`/`protocolVersion`/`contentHash`/`uptimeSeconds` — no commit hash exists anywhere
   in the build today for either the server or the web/admin bundle.

## Key findings that shape this design

- **`GameDoc.status` doc comment: "TERMINATED = force-closed by a maintainer; never archived,
  never replayable."** A TERMINATED game has no `matchHistory` doc (players/winners/completedAt are
  denormalized there **only on natural completion**) and its action log simply stops mid-game with
  no `GAME_OVER` event. Extending admin-replay to TERMINATED games (explicitly requested) means a
  **separate payload path sourced from `GameDoc`/`gameEvents` directly**, not `HistoryRepo.loadReplay`
  — see Feature 2. `useReplayPlayer` has no assumption that the log ends in a completed state (it
  just replays whatever actions exist and stops at `actions.length`), so the interactive player
  itself needs no changes — only the payload-building/auth path is new.
- **`games` collection docs are never deleted on completion or termination** — only an explicit
  admin "delete" hard-removes them (see the purge design). So `games.config`/`games.bots` are always
  available regardless of status, making it possible to build a replay payload uniformly from
  `GameDoc` + `gameEvents` for both COMPLETED and TERMINATED, falling back to `matchHistory` only
  for the COMPLETED-only fields (`winners`, `finalScores`).
- **Custom-map repos are 100% owner-scoped today** (`CustomMapRepo`/`MapContentRepo` — every method
  takes or filters by `ownerId`). None of the "list everyone's maps / delete any map / force-unshare
  / reassign owner" operations exist yet; all are new repo methods, additive to the existing files.
- **A custom map's "usage" isn't tracked by its own id.** A game references content by
  `contentHash` (`games.contentHash`), and a `customMaps._id` can have produced *several*
  `mapContents` docs over its edit history (each publish at `resolveForStart` time is
  insert-if-absent, keyed by the hash of that revision). `MapContentDoc.sourceMapId` is the only
  link back — usage count means: find all `mapContents` with that `sourceMapId`, then count `games`
  whose `contentHash` is in that set.
- **The web+admin Docker image is one build stage, one commit.** `apps/web/Dockerfile` builds both
  `@trm/web` and `@trm/admin` in the same stage before the nginx copy — they are always the same
  commit by construction. `apps/server/Dockerfile` is a wholly separate image/build. So "commit hash
  of server" and "commit hash of web" are genuinely independent values that can diverge whenever one
  service is redeployed without the other.
- **Vite auto-exposes any `VITE_`-prefixed process env var to `import.meta.env`** at build time with
  no extra `vite.config.ts` wiring needed — the standard way to bake a build-time constant into a
  Vite bundle from CI.
- **No permission is needed for the commit-hash feature** — it lives inside the existing
  `OverviewView`, already gated by `overview.read`.

## Feature 1: Custom Maps Admin

### Scope

A new list+drawer view, `apps/admin/src/views/MapsView.tsx`, following the exact pattern of
`RoomsView`/`GamesView` (cursor-paginated list, tabs/filter, row → `Drawer`, destructive actions
behind `ConfirmDialog`):

- **List**: every custom map, any owner, any status — id, both names (zh/en), owner (short id +
  resolved display name), revision, share status (code present y/n), last updated, usage count.
- **Drawer**: full detail (owner, dates, revision, share code if any) + a **static SVG preview**
  rendered client-side in `apps/admin` from the draft's own `cities`/`routes`/`geography` (dots +
  lines, no interactivity — this is content, not live game state, so no dependency on `apps/web`'s
  board renderer).
- **Actions** (all behind one permission tier, mirroring how `games.delete` is a single node
  covering one destructive capability rather than one node per verb):
  - **Delete** — hard-removes the `customMaps` doc. `mapContents` publications are left untouched
    (same rule as game deletion leaving `matchHistory` alone) — a past game's replay must keep
    resolving its exact content by hash forever, even after the authoring draft is gone.
  - **Force-unshare** — clears `shareCode` regardless of owner.
  - **Transfer ownership** — reassigns `ownerId` via the existing `AccountSelectorModal`
    (`filter: 'registered'`, same component `FeaturesView`/`MaintainersView` already use).

### Permissions

New entries in `packages/shared/src/dashboard.ts`'s `DASHBOARD_PERMISSIONS`:

| Permission | Grants | Default role |
|---|---|---|
| `maps.read` | list, view detail, preview | `viewer` (parity with `games.read`/`rooms.read`) |
| `maps.moderate` | delete, force-unshare, transfer | `admin` (parity with `games.delete`/`rooms.delete`) |

Added to `VIEWER_PERMISSIONS`/`ADMIN_PERMISSIONS` respectively, same shape as the existing arrays.

### Server

New repo methods (additive, existing files):

- `CustomMapRepo.listAllPage({cursor, limit})` — cursor-paginated over all owners, same
  `updatedAt`/`_id` cursor shape `dashboard-games.service.ts`'s `listGames`/`listRooms` already use.
- `CustomMapRepo.findByIdAny(id)` / `removeAny(id)` / `revokeShareCodeAny(id)` /
  `transferOwner(id, newOwnerId)` — same shape as the existing owner-scoped methods, minus the
  `ownerId` filter.
- `MapContentRepo.findBySourceMapId(sourceMapId)` — new query; needs a new
  `createIndex({sourceMapId: 1})` alongside the existing `{ownerId: 1}` index in `onModuleInit`.

New module: `apps/server/src/dashboard/dashboard-maps.controller.ts` +
`dashboard-maps.service.ts`, same shape as `DashboardGamesController`/`Service`
(`@UseGuards(AccessTokenGuard, DashboardGuard)`, per-route `@RequirePermission`):

| Method | Path | Permission |
|---|---|---|
| `GET` | `/dashboard/maps` | `maps.read` |
| `GET` | `/dashboard/maps/:id` | `maps.read` |
| `DELETE` | `/dashboard/maps/:id` | `maps.moderate` |
| `DELETE` | `/dashboard/maps/:id/share` | `maps.moderate` |
| `POST` | `/dashboard/maps/:id/transfer` | `maps.moderate` |

Detail response includes `usageCount` = `games.countDocuments({contentHash: {$in: hashes}})` where
`hashes` = all `mapContents._id` with `sourceMapId === id`. Every mutating route audits via the
existing `AuditService` (`map.delete`, `map.unshare`, `map.transfer` — new `DashboardAuditAction`
union members), body carries a `reason` (`ModerationReasonDto`, reused as-is) for delete/unshare, and
`{newOwnerId}` for transfer.

### Admin UI

- `apps/admin/src/net/rest.ts`: `listMaps(query)`, `getMap(id)`, `deleteMap(id, reason?)`,
  `unshareMap(id, reason?)`, `transferMap(id, newOwnerId)` added to `api`.
- `apps/admin/src/store/ui.ts`: `'maps'` added to `AdminView`, its path regex, and `openDetail`'s
  view union.
- `apps/admin/src/App.tsx`: new `NAV` entry (`maps.read`, a map/globe icon from `lucide-react`).
- New i18n keys in both locale tables (`nav.maps`, `maps.*` — title, columns, drawer labels, confirm
  bodies, toasts).

## Feature 2: Admin Replay Viewer

### Scope

"View Replay" button in `GamesView`'s `GameDrawer`, visible for `status === 'COMPLETED'` or
`'TERMINATED'`, gated on a new permission distinct from `games.readLog`. Opens a new tab into
`apps/web` rendering the same interactive `GameStage`+VCR-controls experience players get from
`/replay/:gameId`, authorized by a short-lived signed ticket instead of membership — the ticket
carries no session, so it works whether or not the admin's dashboard cookie is present in the new
tab.

Per the earlier decision, TERMINATED is in scope: the maintainer sees the game up to whatever
action it stopped at, no final scoreboard/winners (there are none), useful for investigating a
force-stopped game rather than a "how did it end" view.

### Permissions

New `games.viewReplay` in `DASHBOARD_PERMISSIONS`, added to `VIEWER_PERMISSIONS` (default: viewer,
per explicit request) — independent of `games.readLog` (which stays moderator+, gating the flat
action-log list, untouched).

### Server

**Ticket minting** — new endpoint on `DashboardGamesController`:

```
POST /dashboard/games/:gameId/replay-ticket    @RequirePermission('games.viewReplay')
```

`DashboardGamesService.mintReplayTicket(actor, gameId)`: loads the game, 404 if missing, 409 if
status isn't `COMPLETED`/`TERMINATED` (nothing to replay yet/never — `games.readLog`'s existing
409 wording is the precedent), audits `game.viewReplay` (new `DashboardAuditAction` member), returns
`{ticket, expiresIn}`.

**Ticket type** — `TokenService` gains `signAdminReplayTicket({gameId, actorId})` /
`verifyAdminReplayTicket(token)`, same shape as the existing `signWsTicket`/`verifyWsTicket` pair
(`AdminReplayTicketPayload = {kind: 'admin-replay', gameId, actorId}` in `auth.types.ts`). New env
var `ADMIN_REPLAY_TICKET_TTL` (default `5m`), same family as `WS_TICKET_TTL`.

**Payload source** — new `HistoryRepo.loadReplayForAdmin(gameId)`, deliberately separate from the
strict player-facing `loadReplay` (whose COMPLETED-only gate is untouched and stays the sanctioned
path for `/history/:gameId/replay`):

1. `games.findOne({_id: gameId, status: {$in: ['COMPLETED', 'TERMINATED']}})` — 404 otherwise.
2. `gameEvents.find({gameId}).sort({seq: 1})` → `actions` + `finalDigest` (last event's digest,
   same as today — this is just "digest at the last recorded action," meaningful whether or not
   that action was a genuine game-over).
3. Player list/bot info from `game.config.players` + `game.bots` (available regardless of status —
   no dependency on `matchHistory`).
4. **If** a `matchHistory` doc exists for this id (COMPLETED games only), attach
   `winners`/`finalScores`/`completedAt` from it. **Else if** `game.terminatedAt` is set, attach
   `terminatedAt`/`terminatedBy`/`terminatedReason` instead.

Update the stale comment in `dashboard-games.service.ts`'s existing `gameReplay()` ("never the
COMPLETED gate, which stays in exactly one place — `HistoryRepo.loadReplay`") to note the new
admin-ticket path is a second, deliberately more permissive gate reachable only via a minted ticket.

**Ticket-authorized fetch endpoint** — new `AdminReplayTicketGuard` (small `CanActivate`, same shape
as `OptionalAccessTokenGuard`/`DashboardGuard`): reads `?ticket=`, verifies it, confirms
`payload.gameId === params.gameId`, 404 (nondisclosing) otherwise. New controller
`apps/server/src/history/admin-replay.controller.ts`:

```
GET /api/v1/history/:gameId/admin-replay?ticket=...
```

Shapes the response identically to the existing `/history/:gameId/replay`/`gameReplay` payloads
(same `players`/`config`/`actions`/`engineVersion`/`schemaVersion`/`finalDigest` fields), plus a
`status: 'COMPLETED' | 'TERMINATED'` field and conditionally `winners`/`completedAt` **or**
`terminatedAt`/`terminatedBy`/`terminatedReason`, never both.

### apps/web

- `store/ui.ts`: new view `'adminReplay'`, route `/admin-replay/:gameId`, parses a `?ticket=` query
  param into a `replayTicket` field alongside the existing `replayGameId`.
- `net/rest.ts`: `api.adminReplay(gameId, ticket)` → the new ticket-authorized endpoint (no
  credentials/session needed — the ticket is the sole authority).
- Refactor `ReplayScreen.tsx`: extract its `ReplayStage` inner component so both screens can render
  it — `share` becomes an optional prop (omitted ⇒ `ReplayShare` doesn't render, since an admin
  isn't the map's owner and shouldn't be toggling its visibility).
- New `apps/web/src/screens/AdminReplayScreen.tsx`: thin wrapper — fetches via `api.adminReplay`
  instead of `api.replay`, `initialViewer` defaults to `null` (neutral/spectator projection; an
  admin is never a seated player, but `PerspectiveSwitcher` still lets them flip to any seat), skips
  the "sign in" / "back to history" branches (this route has no history-flow context — it's a
  standalone tab opened from the dashboard), shows a small status banner distinguishing "completed"
  vs. "terminated — log ends here, no final result" using the payload's `status` field.

### Admin UI

- `apps/admin/src/net/rest.ts`: `mintReplayTicket(gameId)`.
- `GamesView.tsx`'s `GameDrawer`: "View Replay" button, gated on `games.viewReplay`, visible for
  `COMPLETED`/`TERMINATED`. On click: mint ticket →
  `window.open(window.location.origin + '/admin-replay/{id}?ticket={t}', '_blank')`. This only
  resolves correctly in the production nginx deployment, where `apps/web` and `apps/admin` are
  genuinely same-origin (`apps/admin/CLAUDE.md`'s documented invariant). In local dev the two apps
  run on separate Vite ports (`:5174`/`:5173`) with no existing precedent for cross-app dev linking
  either direction — this feature is verified against the built image (`docker compose`'s full
  profile) rather than the split dev servers; call this out in the PR/testing notes rather than
  building one-off dev-only origin config for a link that has nowhere else to be used yet.
- New i18n keys: `games.viewReplay`, `games.replayNotAvailable` (409 case), plus
  `history.terminatedReplayNotice`/`history.completedReplayNotice`-style keys reused/added in
  `apps/web`'s i18n table.

## Feature 3: Commit Hash Display

### Build plumbing

- `.github/workflows/docker-build.yml`: add `build-args: GIT_COMMIT=${{ github.sha }}` to the
  `docker/build-push-action@v6` step (applies to both matrix legs — server and web).
- `apps/server/Dockerfile`: `ARG GIT_COMMIT=dev` + `ENV GIT_COMMIT=$GIT_COMMIT` in the `run` stage
  (ARGs don't cross `FROM` boundaries, so it must be redeclared after the second `FROM`).
- `apps/web/Dockerfile`: `ARG GIT_COMMIT=dev` in the `build` stage, then
  `ENV VITE_COMMIT_HASH=$GIT_COMMIT` before the two `yarn workspace ... build` lines — Vite inlines
  any `VITE_`-prefixed process env var into `import.meta.env` automatically, no `vite.config.ts`
  change needed. Since both `@trm/web` and `@trm/admin` build in this same stage, they always get
  the identical value (by construction — same commit, same image).
- Local/dev builds never set `GIT_COMMIT` → both sides fall back to a `'dev'` placeholder.

### Server

- `apps/server/src/config/env.ts`: add `gitCommit: process.env.GIT_COMMIT ?? 'dev'`.
- `apps/server/src/dashboard/dashboard.service.ts`'s `overview()`: add `commitHash: env.gitCommit`
  to the `versions` object. `dashboard.schemas.ts`'s `OverviewSchema.versions` gains the matching
  field.
- `apps/server/src/health/health.controller.ts`'s `/version`: add the same field for consistency
  (near-zero cost, keeps the two endpoints from drifting — they already return the same three
  fields today).

### Web/admin

- `apps/admin/src/net/rest.ts`'s `Overview` interface: add `commitHash: string` to `versions`.
- `apps/admin/src/views/OverviewView.tsx`: read `import.meta.env.VITE_COMMIT_HASH ?? 'dev'` for the
  web-side value; render both server (`data.versions.commitHash`) and web values in the existing
  "versions" tile, same short-prefix + `title`-tooltip treatment `contentHash` already gets.

### Mismatch warning

When both hashes are present and not `'dev'` and differ, render a `SignalBadge aspect="caution"` in
the versions tile (the same component already used elsewhere in this view for status signaling)
with both short hashes visible — signals a server/web version skew (e.g. one side redeployed without
the other) that a maintainer should know about. No warning when either side is a `'dev'` placeholder
(local development always "mismatches" trivially — that's not a signal worth surfacing).

## Non-goals

- No content editing of a custom map from the admin panel — moderation only (view/delete/unshare/
  transfer), never author changes to `draft`.
- No change to the existing `GET /dashboard/games/:gameId/replay` (`games.readLog`-gated,
  already-dead endpoint) — left as-is; not repurposed or removed.
- No change to the player-facing `/history/:gameId/replay` or `/history` list — the new admin path
  is fully additive and never relaxes the player-facing COMPLETED-only gate or the `replayReview`
  feature check.
- No retroactive backfill of commit hashes for already-running deployments — the very next
  build/deploy on each side starts reporting it; until then both show `'dev'`.
- No cross-service deployment coordination (e.g. blocking a web deploy until server matches) — the
  mismatch warning is informational only.

## Testing

- **Custom maps admin**: `dashboard-maps.service.spec.ts` — list/detail/usageCount aggregation
  across owners; delete/unshare/transfer permission-gated (403 without `maps.moderate`) and
  audited; delete leaves `mapContents` untouched; transfer updates `ownerId` and is reflected in a
  subsequent `listByOwner` for the new owner via the existing player-facing `MapsController`.
  `apps/admin` `MapsView.test.tsx` — list renders, drawer preview renders from draft data, actions
  hidden without `maps.moderate`, confirm-dialog required, transfer opens `AccountSelectorModal`.
- **Replay viewer**: `history.repo.spec.ts` — `loadReplayForAdmin` returns COMPLETED (with
  winners) and TERMINATED (with terminatedAt, no winners) shapes correctly, 404s for LIVE/missing.
  `dashboard-games.service.spec.ts` — `mintReplayTicket` 409s for LIVE, 404 for missing, audits on
  success. e2e: ticket-authorized `GET .../admin-replay` accepts a valid ticket scoped to the right
  `gameId`, rejects a mismatched/expired/garbage ticket with 404. `apps/admin` — button visibility
  gated on `games.viewReplay` and game status. `apps/web` — `AdminReplayScreen` renders via the
  refactored `ReplayStage` for both a COMPLETED and a TERMINATED fixture (no share panel, correct
  status banner).
- **Commit hash**: `dashboard.service.spec.ts` — `overview()` includes `commitHash` from env,
  defaults to `'dev'` when unset. `apps/admin` `OverviewView.test.tsx` — renders both hashes,
  mismatch badge appears only when both are set and differ, absent when either is `'dev'`.
- `yarn workspace @trm/server test`, `yarn workspace @trm/web test`, `yarn workspace @trm/admin test`,
  `yarn lint`, `yarn typecheck` must all pass before committing.
