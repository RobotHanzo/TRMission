# Full-room join falls back to spectating

## Problem

`POST /rooms/:code/join` on a `LOBBY` room whose `members` already number `maxPlayers` rejects with
`400 room is full`. This traps a joiner who follows a share link or types a room code moments too
late: they get an error card and have to be told separately to try watching. The room's spectating
feature is already fully built (data model, server ops, WS binding, lobby UI) — this closes the one
gap where a full lobby doesn't use it.

## Goal

When a join lands on a full `LOBBY` room and the room allows spectating, seat the joiner as a
spectator instead of rejecting them, and tell them so once. When a seat later opens, they use the
existing manual "join as player" (`becomePlayer`/`rejoinRoom`) flow — no auto-promotion.

## Non-goals

- No spectator cap (matches the existing unlimited-spectator behavior for started games).
- No change to `addBot`, `becomePlayer`, or any other `'full'`-returning path — only human `join()`
  against a full lobby gets the fallback.
- No auto-promotion of a spectator into a seat that frees up; the existing manual claim flow covers it.

## Design

### Server — `apps/server/src/lobby/room.repo.ts`, `RoomRepo.join`

Today, once `room.members.length >= room.maxPlayers`, `join` unconditionally returns `'full'`.
Change `join` as follows:

0. Before the capacity check (and unconditionally, whether or not the room is full): if the joiner
   is already in `spectators`, return the room unchanged. `join` never promotes a spectator to a
   seat, full room or not — that stays the explicit, manual `becomePlayer`/`rejoinRoom` action, per
   the "manual claim" decision above. This also makes repeated full-room joins idempotent (no
   duplicate `spectators` entries).
1. Otherwise, once `room.members.length >= room.maxPlayers`, merge
   `{ ...DEFAULT_ROOM_SETTINGS, ...room.settings }` and check `allowSpectating`:
   - `false` → unchanged behavior: return `'full'` (REST still 400s "room is full"). This reuses the
     one flag that already gates every other spectate path (`becomeSpectator`, `findPublic`, the
     web client's started-room spectate checks), so there's no new toggle.
   - `true` (default) → add the joiner to `spectators` and return the updated `RoomDoc`. `status`
     stays `LOBBY`; no seat, no `members` change.
2. The fallback-to-spectate branch doesn't need the existing seat-CAS retry loop — there's no seat
   index to contend over. A plain `updateOne` guarded by `'spectators.userId': { $ne: member.userId }`
   is enough; a race between two full-room joiners just means both end up in `spectators` (order
   doesn't matter).

`JoinResult`'s type is unchanged (`RoomDoc | 'not_found' | 'full' | 'started' | 'already'`) — `'full'`
is now only reachable when spectating is disabled. `LobbyService.join` needs no change: it only
throws on the literal `'full'` sentinel.

A narrow, accepted race: if a seat frees up between the capacity check and the update (another
member leaving at that exact instant), this joiner still lands as a spectator rather than claiming
the freed seat. Not worth extra complexity — they can immediately claim it via `rejoinRoom`.

### Client — one-shot notice

Two call sites hit `POST /rooms/:code/join` and both need to detect and surface the fallback once:

- `apps/web/src/screens/HomeScreen.tsx` `join()` — manual "enter a room code" join.
- `apps/web/src/screens/RoomScreen.tsx`'s poll effect (~line 147) — auto-join when a shared link
  lands a non-member on a `LOBBY` room.

Detection needs no new API field: after `joinRoom` resolves, if the current user is present in
`spectators` but absent from `members`, the join fell back to spectating.

Add a one-shot flag to `apps/web/src/store/ui.ts`, mirroring the existing `homeFocus` one-shot
pattern:

- `spectateFallbackNotice: boolean`, `setSpectateFallbackNotice()`, `clearSpectateFallbackNotice()`.
- Both call sites set it right after detecting the fallback, before navigating into the room.
- Reset to `false` in `goHome()` alongside the other transient room fields, so it can never leak
  into a later, unrelated room visit.

`RoomScreen` renders a small info banner when the flag is set (new `.notice` CSS class in
`apps/web/src/styles/app.css`, visually distinct from the existing `.error` paragraph style — e.g.
neutral/blue vs. red) and clears the flag a few seconds later, matching the hold/exit timing already
used by `NotificationChip` in `components/NotificationStack.tsx`.

### i18n

Add `fullRoomSpectateNotice` to `apps/web/src/i18n/index.ts`:

- zh-Hant (primary): "房間已滿，你已加入為觀戰者。"
- en: "Room is full — you joined as a spectator."

### Tests

- `apps/server` e2e (extend `lobby-spectate.e2e.spec.ts` or a sibling spec):
  - Full room + `allowSpectating: true` → `join` returns 200/`RoomView` with the joiner in
    `spectators`, not `members`; room stays `LOBBY`.
  - Full room + `allowSpectating: false` → `join` still 400s "room is full".
  - A user already in `spectators` calling `join` again → idempotent, no duplicate entry, and no
    promotion to a seat even if one is open.
- `apps/web`:
  - `HomeScreen.test.tsx` — `joinRoom` resolving with the user only in `spectators` sets the notice
    flag before navigating.
  - `RoomScreen.test.tsx` — same fallback via the poll-driven auto-join path renders the notice
    banner once, then it clears.
