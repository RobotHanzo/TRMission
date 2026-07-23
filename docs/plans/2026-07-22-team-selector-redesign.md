# Team selector redesign (lobby)

## Context

Team mode (`RoomSettings.teamCount`) already exists end-to-end — engine, wire, and both clients —
but the lobby's *team-assignment* UX is a bare-bones leftover: the flat player list grows a colored
badge and two chevron buttons (`RoomScreen.tsx:299-382`) that let the host nudge one player one seat
at a time. There's no way for players to pick their own side, no bulk/random shuffle, and the visual
design doesn't read as "these are the two teams" — it reads as "here's a list with a tag on it."

The user wants a proper team selector that **replaces** the flat member list whenever team mode is
on (`teamCount > 0`), with three room-owner-configurable assignment modes:

- **Random** — the host presses a button to shuffle everyone into new teams.
- **Host-assigned** — the host manually places players onto a team (today's only mode, redesigned).
- **Self-join** — any player picks their own team (does not exist today — needs new server support).

This ships on both `apps/web` and `apps/mobile` off one shared logic layer, per the project's
"never implement the same client logic twice" rule.

## Visual design

The app's existing team palette (`TEAM_COLORS` — blue #1F6FB2 / red #C1443C / green #3F8F4A, see
`packages/client-core/src/theme/colors.ts:72`) and chrome tokens (`--tr-*`) stay canonical — this is
a redesign of an existing product surface, not a new brand. The signature move: turn "which team am
I on" into **platform boards** — one column per team, headed by a colored ribbon (the team's own
color), instead of a flat list with a tag. It's a restrained nod to the game's railway theme (a
colored departure board per line) without adding new imagery or fonts.

- `.team-board`: flex row of `.team-column` cards (wraps to stacked columns on narrow widths),
  reusing `--tr-surface`/`--tr-line`/`--tr-radius-lg`.
- `.team-column-header`: solid ribbon in `teamColor(team)`, white text, team name + `x/y` seated
  count — the "departure board" identity per column.
- `.team-chip`: the existing member-row content (seat dot, bot icon, name, host/you tags,
  ready/bot badge, host's kick/transfer/remove-bot icon buttons — unchanged from today) restyled as
  a card row inside its column. Host powers (kick/transfer/remove bot) stay available in **every**
  assignment mode; only the *team-move* affordance changes per mode.
- Interaction model — **tap-to-select, tap-to-place** (not drag-and-drop): clicking a chip in
  host-assign mode "picks it up" (`.team-chip.selected`, small lift + outline); clicking a *different*
  column swaps that player in. This is one interaction model implementable identically with
  `<button>`/`Pressable` on both platforms — no new dependency, fully keyboard/touch accessible.
  Self-join mode instead shows a small "Join" button on each column that isn't your own.
  Random mode's columns are read-only; a "Shuffle teams" button (host-only, `Shuffle` lucide icon)
  sits above the board.
- Motion: a chip that lands in a **new** column (its React parent changed) plays a brief
  opacity/translateY entrance via a CSS keyframe on `.team-chip` — it fires naturally on remount,
  not on every re-render (e.g. toggling ready doesn't replay it). No new animation system.

## Data model

Add one field, defaulting to today's exact behavior (host-only manual reseat) so existing rooms
need no migration:

- `RoomSettings.teamAssignMode: 'random' | 'host' | 'self'`, default `'host'`.
- Server: `apps/server/src/lobby/room.repo.ts` (`RoomSettings` interface + `DEFAULT_ROOM_SETTINGS`),
  `apps/server/src/lobby/lobby.schemas.ts` (`GameSettingsSchema` — `z.enum(['random','host','self'])`).
- Client-core: `packages/client-core/src/net/restTypes.ts` `RoomSettings`.
- Flows through the existing generic `PATCH /rooms/:code/settings` → `setSetting()` plumbing with
  zero new server logic, exactly like `teamCount` does today.

## Shared seat-math (new, in `@trm/shared`)

`packages/shared/src/teams.ts` already owns `teamOfSeat`/`seatsOfTeam`/`TEAM_LAYOUTS` — extend it
with two pure helpers used by the server AND both clients (no client-core module needed; this is
lobby seat math, not `GameSnapshot` view logic):

```ts
/** New seat order (userId per seat, index = seat) after swapping `userId` onto `targetTeam` with
 *  that team's lowest-seat current occupant. Null if `userId` is already on `targetTeam`, or no
 *  seat currently belongs to it (fewer members than `teamCount`). */
export function seatOrderMovingToTeam(
  members: readonly { userId: string; seat: number }[],
  userId: string,
  targetTeam: number,
  teamCount: number,
): string[] | null

/** A random full reseat (Fisher–Yates over the current members) — used by the host's shuffle
 *  button. Math.random is fine here: this is UI-triggered lobby cosmetics, not `@trm/engine`. */
export function shuffleSeatOrder(members: readonly { userId: string }[]): string[]
```

`seatOrderMovingToTeam` is the one seat-swap primitive reused three ways: server-side by the new
self-join endpoint, and client-side (web + mobile) by host-assign mode's tap-to-place handler
(which then calls the existing host-only `reseatRoom`).

## Self-join server support (new)

Self-join needs a non-host mutation path that doesn't exist today (`reseat`/`RoomRepo.reseat` stay
strictly host-only, untouched). Add one narrow endpoint instead of loosening `reseat`'s auth:

- `apps/server/src/lobby/room.repo.ts`: `RoomRepo.joinTeam(code, userId, team)` — loads the room,
  requires `status==='LOBBY'`, `settings.teamAssignMode==='self'` (else `'mode_disabled'`), `team` in
  `[0, teamCount)` (else `'invalid_team'`), caller is a seated member (else `'not_member'`), then
  calls `seatOrderMovingToTeam`; a `null` result means "already on that team" (`'already'`) — resolve
  which by checking `teamOfSeat(me.seat, teamCount) === team` first. On success, apply the swap and
  reset **only the two swapped members'** ready flags (not everyone's — unlike `reseat`, only their
  team actually changed), matching the `bot ⇒ always ready` rule.
