# Preset (prebuilt) chat messages — design

**Date:** 2026-07-05
**Scope:** full-stack — `@trm/shared`, `@trm/proto`, `@trm/codec`, `apps/server`, `apps/web`, `apps/admin`.
**Depends on:** the existing free-text chat (`Chat`/`ChatBroadcast`/`ChatEntry`, `GameSocket.chat`,
`hub.onChat`, `store/chat.ts`, `ChatPanel.tsx`) added in
[2026-06-29-action-log-and-chat-design.md](2026-06-29-action-log-and-chat-design.md), and the
"server sends a semantic kind, client resolves via i18n" precedent already used for random events
(`EVENT_KINDS`/`eventNameKey` in `apps/web/src/game/events.ts`). This design also **reverses** that
doc's "out of scope: lobby chat" call — lobby chat is now in scope, preset-only.

## Goal

Add a small, curated set of **preset chat messages** — canned phrases a player picks from a button
row instead of typing. The server carries only a **semantic id** over the wire (never localized
text); every viewer's client resolves that id to their own display language at render time, so the
same message reads correctly for every participant regardless of their locale. Presets are usable
**in the pre-game lobby and in-game**; free-text chat is untouched and keeps working exactly as it
does today, in-game only.

## Decisions (load-bearing)

- **One canonical preset catalog, shared everywhere.** A new `packages/shared/src/chat-presets.ts`
  exports `CHAT_PRESET_IDS` (the ordered list of ids) and `isChatPresetId()`. This is the single
  source of truth imported by the in-game WS path, the lobby REST path, and the admin dashboard —
  no duplicate enumeration of "what presets exist." `@trm/shared` already sits below all three apps
  in the build graph, so this adds no new dependency edge.
- **The preset list (12 ids):** `GREETING`, `GOOD_LUCK`, `THANKS`, `SORRY`, `ONE_MOMENT`,
  `NICE_MOVE`, `WELL_PLAYED`, `GOOD_GAME`, `LETS_GO`, `STILL_THERE`, `YES`, `NO`. Same set used in
  both lobby and in-game — no per-context catalogs.
- **Wire carries an id, never text — same principle as `RandomEventInfo.kind`.** A preset message
  is `{ presetId }` on the wire; i18n happens only at render (`chat.presets.<ID>` key), identically
  to how `eventNameKey`/`eventDescKey` resolve event kinds. This is what makes "translated per
  display language for everyone" true — two viewers with different locales see the same preset
  message in their own language, and a locale change (or a future added language) does not require
  replaying or re-sending anything.
- **Free text and presets are siblings on the same channel, not a replacement.** In-game, the
  existing `Chat`/`ChatBroadcast`/`ChatEntry` proto messages gain a second `oneof` arm
  (`preset_id` alongside the existing `text`) — a wire-compatible change (no field renumbering).
  `ChatPanel.tsx` keeps its text input and gains a preset button row above it. `PROTOCOL_VERSION`
  bumps 4→5, matching the project's established practice of bumping it whenever a oneof gains a
  case.
- **Lobby chat is preset-only, piggybacked on the existing REST poll — no new transport.** The
  lobby has no WebSocket/SSE channel today (`RoomScreen.tsx` polls `GET /rooms/:code` every 2s;
  confirmed no gateway exists under `apps/server/src/lobby/`). Rather than stand up new
  infrastructure, lobby presets are a capped array on the existing `RoomDoc`
  (`chat?: {userId, presetId, ts}[]`, capped via Mongo `$push`+`$slice`), sent by a new
  `POST /rooms/:code/chat` endpoint mirroring the existing `rematch-vote` pattern
  (`RoomRepo.setRematchVote` → `LobbyService.voteRematch` → controller), and read back for free as
  part of the `RoomView` the poll already fetches.
- **Eligibility mirrors the existing chat rule: seated/members only, never spectators.** In-game,
  this is the existing restriction (`conn.binding.seat < 0` → no chat) — presets reuse it unchanged.
  In the lobby there is no spectator concept before a game starts (a room is just its member list),
  so any room member (host or joined player) may send.
- **Rate-limiting for lobby presets is derived from the persisted array, not new in-memory state.**
  `LobbyService.sendChat` counts this user's entries within the trailing window from `room.chat`
  itself rather than tracking a separate map — simpler, and correct across restarts/instances,
  unlike the in-game hub's existing per-connection in-memory limiter (which is fine to leave as-is
  in-game since a WS connection is inherently single-instance already). Reuses the same thresholds
  as in-game chat, `CHAT_RATE_MAX = 5` per `CHAT_RATE_WINDOW_MS = 5000`, for one consistent spam
  budget across both channels.
- **No visual marking in the players' own chat UI.** A preset renders exactly like a typed message
  in `ChatPanel.tsx`/the lobby chat strip — same bubble style, just translated text. The
  distinguishing marking is admin-only (see below), for moderation/audit purposes, not a
  player-facing affordance.
