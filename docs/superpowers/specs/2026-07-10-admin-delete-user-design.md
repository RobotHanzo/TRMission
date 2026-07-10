# Delete-user button in the admin dashboard

**Date:** 2026-07-10
**Status:** Approved (design)

## Problem

The maintainer dashboard's Users view can **disable** (ban) an account — a reversible action
that sets `disabledAt` and revokes sessions. There is no way to **permanently remove** an
account. Maintainers need a distinct, irreversible "delete account" action alongside the
existing disable button (e.g. to clear spam signups or honour an erasure request).

## Decisions (from brainstorming)

1. **Delete semantics — hard delete, keep the archive.** Permanently remove the user doc, its
   refresh sessions, and its owned custom-map drafts. Leave the completed-game match history and
   published map content as the anonymised archive — exactly how TTL-expired guests and purged
   games already behave (`matchHistory` is never touched — the house rule from `PurgeService`).
2. **Live entanglement — force through.** If the target is currently seated in LIVE games or
   active rooms, terminate those games and close those rooms as part of the delete (reusing the
   existing terminate/evict machinery), then remove the account. One action, no pre-clearing.
3. **Permission — new `users.delete`, admin+.** Delete is more severe than ban, so it lives one
   tier above the moderator-level `users.ban`, alongside the already-admin-level
   `games.delete` / `rooms.delete`.

Two smaller defaults chosen during design review:

- The delete button appears for **any** deletable account, not only already-disabled ones.
- The reason field is **optional**, matching the disable flow.

## Architecture

The change spans three packages, following patterns already in the codebase 1:1.

### `@trm/shared` — permission taxonomy

`packages/shared/src/dashboard.ts`:

- Add `'users.delete'` to `DASHBOARD_PERMISSIONS`.
- Add `'users.delete'` to `ADMIN_PERMISSIONS` (admin + owner inherit; moderator keeps
  disable-only). `owner` already gets the full list.

### `apps/server` — endpoint, service, teardown

**Controller** (`dashboard-users.controller.ts`):

```
@Delete(':id')
@HttpCode(204)
@RequirePermission('users.delete')
remove(@Param('id') id, @CurrentUser() actor, @Body() body: ModerationReasonDto)
  → this.users.delete(actor, id, body.reason)
```

`@ApiOperation` description documents the irreversible force-through consequences (LIVE games
the user is in are terminated — no scores, unreplayable; the account and its sessions/owned map
drafts are permanently deleted; completed-game history is retained as an anonymised archive).
The reason rides `ModerationReasonSchema`/`ModerationReasonDto` (already used by disable) — a
`DELETE` with a body is acceptable here and matches how disable carries its reason.

**Service** `DashboardUsersService.delete(actor, userId, reason?)` — mirrors the `disable`
guard shape:

1. `403` if `userId === actor.userId` (cannot delete yourself).
2. `404` if the user does not exist.
3. `409` if the target holds a `dashboardAccounts` record — *"target holds dashboard access —
   revoke it first"* (identical guard to `disable`; keeps the maintainer/owner lockout
   protections authoritative — you can never delete a maintainer's account while their dashboard
   access is live).
4. **Force-through teardown** → `PurgeService.terminateActiveForMember(actor.userId, userId,
   reason)` (new public method, below). Returns `{ gamesTerminated, roomsClosed }`.
5. `sessions.revokeAllForUser(userId)` — immediate session kill.
6. `customMaps.deleteByOwner(userId)` — new `deleteMany({ ownerId })` helper on `CustomMapRepo`.
7. `users.deleteById(userId)` — new `deleteOne({ _id })` helper on `UserRepo`.
8. `audit.log(actor, 'user.delete', { type: 'user', id: userId }, { reason, gamesTerminated,
   roomsClosed })`.

Returns `void` (controller sends `204`).

**Teardown** — new public method on `PurgeService` (owns all terminate/evict/close machinery):

```
/** Terminate every LIVE game and close every active room the user is seated in — the
 *  teardown half of a maintainer account deletion. Reuses the private terminate/evict
 *  path; returns counts for the audit trail. */
async terminateActiveForMember(terminatedBy, userId, reason?):
    Promise<{ gamesTerminated: number; roomsClosed: number }>
```

Implementation: `rooms.findActiveByMember(userId)` (already returns LOBBY rooms + STARTED rooms
whose game is still LIVE); for each — STARTED with `gameId` → `terminateIfLive` (existing
private: CAS `LIVE→TERMINATED`, `hub.evictMatch`, `closeByGameId`); LOBBY → `closeLobby`. Count
each. `DashboardUsersService` gains a `PurgeService` constructor dependency (both already live in
`DashboardModule`).

### What is deleted vs. kept

| Deleted                                             | Kept (the archive)                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `users` doc                                         | `matchHistory` (winner/participant ids dangle, as they already do for TTL-expired guests) |
| refresh sessions (revoked)                          | `mapContents` (immutable published content — live games/replays keep resolving) |
| owned `customMaps` drafts                           | `dashboardAudit` (denormalised `actorName`; records the deletion itself)   |
|                                                     | the user's LIVE games become `TERMINATED` records; their rooms `CLOSED` — not deleted |

### `apps/admin` — web UI

- `net/rest.ts`: `deleteUser: (id, reason?) => req<void>('DELETE',
  '/dashboard/users/:id', { reason })`.
- `views/UsersView.tsx` `UserDrawer`: a second **danger** button **"Delete account"** rendered
  below the disable/enable button, gated on `canDelete = hasPermission('users.delete')` **and**
  `!detail.isMaintainer` (matches the server's 409). Clicking opens a `ConfirmDialog`
  (`danger`, `withReason`) whose body spells out the force-through consequences. On success:
  push a `toast.userDeleted` success toast, then close the drawer (`onClose`) — the parent list
  reloads on its next mount/filter, and the deleted row is gone.

The disable/enable button and the delete button are independent: disable stays `users.ban`,
delete is `users.delete`. An admin sees both; a moderator sees only disable.

### i18n & taxonomy labels

Add to **both** the zh-Hant and en tables in `apps/admin/src/i18n/index.ts` (same key tree in
both — the file enforces this):

- `users.delete`, `users.deleteConfirmTitle`, `users.deleteConfirmBody`
- `toast.userDeleted`
- audit-action label `user.delete`
- permission label `users.delete`

`user.delete` is also added to the `DashboardAuditAction` union in
`apps/server/src/dashboard/audit.repo.ts`.

## Testing

**Server** (`dashboard-users` service + controller specs, mongodb-memory-server):

- Happy path: deleting a user removes the `users` doc, revokes its sessions, deletes its owned
  custom maps, terminates a LIVE game the user is seated in (game → TERMINATED, room → CLOSED),
  and **leaves that game's `matchHistory` archive untouched**.
- `403` deleting yourself.
- `404` deleting a non-existent user.
- `409` deleting an account that holds dashboard access.
- Permission gating: a caller without `users.delete` is refused (403 from the guard); a caller
  with only `users.ban` cannot delete.
- An audit `user.delete` row is written with the reason + counts.

**Web** (`views/UsersView.test.tsx`, testing-library):

- The delete button is hidden without `users.delete` and for a maintainer target.
- Clicking delete → confirm → issues `DELETE /dashboard/users/:id` and closes the drawer.

## Out of scope (YAGNI)

- No soft-delete/anonymise tombstone (explicitly rejected in favour of hard delete).
- No cascade scrub of the user's ids inside `matchHistory` (kept as the archive, consistent with
  guest TTL expiry).
- No bulk delete; one account at a time from the drawer.
- No new metrics counter (the audit row is the record of the action).
