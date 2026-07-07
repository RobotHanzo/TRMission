# Lobby spectating + spectator chat + lobby chat layout — design

**Date:** 2026-07-07
**Scope:** full-stack — `apps/server` (lobby + ws hub), `apps/web` (lobby + in-game).
**Depends on:** the existing lobby model (`RoomRepo`/`LobbyService`/`LobbyController`), the existing
post-start spectating mechanism (`GameDoc.spectators`, the hub's `members`/`spectators` connection
maps), and the existing chat stack from
[2026-06-29-action-log-and-chat-design.md](2026-06-29-action-log-and-chat-design.md) +
[2026-07-05-preset-chat-messages-design.md](2026-07-05-preset-chat-messages-design.md). This design
**reverses** two decisions from those docs: "chat is members-only; spectators read the public log
only" (2026-06-29) and "spectator preset/chat participation" being out of scope (2026-07-05).

## Goal

Three related changes to how spectating and chat work in the lobby and in-game:

1. A seated member can **demote to spectating** before the game starts — a "Spectate" button next
   to "Ready" gives up their seat (without leaving the room) and lets them watch instead. They can
   rejoin an open seat later.
2. **Spectators can chat**, both in the pre-game lobby and in-game — reversing the prior "members
   only" rule.
3. The lobby's chat block is **restyled to match the in-game chat panel** — message log on top,
   preset buttons pinned at the bottom, laid out as a column parallel to the rest of the lobby
   content, instead of today's preset-row-above-log block sandwiched into the vertical stack.

## Decisions (load-bearing)

- **One canonical spectator list, unifying two previously-disjoint mechanisms.** Today, spectating
  only exists post-start and is tracked purely at the game layer (`GameDoc.spectators` + the hub's
  in-memory `spectators: Map<gameId, Set<Connection>>`) — `RoomDoc` has no spectator concept at all.
  This design adds `RoomDoc.spectators?: RoomSpectator[]` (`{userId, displayName, isGuest}`,
  parallel to `RoomMember` minus seat/ready/bot fields) as the **one place** a spectator's identity
  lives, populated from either path:
  - a seated member demoting pre-start (new — see below), or
  - anyone minting a spectate ticket via the existing `POST :code/spectate` (post-start; unchanged
    behavior — this endpoint now _additionally_ upserts the caller into `RoomDoc.spectators`,
    alongside its existing `GameDoc.spectators` bookkeeping, which stays untouched for its own
    purpose: match-history/replay access).

  This is what lets the in-game roster (fed from `RoomView`) resolve a spectator's display name
  regardless of how they came to be watching, instead of only knowing about lobby-side demotions.

- **Demoting is member-initiated only — no new visitor-facing join choice.** Landing on a
  not-yet-started room via a link still auto-joins a non-member as a seated player exactly as today
  (`RoomScreen.tsx`'s poll effect, `api.joinRoom`). The only way to become a lobby spectator is for
  an already-seated member to explicitly demote. (A prior design fork — stopping the auto-join and
  presenting new visitors with an explicit join-vs-spectate choice — was considered and rejected as
  out of scope for this pass.)
- **Demoting requires ≥2 current members and `settings.allowSpectating`.** The last remaining member
  can't demote (there'd be no one left to seat/host — they should Leave instead, which closes the
  room). Gating on `allowSpectating` matters because the existing start-time flow
  (`RoomScreen.tsx:120`) only mints a spectate ticket for a `STARTED` room when that setting is true;
  without this gate, a member could demote, then get orphaned (bounced home) the moment the host
  actually starts the game.