- **Admin dashboard shows presets translated, with a marking distinguishing them from free text.**
  `GamesView.tsx`'s existing (untranslated, unmarked) chat section is extended: the game-detail
  chat DTO gains the same `{kind: 'text'|'preset', value}` discriminator, presets are resolved via
  admin's own i18n (`apps/admin/src/i18n/index.ts`, which is entirely separate from `apps/web`'s —
  no shared resource files exist between the two apps today, so the same 12 keys are authored
  twice, consistent with how `apps/admin` already duplicates rather than shares translation
  content), and shown with an `.oc-chip` badge ("預設"/"Preset") next to the translated text. This
  reuses the existing `games.read` gate — no new dashboard permission. Lobby chat does not appear
  in admin (it's ephemeral pre-game banter on a room doc, not part of a game's record).

## Wire / proto changes (`@trm/proto`)

`client.proto`:

```proto
message Chat {
  oneof content {
    string text = 1;
    string preset_id = 2;
  }
}
```

`server.proto`:

```proto
message ChatBroadcast {
  string player_id = 1;
  oneof content {
    string text = 2;
    string preset_id = 3;
  }
}

// One persisted chat line, replayed in a HistoryReplay on (re)connect.
message ChatEntry {
  string player_id = 1;
  oneof content {
    string text = 2;
    string preset_id = 4;   // next free field number (ts already occupies 3)
  }
  int64 ts = 3;
}
```

Wrapping the existing `text` fields into a `oneof` is wire-compatible (same tag encoding; field
numbers unchanged). Regenerate (`yarn workspace @trm/proto generate`) — `src/gen/` is gitignored,
drift is a CI failure. Bump `PROTOCOL_VERSION` 4→5 in `packages/proto/src/index.ts`, extending the
version-history comment (matching the precedent set by the last two bumps).

## `@trm/shared` changes

New `packages/shared/src/chat-presets.ts`:

```ts
export const CHAT_PRESET_IDS = [
  'GREETING', 'GOOD_LUCK', 'THANKS', 'SORRY', 'ONE_MOMENT',
  'NICE_MOVE', 'WELL_PLAYED', 'GOOD_GAME', 'LETS_GO',
  'STILL_THERE', 'YES', 'NO',
] as const;
export type ChatPresetId = (typeof CHAT_PRESET_IDS)[number];
export const isChatPresetId = (v: string): v is ChatPresetId =>
  (CHAT_PRESET_IDS as readonly string[]).includes(v);
```

Re-exported from `packages/shared/src/index.ts`. Also add a new rejection messageKey
`errors:chatInvalidPreset` alongside the existing `errors:chatTooLong`/`errors:chatRateLimited`.

## In-game server changes (`apps/server`)

- `ws/hub.ts` `onChat`: branch on the incoming oneof case.
  - `text` case: unchanged existing behavior (trim, `CHAT_MAX_LEN`, rate limit).
  - `presetId` case: validate via `isChatPresetId()`; reject (`RejectionCode.MALFORMED`,
    `errors:chatInvalidPreset`) if unrecognized. No length check (ids are fixed-shape).
  - Both cases share the existing sliding-window rate limiter (`CHAT_RATE_MAX`/
    `CHAT_RATE_WINDOW_MS`) — one spam budget per connection regardless of content kind.
  - The in-memory `chatLog` entries and `store.appendChat` persistence carry the discriminated
    content through (`{playerId, ts, content: {case:'text', text} | {case:'preset', presetId}}`).
- `persistence/`: `GameStorePort.appendChat`/`loadChat`, `MongoGameStore`, and the in-memory test
  store all widen their chat-entry shape to carry the same discriminator.
- `codec/frames.ts`: `chatFrame`/`historyReplayFrame` builders take the discriminated content
  instead of a flat `text` string.

## In-game client changes (`apps/web`)

- `net/socket.ts`: `GameSocket` gains `chatPreset(presetId)` alongside the existing `chat(text)`.
- `store/chat.ts`: `ChatMessage` widens to carry either `text` or `presetId`; `ingest`/
  `ingestHistory` pass the discriminator through unchanged otherwise.
- `game/chatPresets.ts` (new, mirrors `game/events.ts`): re-exports `CHAT_PRESET_IDS` from
  `@trm/shared` and exposes `chatPresetKey(id) => \`chat.presets.${id}\``.
- `components/ChatPanel.tsx`: a row of preset buttons (label = translated preset text) above the
  existing text input, each calling `getSocket()?.chatPreset(id)`; the client-side rate-limit guard
  already there is shared across both send paths. Rendering a message resolves `t(chatPresetKey(id))`
  for presets, the raw `text` for typed messages — same bubble markup, no visual difference.
- `i18n/index.ts`: new `chat.presets.*` keys (12 ids) added to both the `zh-Hant` and `en` blocks.

## Lobby changes (`apps/server` + `apps/web`)

