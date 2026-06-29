# Action log + chat panel — design

**Date:** 2026-06-29
**Scope:** full-stack — `@trm/proto`, `@trm/shared`, `apps/server`, `apps/web`.
**Depends on:** the existing chat plumbing (`Chat`/`ChatBroadcast`, `GameSocket.chat`, `hub.onChat`),
the per-recipient event redaction (`eventToProto`), and the in-game event stream the animation/sound
drivers already consume (`useGame.applyEvents` → `lastBatch`).

## Goal

Add a **comms column** to the in-game view: an **action log** of every player action (seat-coloured,
with accent treatment for important moves) stacked above a **chat** (message list + input). Both
**backfill the full game history on (re)connect**. On wide screens the column sits beside the existing
right rail; on narrower screens the rail region becomes a tab switch between the rail and the
log+chat.

## Decisions (load-bearing)

- **The log is a client-side projection of the event stream — the server stays thin.** Like the
  animation/sound drivers, the log is derived on the client from the `GameEvent` stream plus the
  authoritative snapshot (for seat → colour). The server never sends formatted/translated log text;
  i18n (zh-Hant + en) and colour happen at render. This keeps the snapshot-authoritative model intact
  and locale/roster changes apply live.
- **Action-log backfill needs no new event storage — events are deterministic.** Events are a pure
  function of the persisted action log (`reduce(board, state, action) → { state, events }`), and the
  live `GameSession` already retains `appliedActions`. On `ClientHello` the server **re-replays
  `appliedActions` through a throwaway engine** to re-derive the full event history (mechanism **A**,
  chosen over keeping an in-memory event history: stateless, no recovery hook, negligible cost for
  bounded games), redacts each event per-viewer via the existing `eventToProto(e, viewer)`, and ships
  it once in a new `HistoryReplay` frame.
- **Backfilled history is log-only — never animated.** The client routes `HistoryReplay` to the new
  `useLog`/`useChat` stores **only**, never to `useGame.applyEvents`. Otherwise a reconnecting client
  would replay every fly-card animation and sound cue for the whole game. The live event stream still
  feeds both the animation/sound channel (`useGame`) and the log (`useLog`).
- **Chat is the one thing that must be persisted — it is not derivable.** A new append-only
  `gameChats` collection plus an in-memory per-game list in the hub. `onChat` enforces limits → appends
  → broadcasts; the in-memory list rides along in `HistoryReplay` on connect. Degrades to in-memory
  only when `TRM_PERSISTENCE=0` (no store), matching how that mode already drops durability.
- **Chat limits are server-authoritative.** `CHAT_MAX_LEN = 2048` characters (after trim; empty
  ignored) and a sliding-window **rate limit** of `CHAT_RATE_MAX = 5` messages per `CHAT_RATE_WINDOW_MS
  = 5000` ms per connection. The hub uses wall-clock for the window — allowed, the determinism ban is
  `@trm/engine`-only. A violation returns a `Rejection` (new transport `RejectionCode.CHAT_REJECTED`)
  with `errors:chatTooLong` / `errors:chatRateLimited` → client toast. The client also sets the input
  `maxLength` so the limit is never hit in normal use.
- **Chat is members-only; spectators read the public log only.** This preserves the existing behaviour
  (`hub.onChat` already broadcasts to `members`, not the `spectators` set). Spectators receive the
  public (viewer = `null`) event history in `HistoryReplay`, but no chat backfill and cannot send.
- **Layout is independent of the `boardLayout` (`rail`/`tray`) setting.** The comms column is a new
  grid area added to both templates; the rail/tray choice still controls only where the hand sits.

## Layout & responsive behaviour

Three width bands. The board is always present; the second/third regions adapt:

| Band   | Width        | Arrangement                                                              |
|--------|--------------|--------------------------------------------------------------------------|
| Wide   | ≥ 1200px     | `board │ rail (340px) │ comms (320px)` — log+chat both visible           |
| Medium | 920–1200px   | `board │ [tab: Rail ⟷ Log+Chat]` — the second column is tab-switched     |
| Narrow | < 920px      | one scrolling column (existing collapse); the rail slot is the same tab-switched [Rail ⟷ Log+Chat] |

- **CSS (`styles/game.css`):** add `--tr-comms-w: 320px`. Extend the grid templates:
  - `.game--rail` → `grid-template-columns: minmax(0,1fr) var(--tr-rail-w) var(--tr-comms-w)` with
    `grid-template-areas: 'board rail comms'`.
  - `.game--tray` → same three columns on row 1, `'hand hand hand'` on row 2.
  - A `@media (max-width: 1200px)` collapses to two columns (`board` + a single tabbed slot) and shows
    the tab bar; the existing `@media (max-width: 920px)` single-column rules are extended to include
    `.game-comms` so it stacks too.
- **Tab state** is ephemeral local UI (component `useState` in the comms host, or a tiny field on
  `store/ui.ts` if it must survive remounts — default **Rail**). Not persisted, not account-synced.