- `apps/server/src/lobby/lobby.service.ts`: `LobbyService.joinTeam(code, user, team)` — maps repo
  results to `NotFoundException`/`BadRequestException`/`ForbiddenException`, mirroring `reseat()`'s
  existing pattern (`lobby.service.ts:365-373`).
- `apps/server/src/lobby/lobby.schemas.ts`: `JoinTeamSchema = z.object({ team: z.number().int().min(0).max(2) })`.
- `apps/server/src/lobby/lobby.controller.ts`: `POST :code/team` → `lobby.joinTeam(...)`, same shape
  as the `:code/seats` route right above it (`lobby.controller.ts:201-208`).
- `packages/client-core/src/net/rest.ts`: `joinTeam: (code, team) => req<RoomView>('POST', \`/rooms/${code}/team\`, { team })`,
  next to `reseatRoom` (`rest.ts:219-222`).

## Web (`apps/web`)

- New `apps/web/src/components/TeamSelector.tsx`: props = `{ room, isHost, myUserId, mode }` +
  action callbacks (`onShuffle`, `onAssign(userId, team)`, `onJoinTeam(team)`, plus the existing
  `kick`/`transferHost`/`removeBot` handlers `RoomScreen` already owns). Renders the `.team-board`
  described above; internal `selectedUserId` state drives host-assign tap-to-place.
- `apps/web/src/screens/RoomScreen.tsx`: when `teamCount > 0`, render `<TeamSelector .../>` in place
  of the `<ul className="member-list">` block (299-382); keep it unchanged for `teamCount === 0`.
  Wire `onAssign`/`onShuffle` through `seatOrderMovingToTeam`/`shuffleSeatOrder` → `api.reseatRoom`;
  `onJoinTeam` → `api.joinTeam`. Add one new `setting-row` right under the existing `teamCount`
  `Segmented` (508-540) for `teamAssignMode` (only shown while `teamCount > 0`), same `Segmented`
  pattern as the map/events/team-count pickers.
- `apps/web/src/styles/game.css`: extend the existing "── team mode ──" block (2390-2525) with
  `.team-board`, `.team-column`, `.team-column-header`, `.team-chip` (+`.selected`), `.team-drop`,
  `.team-shuffle-btn`, `.team-join-btn`, and the entrance keyframe — reusing `--tr-*` tokens
  throughout, no new palette.
- i18n: `packages/client-core/src/i18n/locales/{en,zh-Hant}/gameSettings.ts` — add
  `settingTeamAssignMode(Desc)`, `teamAssignModeRandom/Host/Self`, `shuffleTeams`, `teamJoinButton`,
  `teamHintRandom/Host/Self`. Reuse the already-present-but-unused `teamSeatingTitle`/`teamSeatingHint`
  keys (`gameSettings.ts:35-36`) as the board's default heading/hint.
- `apps/web/src/screens/RoomScreen.test.tsx`: extend for the new team-mode render path (team columns
  present, flat list absent when `teamCount>0`, mode-specific controls visible/hidden correctly).

## Mobile (`apps/mobile`)

- New `apps/mobile/src/components/TeamSelector.tsx` (RN): same prop contract as web's, built from
  `View`/`Pressable`/`Text` + the existing `Card`/`SectionLabel` chrome primitives and
  `theme/colors.ts` `teamColor`/`seatColor` — mirrors web's structure, not its DOM.
- `apps/mobile/src/screens/RoomScreen.tsx`: same substitution (member `View` loop at 299-388 →
  `<TeamSelector/>` when `teamCount>0`) and the same new `SettingRow` for `teamAssignMode` next to
  the existing team-count `Chips` row (527-552).
- Reuses the exact same `@trm/shared` helpers and `@trm/client-core` `api.joinTeam`/`reseatRoom` —
  no logic duplicated, only the RN rendering is new.

## Verification

- `yarn workspace @trm/shared test` — new tests for `seatOrderMovingToTeam` (swap correctness,
  null on already-on-team / team with no current occupant) and `shuffleSeatOrder` (permutation
  invariant).
- `yarn workspace @trm/server test --run lobby-teams` — extend `apps/server/test/lobby-teams.e2e.spec.ts`
  with: `teamAssignMode` persists via settings PATCH; `POST :code/team` succeeds in self mode and
  swaps exactly two members' seats/ready flags; 403/400 for `mode_disabled`/`invalid_team`/
  `not_member`; still-host-only `reseat` behavior is unchanged (existing cases keep passing).
- `yarn workspace @trm/web test` / `yarn workspace @trm/mobile test` — updated `RoomScreen` specs
  + new `TeamSelector` unit tests per platform.
- `yarn typecheck && yarn lint` at the repo root (new field touches server/shared/client-core/web/mobile).
- Manual: `yarn workspace @trm/server dev` + `yarn workspace @trm/web dev`, open two guest tabs in a
  6-seat room, turn on team mode, exercise all three assignment modes end-to-end (shuffle as host;
  drag—i.e. tap-select-place—as host; join-a-team as a non-host guest), then start the game and
  confirm `state.teams` matches the lobby's final arrangement. Repeat the self-join + host-assign
  flows on `yarn workspace @trm/mobile web` (Playwright-drivable RNW harness) for mobile parity.
