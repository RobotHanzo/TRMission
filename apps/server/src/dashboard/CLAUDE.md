# CLAUDE.md

`src/dashboard/` is the REST surface for `apps/admin`, under `api/v1/dashboard`.

Access control is a **separate collection**, `dashboardAccounts` (`_id = users._id`, role +
`extraPermissions`/`deniedPermissions`) — never a flag on `UserDoc`. The role→permission taxonomy
lives in `@trm/shared` (`effectivePermissions`) so the server guard and the admin UI can't drift.
`DashboardGuard` runs after `AccessTokenGuard` and reads the collection **per request** (revocation is
instant; nothing is embedded in tokens): guest or no record → **404** (nondisclosing), missing
`@RequirePermission(...)` permission → **403**.

Every mutation appends to `dashboardAudit` via `AuditService` — that repo exposes only `append`/`list`
(append-only by surface; a spec pins it).

## Rules that bite here

- **Hidden info**: a LIVE game's detail redacts `seed` (seed + contentHash = deck order = every hand)
  and never exposes state or the action log; log/replay endpoints stay hard-gated on
  `status: 'COMPLETED'` (the gate lives only in `HistoryRepo.loadReplay` — the dashboard bypasses
  _membership_, never the gate).
- **Ban** (`users.ban`): sets `disabledAt` + revokes all refresh families; enforcement chokepoints are
  `AuthService.issue()`/`refresh()` and the lobby's three ws-ticket paths. `AccessTokenGuard` is
  deliberately untouched — already-issued access tokens keep read-only REST for ≤15min (documented on
  the endpoint).
- **Feature grants** (`users.features`, admin+): `PUT /dashboard/users/:id/features` replaces a
  registered account's `UserDoc.features` set (guests → 400) and `GET /dashboard/users/features` lists
  granted accounts; audited as `user.features` with before/after. Grants/revokes apply on the target's
  very next request (per-request reads, like the ban posture).
- **Terminate** (`games.terminate`): DB CAS `LIVE→TERMINATED` **first**, then `hub.evictMatch` (drains
  the match queue, notifies sockets with `errors:gameTerminated`, clears registries), then the room
  closes. `loadForRecovery` refuses TERMINATED (reconnects can't resurrect) and `recordCompletion`
  CASes on LIVE (a racing bot game-over can't overwrite). Terminated games are never archived or
  replayable.
- **Global config** (`config.features`, admin+): two singletons the admin app's Features panel edits —
  `PUT /dashboard/config/features` (default feature flags) and `PUT /dashboard/config/official-maps`
  (which shipped maps players may pick; at least one must stay on, and a switch-off never touches a
  running game or its replay — `src/maps/CLAUDE.md`). Audited as `config.features` /
  `config.officialMaps` with before/after.
- **Lockout protections**: self-modification of your own maintainer record is always 403; the last
  owner can't be demoted/revoked (409); maintainers can't be banned until their access is revoked
  (`src/account/CLAUDE.md` — deletion returns 409 for the same reason).

## Env vars

- `DASHBOARD_OWNER_IDS` — comma list of registered accounts' `users._id` (**NOT emails**) granted the
  `owner` role at every boot: idempotent, self-healing, audited. By id, not email, since anyone can
  self-register an arbitrary unverified email via `POST /auth/register`. Other maintainers are managed
  from the dashboard itself.
- `GAME_PAUSED_PURGE_HOURS` — `purge.service.ts` ENDS games that stay paused past this window via the
  normal scored `END_GAME` path (see `src/ws/CLAUDE.md` for how a game gets paused).
