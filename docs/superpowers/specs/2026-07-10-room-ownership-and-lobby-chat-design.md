# Room ownership, spectating & lobby free-text chat — design

## Goal

Five related lobby/room changes:

1. **Room owners can't spectate.** The host may not demote themselves to a spectator (lobby) and
   may not mint a spectate ticket for their own started game.
2. **Owner leaving prompts transfer-or-close.** When the host leaves a room with other human
   players present, they must either hand ownership to a chosen member (then leave) or close the
   whole room for everyone.
3. **Fix "spectate acts as a kick".** Pressing *watch* in the lobby currently trips the client's
   kicked-modal on the next poll; a self-demoted spectator should just keep watching.
4. **Lobby free-text chat.** The lobby chat is preset-only and has no text box; the in-game chat
   already supports free text. Bring the lobby to parity (keep presets, add an input).
5. **Spectating is not activity.** No spectate-related write should reset a room/game's auto-purge
   clock (all spectate actions: game-doc bind, spectate-ticket record, and lobby demote).

## Decisions (load-bearing)

- **Server stays authoritative.** Every rule (host-can't-spectate, transfer target validity,
  chat exactly-one-of, close) is enforced server-side; the web UI only mirrors it. The known egress
  and determinism invariants are untouched — these are all control-plane (REST + room doc) changes,
  no engine, no proto/wire changes.
- **Chat back-compatibility.** `RoomChatEntry` gains an optional `text`; `presetId` becomes
  optional. Exactly one is set. Existing persisted rows carry `presetId`, so they keep validating
  and rendering unchanged.
- **In-game chat is out of scope.** It already has free text over the protobuf plane; this change
  touches only the lobby's REST chat path and the room doc.
- **No bot hosts.** Ownership never lands on a bot — the transfer target must be a seated human,
  and the defensive auto-transfer in `leave()` prefers a human (closing the room if only bots
  remain).

## Part 1 — Owners can't spectate

**Server (`apps/server/src/lobby`)**

- `RoomRepo.becomeSpectator`: add a host check → new result `'is_host'` (before the `only_member`
  check). With the host excluded, the existing host-transfer branch inside `becomeSpectator` is dead
  and is removed (host never changes on a non-host demote).
- `LobbyService.becomeSpectator`: map `'is_host'` → `BadRequestException('the host cannot spectate')`.
- `LobbyService.spectateTicket`: reject a **seated member** (`seatOf(room, userId) >= 0`) →
  `ForbiddenException('players cannot spectate their own game')`. This covers the host of a started
  game and is a general correctness guard (a player reconnects via `/ticket`, never `/spectate`). A
  demoted lobby spectator is not in `members`, so `seatOf` is `-1` and they are unaffected.

**Web (`apps/web/src/screens/RoomScreen.tsx`)**

- Hide the *watch* button when `isHost` (wrap it in `me && !isHost`). The ready button stays for all
  seated members.

## Part 2 — Owner leaving: transfer or close

**Server**

- `RoomRepo.transferHost(code, hostId, targetId): TransferHostResult` —
  `RoomDoc | 'not_found' | 'started' | 'forbidden' | 'invalid'`. LOBBY-only, host-only; the target
  must be a **seated, non-bot** member. Sets `hostId = targetId`, bumps `updatedAt`.
- `RoomRepo.closeRoom(code, hostId): RoomDoc | 'not_found' | 'started' | 'forbidden'` — host-only
  CAS `LOBBY → CLOSED` (mirrors `closeLobby` but host-gated). Members are left on the doc for the
  record; status flips to `CLOSED`.
- `RoomRepo.leave` defensive fix: when the host leaves with members remaining, transfer to the first
  **non-bot** member; if none remain (only bots), close the room (`status: 'CLOSED', members: []`)
  rather than handing host to a bot.
- `LobbyService.transferOwnership` / `closeRoom`: map results to HTTP (`404` not found, `400`
  started, `403` forbidden, `400` invalid target).
- `LobbyController`: `POST :code/transfer/:userId` and `POST :code/close` (both `@HttpCode(200)`,
  `AccessTokenGuard`, return `RoomView`).

**Web**

- `net/rest.ts`: `transferOwnership(code, userId)` → `POST /rooms/:code/transfer/:userId`;
  `closeRoom(code)` → `POST /rooms/:code/close`.
- `components/OwnerLeaveDialog.tsx` (new): props `{ members, onTransfer(userId), onClose(), onCancel() }`.
  Radio list of the other **human** members + **Transfer & leave** (disabled until one is picked)
  and **Close room** buttons. Modal styling mirrors the existing `kicked`/`ConfirmDialog` markup.
- `RoomScreen` Leave button logic:
  - `otherHumans = members.filter(m => m.userId !== me && !m.isBot)`.
  - not host → existing `ConfirmDialog` → `leaveRoom` → home.
  - host, `otherHumans.length === 0` → "Close room?" confirm → `closeRoom` → home.
  - host, `otherHumans.length >= 1` → `OwnerLeaveDialog`:
    - Transfer & leave → `transferOwnership(code, target)` then `leaveRoom(code)` then home.
    - Close room → `closeRoom(code)` then home.
- Other members/spectators react through their existing 2s poll: a host change re-renders; a
  `CLOSED` status routes them home (existing `r.status === 'CLOSED'` branch).

## Part 3 — Fix "spectate acts as a kick"

**Web (`RoomScreen` poll effect)**

Reorder the `!isMember` branch to compute `amSpectator` **before** the `wasPresent` kick check:

