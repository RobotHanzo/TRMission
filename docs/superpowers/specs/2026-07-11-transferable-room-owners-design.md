# Transferable room owners — design

## Goal

Room ownership transfer already exists (`2026-07-10` design), but only as a forced choice inside
the host's _leave_ flow — a host who wants to stay in the room can't hand off ownership. Two
additive gaps to close, both reusing the existing `hostId` / `transferHost` machinery:

1. **Standalone transfer (player-facing).** The host picks a new owner without leaving the room.
2. **Admin/dashboard reassignment.** A maintainer can reassign a stuck lobby's host (e.g. an AFK
   owner blocking other players) without closing or deleting the room.

## Decisions (load-bearing)

- **No new transfer semantics.** Both surfaces call into the same validation rules the existing
  `transferHost` already enforces: LOBBY-only, target must be a seated **non-bot** member, target
  ≠ current host. Nothing here changes what a valid transfer target looks like.
- **Player surface has zero backend changes.** `POST /rooms/:code/transfer/:userId`
  (`apps/server/src/lobby/lobby.controller.ts:83`) already works outside the leave flow — this is
  purely a new web UI call site.
- **Admin surface needs a host-agnostic repo path.** The existing `RoomRepo.transferHost(code,
hostId, targetId)` (`apps/server/src/lobby/room.repo.ts:548`) CASes on the _caller_ already being
  the current host — that's wrong for a moderator, who isn't a room member. A new
  `RoomRepo.transferHostAdmin(code, targetId)` skips the caller-is-host check but keeps every other
  validation (LOBBY status, seated/non-bot target, target ≠ current host), CASing only on
  `status: 'LOBBY'`.
- **LOBBY-only on both surfaces.** No transfer once a game has started, matching every other
  host-gated room mutation. A live game's host is out of scope for this change.
- **Targets are seated humans only, on both surfaces.** No promoting spectators, matching the
  existing player-facing constraint.
- **Moderator-tier permission.** `rooms.transferHost` is corrective, not destructive (unlike
  `rooms.delete`) and is useful for unsticking a lobby without full admin escalation — same tier as
  `rooms.close`.
- **Reason field follows the existing moderation-action convention.** Every other dashboard
  moderation endpoint (`rooms.close`, `rooms.delete`, `users.ban`, ...) takes an **optional**
  free-text `reason` via `ModerationReasonDto` (`apps/server/src/dashboard/dashboard.schemas.ts:42`)
  — the admin UI's `ConfirmDialog withReason` shows the field but never enforces it. Admin transfer
  follows the same convention rather than inventing a new required-reason rule.

## Part 1 — Standalone transfer (player-facing)

**Web (`apps/web/src/screens/RoomScreen.tsx`)**

- Add a "Make owner" icon button to the member-list row, alongside the existing kick button
  (`RoomScreen.tsx:343-352`): host-only, hidden for bots and for the host's own row, shown for every
  other seated non-bot member.
- New `useConfirmAction()` instance (`apps/web/src/hooks/useConfirmAction.ts`) — same pattern as
  the existing leave/close confirms (`RoomScreen.tsx:574-589`) — gates the click behind a
  `ConfirmDialog` before calling `api.transferOwnership(code, targetId)`.
- No leave/close side effects — the host stays seated, the room stays open; the member list
  re-renders on the next 2 s poll with the new `hostId`.
- New i18n keys: `transferConfirmTitle`, `transferConfirmBody`, `makeOwner` (zh + en, generic
  wording, no name interpolation — matches how `leaveConfirmBody`/`closeRoomConfirmBody` are
  worded today).

**Server** — no changes. Reuses `POST /rooms/:code/transfer/:userId` /
`RoomRepo.transferHost` / `LobbyService.transferOwnership` as-is.

## Part 2 — Admin/dashboard reassignment

**Shared (`packages/shared/src/dashboard.ts`)**

- Add `'rooms.transferHost'` to `DASHBOARD_PERMISSIONS`, and to `MODERATOR_PERMISSIONS` (so it
  flows into `admin`/`owner` automatically via the existing escalation chain).

**Server (`apps/server/src/lobby/room.repo.ts`)**

- `transferHostAdmin(code: string, targetId: string): Promise<TransferHostResult>` — fetches the
  room; `not_found` if missing; `started` if `status !== 'LOBBY'`; `invalid` if the target isn't a
  seated member, is a bot, or is already the host. Otherwise
  `updateOne({ _id: code, status: 'LOBBY' }, { $set: { hostId: targetId, updatedAt: new Date() } })`.
  Reuses the existing `TransferHostResult` union — no new result type.