- **No wire/protocol changes for chat.** `Chat`/`ChatBroadcast`/`ChatEntry` already carry a bare
  `{playerId, content}` — a spectator's userId slots in identically to a player's. The entire
  in-game-chat side of this feature is a server **routing/gating** change (who may send, who
  receives the broadcast and history backfill) plus a client **rendering** fix (resolving a
  spectator's name/colour instead of mis-rendering them as seat 0 / "P1"), not a schema change.
- **Lobby chat stays preset-only.** Unchanged from the 2026-07-05 design — this pass only widens
  _who_ may send/receive it (spectators too), not _what_ can be sent.
- **The lobby chat panel is restyled by reusing the in-game `ChatPanel`'s CSS classes verbatim**
  (`chat-panel`, `chat-messages`, `chat-msg`, `chat-author`, `chat-presets`, `chat-preset-btn`)
  rather than inventing parallel styling — this is what guarantees the "looks like the in-game one"
  requirement instead of an approximation. Only the free-text input row is absent (lobby chat has no
  free text). New lobby-only layout rules (the two-column grid, the spectator list) move into a new
  `apps/web/src/styles/room.css`, matching the existing per-screen-stylesheet convention
  (`history.css`, `replay.css`, `home.css`) instead of growing the catch-all `app.css` further.

## Data model (`apps/server/src/lobby/room.repo.ts`)

```ts
export interface RoomSpectator {
  userId: string;
  displayName: string;
  isGuest: boolean;
}
```

`RoomDoc` gains `spectators?: RoomSpectator[]`. `RoomView`/`RoomViewSchema`
(`apps/server/src/lobby/lobby.schemas.ts`) gain `spectators: RoomSpectator[]` (defaulted `[]`,
mirroring how `chat` is already handled), and the web `net/rest.ts` `RoomView`/`RoomSpectator` types
mirror it.

## Server changes — lobby (`apps/server/src/lobby/`)

- **`RoomRepo.becomeSpectator(code, userId)`** → `RoomDoc | 'not_found' | 'started' | 'not_member' |
'only_member' | 'spectating_disabled'`. Validates `status === 'LOBBY'`, caller is a current member,
  `members.length > 1`, and `settings.allowSpectating`. Removes the caller from `members`
  (renumbering seats + host transfer — identical to the existing `leave()` logic), appends them to
  `spectators`.
- **`RoomRepo.becomePlayer(code, userId)`** → `RoomDoc | 'not_found' | 'started' | 'not_spectator' |
'full'`. Validates `status === 'LOBBY'`, caller is a current spectator, `members.length <
maxPlayers`. Same atomic seat-CAS retry loop as `join()`. Removes the caller from `spectators`,
  appends to `members` at the next free seat, `ready: false`.
- **`RoomRepo.leave`** widens: if the caller is in `spectators` (not `members`), simply filter them
  out of `spectators` — no seat/host/close side effects. Member-leave behavior is unchanged.
- **`RoomRepo.kick`** widens: if the target is in `spectators` (not `members`), the host may remove
  them the same way (filter from `spectators`). Member-kick behavior is unchanged.
- **`RoomRepo.sendChat`** membership check widens from "is a member" to "is a member or spectator."
- **`LobbyService`**: `becomeSpectator`/`becomePlayer` wrappers mapping the above sentinels to
  `NotFoundException`/`BadRequestException`/`ForbiddenException`, mirroring the existing `join`/
  `ready`/`kick` wrapper style. `toView()` passes through `spectators` (default `[]`).
- **`LobbyService.spectateTicket`** (existing, post-start): after the existing `allowSpectating` +
  `gameId` checks, also upsert `{userId, displayName, isGuest}` into `RoomDoc.spectators` (new
  `RoomRepo.recordSpectator(code, spectator)` — idempotent, add-if-absent by `userId`). This is the
  unification point: anyone who ever watches a room's game, lobby-demoted or not, ends up in the one
  list.
- **`LobbyController`**: `POST :code/watch` → `becomeSpectator`; `POST :code/rejoin` →
  `becomePlayer`. Both `@HttpCode(200)`, returning `RoomView`, following the existing verb-as-subpath
  convention (`:code/ready`, `:code/kick/:userId`, etc.).

## Server changes — in-game chat (`apps/server/src/ws/hub.ts`)

- **`onChat`**: change the guard from `if (!conn.binding || conn.binding.seat < 0) return;` to
  `if (!conn.binding) return;` — any bound connection, seated or spectating, may send. Length/preset
  validation and the per-connection rate limiter (`CHAT_RATE_MAX`/`CHAT_RATE_WINDOW_MS`) are
  unchanged and apply identically to spectators.
- **Broadcast fan-out**: currently only loops `this.members.get(gameId)`. Add the same
  `member.send(chatFrame(playerId, toSend))` call over `this.spectators.get(gameId)` — spectators
  (including the sender, if they're a spectator) now receive every chat broadcast.
- **`sendHistory`**: currently sends `chat: viewer === null ? [] : chatLog` on `HistoryReplay`.
  Change to always send the real `chatLog` regardless of viewer — spectators get full chat backfill
  on connect/reconnect, same as members.

## Client changes — in-game (`apps/web/src/`)

- **`store/roster.ts`**: `useRoster` widens to also ingest `RoomView.spectators` (new
  `setRoster(members, spectators)`, called from `GameScreen.tsx`'s existing room-fetch effect
  alongside `setMembers`). A spectator's roster entry carries `{displayName, isSpectator: true}` (no
  seat/bot fields).
- **`game/playerName.ts` (`usePlayerName`) / `ChatPanel.tsx` / `LogPanel.tsx`**: the seat-colour
  lookup (`SEAT_COLORS[seatOf(pid) % 5] ?? '#888'`) currently defaults an unresolved id to seat 0 —
  today a latent bug that would mis-colour any non-seated author as if they were seat 0/blue. Add an
  explicit "no seat" branch: when `pid` isn't in `snapshot.players`, render with a neutral/muted
  colour (`var(--tr-ink-soft)`) instead of the seat-0 fallback. `usePlayerName` already returns
  `m.displayName` when the roster has an entry, so once the roster carries spectators this "just
  works" for the name; only the colour fallback needs the explicit branch.
- **`ChatPanel.tsx` / `CommsPanel.tsx` / `GameStage.tsx`**: remove the `disabled`/`chatDisabled` prop
  plumbing entirely (currently `chatDisabled={isSpectator}` in `GameStage.tsx`, which disabled both
  the text input and the preset row and showed a `chat.spectatorDisabled` placeholder). Nothing sets
  this anymore once spectators can chat — dead code, delete rather than leave unused. Remove the
  `chat.spectatorDisabled` i18n key (zh-Hant + en).

## Client changes — lobby (`apps/web/src/screens/RoomScreen.tsx` + new `styles/room.css`)

- **Poll effect**: the existing "non-member on a `LOBBY` room auto-joins as a player" branch
  (`RoomScreen.tsx:108-133`) must not fire for a user already present in `room.spectators` — check
  membership in _either_ list before deciding to auto-join. A lobby spectator polling while status
  stays `LOBBY` should simply keep rendering the spectator view. When status flips to `STARTED`, the
  existing "non-member on a started room spectates if allowed" branch (`RoomScreen.tsx:117-126`,
  already calls `api.spectate` + `connectGame`) already covers a lobby spectator with no changes
  needed — they're a non-member by construction, so they fall into that exact path.
- **Button row** (`RoomScreen.tsx:460-470`):
  - Seated member (`me` defined): existing Ready button, **plus a new "Spectate" button**
    (`api.watchRoom(code)`), disabled with a tooltip when `room.members.length <= 1`. Existing
    Start (host-only)/Leave unchanged.
  - Spectator (`me` undefined, present in `room.spectators`): a **"Join as player"** button
    (`api.rejoinRoom(code)`) replaces Ready/Spectate/Start, disabled when
    `room.members.length >= room.maxPlayers`. Leave stays available.
- **Spectator list**: a new list rendered under the existing `.member-list`, same visual treatment
  (muted), showing `room.spectators`. Host gets the existing kick affordance (icon button) here too.
- **Layout**: wrap the screen's existing content in a two-column grid — `main | chat` (~320px chat
  column) — above a width breakpoint, collapsing to a single stacked column below it, mirroring how
  `.game--rail`/`.game--tray` already add a `comms` column at wide widths and collapse at ≤920px.
  Add a new `app-main--room` modifier (App.tsx's `mainClass` ternary, alongside the existing
  `app-main--home`/`app-main--game`) so the room screen gets a wider `max-width` than the default
  720px reading column — enough room for both columns.