```
if (!r.members.some(m => m.userId === user?.id)) {
  const amSpectator = r.spectators.some(s => s.userId === user?.id);
  if (wasPresent && !amSpectator) {          // truly dropped → kicked (LOBBY) / home
    active = false;
    if (r.status === 'LOBBY') setKicked(true); else goHome();
    return;
  }
  if (r.status !== 'LOBBY') {                 // started game we aren't seated in → spectate if allowed
    if (r.status === 'STARTED' && r.gameId && r.settings.allowSpectating) { … spectate … return; }
    active = false; goHome(); return;
  }
  if (!amSpectator) { r = await api.joinRoom(code); }   // LOBBY non-member, non-spectator → join once
  // amSpectator falls through to setRoom → keeps watching the lobby
}
wasPresent = true;
setRoom(r);
```

This fixes the false kick on self-demote, and a second latent bug: a lobby spectator is now carried
into spectating the game when it starts (previously `wasPresent` sent them home).

## Part 4 — Lobby free-text chat

**Wire / DTO (`apps/server/src/lobby`)**

- `RoomRepo.RoomChatEntry`: `{ userId: string; ts: number; presetId?: string; text?: string }`
  (exactly one of `presetId` / `text`). Add `ROOM_CHAT_MAX_LEN = 2048` (parity with the in-game
  `CHAT_MAX_LEN`).
- `RoomRepo.sendChat(code, userId, entry: { presetId: ChatPresetId } | { text: string })`:
  unchanged rate-limit (5 / 5 s) + `$slice: -ROOM_CHAT_CAP` (30). Pushes `{ userId, ...entry, ts }`.
- `lobby.schemas.ts`: `ChatSchema = z.object({ presetId: z.enum(CHAT_PRESET_IDS).optional(),
  text: z.string().max(ROOM_CHAT_MAX_LEN).optional() })` (plain object — validation of "exactly one"
  lives in the service, so OpenAPI generation stays on a `ZodObject`). `RoomChatEntrySchema` gets
  `presetId: z.string().optional()` + `text: z.string().optional()`.
- `LobbyService.sendChat(code, user, { presetId?, text? })`: reject unless exactly one is present;
  for text, `trim()`, reject empty, reject `> ROOM_CHAT_MAX_LEN`; then call the repo. Existing error
  mapping (`not_member` → 403, `rate_limited` → 400) unchanged.
- `LobbyController.sendChat`: pass `{ presetId: body.presetId, text: body.text }`.

**Web**

- `net/rest.ts`: `RoomChatEntry` → `{ userId; ts; presetId?: string; text?: string }`;
  `sendRoomChat(code, payload: { presetId: string } | { text: string })`.
- `RoomScreen` chat panel: render `c.text ?? t(chatPresetKey(c.presetId))`; keep the preset buttons
  (`sendRoomChat(code, { presetId: id })`); add the same `<form className="chat-input">` input + send
  button as `ChatPanel` (`sendRoomChat(code, { text })`), reusing `chat.placeholder` / `chat.send`.

## Part 5 — Spectating is not activity

Drop the `updatedAt` bump from every spectate write (roster/set changes still persist):

- `apps/server/src/persistence/game-store.ts` `addSpectator`: `$addToSet` only, no `$set: {updatedAt}`.
  This is the load-bearing one — STARTED-room purge keys off `game.updatedAt`.
- `apps/server/src/lobby/room.repo.ts` `recordSpectator`: `$push` only, drop `updatedAt`.
- `apps/server/src/lobby/room.repo.ts` `becomeSpectator`: keep the `members`/`hostId` `$set` and the
  spectator `$push`, drop `updatedAt` from the `$set`.

Player moves (`appendAction`) and real lobby mutations still bump `updatedAt`, so an active game/room
is never purged; only a game watched by idle spectators (no player moves) ages out normally.

## Error handling & edge cases

- Host tries to `/watch` → 400. Host tries `/spectate` on their started game → 403.
- `transfer` to a bot / spectator / non-member / self → 400 `invalid`. `transfer` by a non-host →
  403. `transfer`/`close` on a STARTED room → 400.
- Free-text chat: empty/whitespace → 400; both preset+text or neither → 400; over-length → 400;
  rate-limited → 400 (existing).
- Spectator kicked by host (removed from both lists) still correctly shows the kicked modal
  (`wasPresent && !amSpectator`).
- Only-bots-remaining host leave closes the room (no bot host).

## Testing & verification

- **Server e2e (`apps/server/test/lobby.e2e.spec.ts`)**: host `/watch` → 400; host `/spectate` on
  own game → 403; `transfer` happy path + non-host/invalid-target rejections; `close` → room
  `CLOSED`; free-text chat round-trips a `text` entry and rejects empty/both; a bots-only host leave
  closes the room.
- **Server (`apps/server/test/spectators.spec.ts` / a purge spec)**: `addSpectator` does not change
  `game.updatedAt`.
- **Web (`apps/web/src/screens/RoomScreen.test.tsx`)**: self-demote to spectator does **not** raise
  the kicked modal; a free-text message renders; owner-leave dialog transfers then leaves.
- Full gates: `yarn typecheck`, `yarn lint`, `yarn test`, `yarn format:check`.

## Out of scope

- In-game (protobuf) chat — already has free text.
- Profanity filtering / moderation beyond length + rate limit (matches in-game posture).
- Realtime lobby push (the lobby still polls every 2 s).
- Transferring ownership without leaving as a standalone action (only offered inside the leave flow).