- `lobby/room.repo.ts`: `RoomDoc.chat?: { userId: string; presetId: ChatPresetId; ts: number }[]`;
  new `sendChat(code, userId, presetId)` — validates the room exists and the user is a member,
  checks the rate limit by counting this user's entries with `ts` within the trailing
  `CHAT_RATE_WINDOW_MS` from `room.chat` (reject if `≥ CHAT_RATE_MAX`), then `$push`+`$slice`-appends
  (capped at the last 30) and returns the updated doc (or a
  `'not_found' | 'not_member' | 'rate_limited'` sentinel), mirroring `setRematchVote`.
- `lobby/lobby.service.ts`: `sendChat(code, user, presetId)` — maps sentinels to
  `NotFoundException`/`ForbiddenException`/a rate-limit exception, otherwise `toView(r)`, mirroring
  `voteRematch`.
- `lobby/lobby.controller.ts`: `POST :code/chat` with a `ChatSchema = z.object({ presetId:
  z.enum(CHAT_PRESET_IDS) })` body, returning `RoomView` — same shape as every other lobby mutation.
- `lobby/lobby.schemas.ts`: `RoomViewSchema` gains the `chat` array.
- `apps/web/src/screens/RoomScreen.tsx`: a preset-button row + compact translated log, reusing
  `chatPresetKey()`; new entries arrive for free via the existing 2s poll of `GET /rooms/:code`.

## Admin dashboard changes (`apps/admin`)

- Game-detail DTO (`GET /dashboard/games/:id`, `apps/server/src/dashboard/`): the `chat` array
  entries gain a `kind: 'text' | 'preset'` discriminator and rename the payload field to `value`
  (holding either the raw text or the preset id).
- `apps/admin/src/views/GamesView.tsx` chat section (currently lines 154–168, raw/untranslated):
  for `kind === 'preset'`, render `t(chatPresetKey(value))` — a small admin-local `chatPresetKey(id)
  => \`chat.presets.${id}\`` helper, same shape as web's but a separate module since the two apps
  share no i18n code — plus an `.oc-chip` badge (`games.chatPresetBadge` i18n key: "預設"/"Preset");
  for `kind === 'text'`, render `value` unchanged (today's behavior).
- `apps/admin/src/i18n/index.ts`: new `chat.presets.*` keys (the same 12 ids, translated
  independently of `apps/web`'s copy — admin has no shared i18n resource with web today) plus
  `games.chatPresetBadge`.
- No new dashboard permission — this still lives under the existing `games.read` gate.

## Error handling & edge cases

- Unrecognized `presetId` (stale client, protocol drift) → in-game: `Rejection` +
  `errors:chatInvalidPreset`, nothing broadcast/stored. Lobby: `400` from the zod `z.enum()` body
  validation, request rejected before reaching the service.
- Spectator or unbound connection sending a preset in-game → dropped, identical to today's
  free-text behavior.
- Non-member calling the lobby chat endpoint → `403`, mirroring `voteRematch`'s `not_member` path.
- Rate limit hit (either channel) → rejection/`429`-equivalent, nothing appended.
- A locale switch mid-session → preset messages already in the log re-render in the new locale
  immediately (they're translated at render, not at ingest) — this is the point of the design.
- `TRM_PERSISTENCE=0` (in-game, no store) → preset chat degrades to in-memory-only exactly like
  free-text chat already does.

## Testing & verification

- **`@trm/proto`:** round-trip test for both oneof cases on `Chat`/`ChatBroadcast`/`ChatEntry`;
  `PROTOCOL_VERSION` bump check.
- **`apps/server` (vitest):** extend `chat-store.spec.ts`/`history-chat.e2e.spec.ts` with a preset
  case (persist/load/broadcast/rejection-on-unknown-id); new lobby chat e2e (send, membership gate,
  rate-limit-from-history, cap-at-30); the wire-leak e2e continues to pass with the new oneof case
  present.
- **`apps/web` (vitest + Testing-Library):** `ChatPanel` renders/sends both preset and free-text
  messages; `store/chat.test.ts` covers the widened `ChatMessage` shape; `RoomScreen` renders the
  lobby preset row and polled chat entries.
- **`apps/admin`:** `GamesView` renders a preset entry translated + badged vs. a text entry
  unmarked.
- **Manual:** send a preset in the lobby from one account, confirm it appears (translated) for
  another member polling with a different locale; same check in-game; confirm the admin game
  detail drawer shows the preset badged and translated for a completed game.

## Out of scope

- Chat moderation / profanity filtering, DMs, threads, reactions (unchanged from the prior design).
- Per-context preset catalogs (lobby and in-game share one list).
- Spectator preset/chat participation.
- Visual marking of presets in the players' own chat UI (admin-only, by decision above).
- Adding new presets via the admin dashboard (the catalog is code, not data, for now).
- Lobby chat persistence beyond the room document's lifetime (no history survives past the room).