- **Chat panel markup**: rebuilt to the same visual order as `ChatPanel.tsx` — heading → scrollable
  message list → preset button row at the bottom (today's order is reversed: preset row, then log)
  — reusing `chat-panel`/`chat-messages`/`chat-msg`/`chat-author`/`chat-presets`/`chat-preset-btn`
  verbatim (no new lobby-specific message/preset styling). No free-text input (lobby stays
  preset-only).
- **New `apps/web/src/styles/room.css`**, imported directly by `RoomScreen.tsx` (matching the
  `history.css`/`replay.css` per-screen convention): the two-column grid, the spectator-list styling,
  and the room-chat-panel's column sizing/scroll. The existing `.room-chat`/`.chip-btn`/
  `.room-chat-log` rules move out of `app.css` into this file (superseded by the restyled markup
  reusing `chat-panel`'s classes; nothing else references them).
- **`net/rest.ts`**: `RoomSpectator` type; `RoomView.spectators`; `api.watchRoom(code)` →
  `POST :code/watch`; `api.rejoinRoom(code)` → `POST :code/rejoin`.
- **i18n** (`i18n/index.ts`, zh-Hant + en): `becomeSpectator`, `becomePlayer`, a spectator-list
  heading, and tooltip strings for the two disabled states (only member / room full). Remove
  `chat.spectatorDisabled` (dead, see above).

## Error handling & edge cases

- Demoting with only one member in the room → blocked (button disabled + tooltip); use Leave
  instead.
- Demoting while `settings.allowSpectating` is false → blocked (same reasoning as the start-time
  gate).
- Host flips `allowSpectating` off _after_ someone has already demoted → that lobby spectator is
  bounced home when the game actually starts (existing `RoomScreen.tsx:120` behavior, unchanged) —
  a pre-existing edge case for any spectate-ineligible visitor, not a new gap introduced here.
- Rejoining when the room is already full → blocked (button disabled).
- Rematch (`STARTED` → `LOBBY` reset via `resetToLobby`) leaves `spectators` untouched — they carry
  over into the next round automatically, no extra code needed since that method never touches the
  field.
- A spectator's chat message arriving for a viewer whose roster hasn't loaded yet → same fallback
  posture the log/chat already has for unresolved players (`P{seat+1}`-style), except a spectator has
  no seat — falls back to the raw id rather than a seat label, until the roster fetch resolves.
- `TRM_PERSISTENCE=0` → unchanged: lobby chat and in-game chat both already degrade the same way they
  do today: no change in this design.

## Out of scope

- A visitor-facing join-vs-spectate choice for non-members landing on a not-yet-started room (the
  rejected design fork, above) — the auto-join-as-player flow for non-members is untouched.
- Free-text chat in the lobby (still preset-only, per the 2026-07-05 design).
- Any change to post-game match-history/replay spectator access (`GameDoc.spectators` stays as the
  authority there; this design only adds a _parallel_ record on `RoomDoc` for identity/UI purposes).
- Chat moderation, DMs, threads, reactions (unchanged from prior designs).
- A spectator count/badge anywhere outside the lobby's own spectator list (e.g. no in-game HUD
  spectator counter).

## Testing & verification

- **`apps/server` (vitest):** `becomeSpectator`/`becomePlayer` happy paths + every sentinel (
  `only_member`, `spectating_disabled`, `full`, `not_member`, `not_spectator`, `started`,
  `not_found`); `leave`/`kick` widened for a spectator target; `sendChat` allows a spectator sender;
  `spectateTicket` upserts `RoomDoc.spectators` idempotently; hub e2e — a spectator can send chat,
  receives the broadcast, and receives full `HistoryReplay.chat` backfill on (re)connect; the
  wire-leak e2e (`test/wire-game.e2e.spec.ts`) still passes with spectator chat flowing.
- **`apps/web` (vitest + Testing-Library):** `RoomScreen` renders Spectate/Join-as-player per role
  and disables them under the documented conditions; the poll effect doesn't re-auto-join a lobby
  spectator; `useRoster`/`usePlayerName` resolve a spectator's name and neutral colour instead of
  "P1"/seat-0 blue; `ChatPanel` no longer disables anything for a spectator viewer.
- **Manual:** demote a seated member to spectator mid-lobby, confirm the seat frees up and a new
  player can take it; confirm the demoted spectator auto-transitions to watching once the host
  starts; send chat as a spectator in both the lobby and in-game and confirm other participants see
  it correctly attributed; resize the lobby screen across the new breakpoint to confirm the chat
  column collapses/restores correctly.