**Server (`apps/server/src/dashboard/dashboard-games.service.ts` + `dashboard-games.controller.ts`)**

- `DashboardGamesService.transferHost(actor, code, targetId, reason?)` — mirrors `closeRoom`
  (`dashboard-games.service.ts:178`): 404 if room missing, 409 if not LOBBY, 400 if target invalid,
  then `audit.log(actor, 'room.transferHost', { type: 'room', id: code }, { targetId, ...(reason ?
{ reason } : {}) })`, returns the updated room row.
- `POST /dashboard/rooms/:code/transfer/:userId` on the controller
  (`dashboard-games.controller.ts`, alongside `closeRoom` at line 160): `@HttpCode(200)`,
  `@RequirePermission('rooms.transferHost')`, body `ModerationReasonDto`.

**Admin (`apps/admin/src/views/RoomsView.tsx`)**

- `api.transferRoomHost(code, userId, reason?)` in `apps/admin/src/net/rest.ts`, alongside the
  existing `closeRoom`/`deleteRoom` (`rest.ts:372-377`).
- In the drawer's "Members" section (`RoomsView.tsx:120-138`), a small "Make owner" action per
  eligible row (seated, non-bot, not already host), gated on
  `useSession(s => s.hasPermission('rooms.transferHost'))` **and** `row.status === 'LOBBY'`
  (mirroring the existing `canClose && row.status === 'LOBBY'` gate at line 183).
- Reuses the existing `ConfirmDialog withReason` component/pattern used for close/delete
  (`RoomsView.tsx:377-398`) rather than a new dialog type.
- New i18n keys: `rooms.makeOwner`, `rooms.transferConfirmTitle`, `rooms.transferConfirmBody`, plus
  a `toast.roomHostTransferred` success toast (matching `toast.roomClosed`/`toast.roomDeleted`).

## Error handling & edge cases

- Player surface: transfer to a bot / non-member / self / already-host → 400 `invalid` (existing
  `transferHost` behavior, unchanged). Transfer on a STARTED room → 400 `started`. Transfer by a
  non-host → not reachable (button only rendered for the host).
- Admin surface: same `invalid`/`started` mapping via `transferHostAdmin`; room not found → 404;
  missing permission → 403 (existing `RequirePermission` guard behavior).
- Concurrent admin transfer vs. a live player-side transfer/close/start: the admin path CASes on
  `status: 'LOBBY'` only (not on the prior `hostId`, since the admin doesn't know or care who
  currently holds it) — a concurrent status-changing action (start, close) still wins the race and
  the admin call falls through to `started`/`not_found` on its `findOne` re-check, consistent with
  how `closeRoom` already behaves under concurrency.
- No bot can ever become host on either surface (unchanged invariant from the 07-10 design).

## Testing & verification

- **Server e2e (`apps/server/test/lobby.e2e.spec.ts`)**: standalone transfer while the host remains
  seated (room stays LOBBY, host stays a member, new `hostId` set); repeat existing invalid-target
  cases now exercised outside the leave flow.
- **Server e2e (`apps/server/test/dashboard-rooms.e2e.spec.ts` or equivalent)**: admin transfer
  happy path; 403 without `rooms.transferHost`; 409/400 on a STARTED room; 400 on an invalid
  target; audit log entry recorded with `targetId`.
- **Web (`apps/web/src/screens/RoomScreen.test.tsx`)**: "Make owner" button visible only to the
  host, hidden on bot/own rows; confirm dialog calls `transferOwnership` and updates `hostId` in
  place without navigating away.
- **Admin (`apps/admin/src/views/RoomsView.test.tsx` if present, else manual + type-checked)**:
  action visible only with the permission and only for LOBBY rooms; confirm-with-reason flow calls
  the new endpoint and refreshes the row.
- Full gates: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn format:check`.

## Out of scope

- Transfer during a STARTED (live) game, on either surface.
- Promoting a spectator to host, on either surface.
- Any change to the existing leave-flow transfer-or-close dialog (`OwnerLeaveDialog`) — it keeps
  working exactly as it does today; this adds two new call sites to the same underlying operation.
- Updating `apps/server/CLAUDE.md` / `apps/web/CLAUDE.md` / `apps/admin/CLAUDE.md` with
  ownership-transfer notes (the 07-10 feature already isn't documented there either — worth a
  separate `claude-md-management` pass, not bundled into this change).