- The tab bar (`遊戲面板` / `紀錄·聊天`) only renders below the wide breakpoint; above it both columns
  show and the tabs are absent.

## Action log

### Data flow

- **Live:** `net/connection.ts` already calls `useGame.getState().applyEvents(version, events)` on
  `onEvents`. Add a sibling call `useLog.getState().ingestLive(events)`. The animation/sound path is
  untouched.
- **Backfill:** on connect the socket receives a `HistoryReplay` frame → `socket.ts` `onHistory`
  handler → `connection.ts` routes `events` to `useLog.getState().ingestHistory(events)` and `chat` to
  `useChat.getState().ingestHistory(chat)`. History is applied once per connect; the stores are
  `reset()` in `connectGame` (beside `useGame.reset()`), so a reconnect starts clean and re-fills.

### Entry model & translation

`useLog` holds structured entries — **no translation at ingest**:

```ts
interface LogEntry {
  id: number;                 // monotonic, for React keys + de-dupe
  kind: LogKind;              // 'routeClaimed' | 'stationBuilt' | 'turnStarted' | ...
  playerId: string | null;    // actor; null for table-level events (gameEnded)
  data: Record<string, unknown>; // routeId, cityId, count, color?, points?, ...
  importance: 'normal' | 'highlight' | 'alert';
}
```

A pure `logModel.ts` (`entriesFromEvents(events): LogEntry[]`, mirroring `animationModel.ts`) maps the
`GameEvent` oneof to entries. `LogPanel.tsx` translates at render: `t('log.<kind>', { name, ... })`
where `name` resolves from `useRoster` (fallback `P{seat+1}` / "you"), the player chip colours from
`SEAT_COLORS[seat]` (seat looked up in the snapshot), and content names (route/city/ticket) resolve
from `game/content.ts`.

### Event vocabulary & importance

| Event                         | Logged as                              | Importance |
|-------------------------------|----------------------------------------|------------|
| `GameStarted`                 | game started / turn order              | normal     |
| `TurnStarted`                 | subtle "— {name}'s turn —" divider     | normal (muted) |
| `RouteClaimed`                | {name} built {route} (+{pts})          | **highlight** (seat accent) |
| `StationBuilt`                | {name} built a station at {city}       | **highlight** |
| `TunnelRevealed`              | tunnel reveal at {route}               | normal     |
| `TunnelResolved` (committed)  | {name} completed the tunnel {route}    | **highlight** |
| `TunnelResolved` (aborted)    | {name} backed out of the tunnel        | normal     |
| `CardDrawnBlind`              | {name} drew from the deck (self: colour shown) | normal (muted) |
| `CardTakenFaceup`             | {name} took {colour} from the market   | normal (muted) |
| `TicketsKept`/`InitialTicketsKept` | {name} kept {n} mission(s)        | normal     |
| `PlayerPassed`                | {name} passed                          | normal     |
| `EndgameTriggered`            | final round — {n} turns left           | **alert** (amber) |
| `GameEnded`                   | game over                              | **alert**  |

Omitted as noise: `MarketRefilled` (fires on every face-up draw), `MarketRecycled`, `DeckReshuffled`,
`TurnEnded`, `TicketsOffered`/`InitialTicketsOffered` (private offer — the *kept* event is enough),
`DoubleRouteLocked`. The log store caps at ~1000 entries (games are bounded; defensive).

## Chat

- **Send:** `ChatPanel.tsx` input → `socket.chat(text)` (already exists). `maxLength=2048`, trims, no
  send on empty. Identity for rendering uses `useRoster` like the log.
- **Receive:** `connection.ts` `onChat` → `useChat.getState().ingest({ playerId, text })` (live) and
  `ingestHistory(chat)` from `HistoryReplay`. Messages render with the sender's seat colour chip.
- **Server enforcement (`hub.onChat`, now receiving `clientSeq`):**
  - reject (no broadcast) if `text.trim()` is empty, or `> CHAT_MAX_LEN` → `RejectionCode.CHAT_REJECTED`
    + `errors:chatTooLong`.
  - sliding-window rate check per connection (timestamps array, `Date.now()`): if `≥ CHAT_RATE_MAX` in
    the trailing `CHAT_RATE_WINDOW_MS`, reject → `errors:chatRateLimited`.
  - otherwise: append to the store (`appendChat`, best-effort/awaited) + in-memory list, then broadcast
    `chatFrame` to members (unchanged fan-out).
- **Persistence:** `gameChats` doc `{ gameId, seq, playerId, text, ts }`, append-only, unique
  `(gameId, seq)`; `loadChat(gameId)` returns ordered entries. The hub keeps `chatLog: Map<gameId,
  ChatEntry[]>`, hydrated lazily on `recoverMatch`/first access.

## Wire / proto changes (`@trm/proto`)

`server.proto`:

```proto
message ChatEntry { string player_id = 1; string text = 2; int64 ts = 3; }
message HistoryReplay {
  repeated GameEvent events = 1;   // redacted per-recipient; log-only (no animation)
  repeated ChatEntry chat   = 2;   // empty for spectators
  uint32 state_version      = 3;
}
```

Add `HistoryReplay history = 10;` to the `ServerEnvelope` oneof. `common.proto` `RejectionCode`: add a
transport-range (1–99) `CHAT_REJECTED`. Regenerate (`yarn workspace @trm/proto generate`) — `src/gen/`
is gitignored; drift is a CI failure. Mirror `CHAT_REJECTED` in `@trm/shared/errors` if rejection codes
are enumerated there, and add the `errors:chatTooLong` / `errors:chatRateLimited` i18n keys.

## Server changes (`apps/server`)

- `game/game-session.ts`: `history(): GameEvent[]` — replay `appliedActions` from genesis
  (`initGame(board, config)`) through `reduce`, collecting each step's events. Pure; does not touch the
  live state.
- `codec/`: `historyReplayFrame(events, chat, stateVersion)` builder; reuse `eventToProto(e, viewer)`
  for redaction.
- `ws/hub.ts`:
  - `onHello` (members) and the spectator branch: after the snapshot, build `HistoryReplay` —
    `session.history()` redacted for the viewer (`null` for spectators), plus the in-memory `chatLog`
    (empty for spectators) — and send it.
  - `onChat(conn, clientSeq, text)`: length + rate enforcement (above), persistence + in-memory append,
    then broadcast.
  - `chatLog` map + hydrate on `recoverMatch`.
- `persistence/types.ts` + `MongoGameStore` + in-memory store: `appendChat` / `loadChat`; `ChatDoc`
  shape + unique `(gameId, seq)` index. No-op/array-backed in the in-memory store.

## Web changes (`apps/web`)

```
store/log.ts        ← entries, ingestLive, ingestHistory, reset (cap ~1000)
store/chat.ts       ← messages, ingest, ingestHistory, reset
game/logModel.ts    ← pure entriesFromEvents(events): LogEntry[]  (+ importance)
net/socket.ts       ← onHistory handler (HistoryReplay → events + chat)
net/connection.ts   ← wire onHistory; also feed useLog on onEvents
components/LogPanel.tsx   ← renders entries (translate + colour at render)
components/ChatPanel.tsx  ← message list + input (maxLength 2048, send via socket.chat)
components/CommsPanel.tsx ← the column: log over chat; hosts the Rail⟷Comms tab below the breakpoint
screens/GameScreen.tsx    ← mount the comms region in the grid; tab host for medium/narrow
i18n/index.ts       ← log.* + chat.* + errors:chatTooLong/chatRateLimited (zh-Hant + en)
styles/game.css     ← comms column, three-column templates, tab bar, responsive bands
```

The Rail⟷Comms tab is rendered by the screen/comms host so it can swap the `.game-rail` and
`.game-comms` content in the single tabbed slot below 1200px; above it both render unconditionally.

## Error handling & edge cases

- History arriving when the log is already populated for this connect → ignored (stores are reset per
  connect; a second `HistoryReplay` is a no-op by guard).
- Chat before binding → dropped (current behaviour).
- Over-length / rate-limited chat → rejection toast; nothing broadcast or stored.
- Roster not yet loaded at render → names fall back to `P{seat+1}`; resolve live once roster loads.
- Spectators → public log only, no chat.
- `boardLayout='tray'` → comms sits beside the rail; the hand strip spans all columns on row 2.
- `TRM_PERSISTENCE=0` → chat is in-memory only (lost on restart); log backfill still works (derived).

## Testing & verification

- **Server (vitest):** `session.history()` reproduces the live event sequence; `HistoryReplay`
  redaction (private events absent / blanked for non-owners, present for the owner; spectators get
  public-only + no chat); chat persist/load round-trip; over-length and rate-limit both reject with the
  right code/key and broadcast nothing; the wire-leak e2e (`test/wire-game.e2e.spec.ts`) still passes
  with history events flowing.
- **Web (vitest + Testing-Library):** `logModel` event→entry mapping incl. importance and omissions;
  `useLog`/`useChat` reset on reconnect and de-dupe history; `ChatPanel` enforces maxLength / trims /
  no-empty-send; `CommsPanel` tab switching at the breakpoints; `LogPanel` renders seat colours + i18n.
- **Manual:** `yarn workspace @trm/web dev` against a bots game — watch the log fill with coloured
  entries (highlights for builds, alert for endgame/game-over), send chat, reconnect mid-game and
  confirm both log and chat backfill with **no** replayed animations/sounds, and resize across 1200px /
  920px to confirm the three-column → tabbed → single-column transitions.

## Out of scope

- Chat moderation / profanity filtering, DMs, threads, reactions.
- Lobby/room chat (in-game only).
- Spectator chat participation.
- Account-synced log/chat history beyond the existing `matchHistory` archive.
- A user setting to hide/collapse the comms panel (always shown when width allows).
- Server-sent formatted/translated log text (log is a client projection).
