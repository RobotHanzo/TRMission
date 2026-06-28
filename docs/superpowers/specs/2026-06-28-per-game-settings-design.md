# Per-Game Settings — Design

**Date:** 2026-06-28
**Branch:** `feat/per-game-settings`
**Status:** Draft for review

## 1. Goal

Let a **room owner (host)** configure per-game settings on the lobby screen before
starting a game. Five settings, split across two architectural planes:

**Rule variants (change game logic — must stay deterministic & replayable):**

| Setting                       | Default | Effect                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unlimitedStationBorrow`      | **off** | A station may borrow _all_ incident opponent routes (not just one). Enabling it **also** makes ticket completion _instant + locked_: a ticket that becomes connected (via own track or station-borrow) is recorded as completed in game state and its points are banked the moment it connects. |
| `secondDrawAfterBlindRainbow` | **off** | When **off**, drawing a rainbow (LOCOMOTIVE) as your **first** blind draw ends your draw (no second card). When **on**, you may still draw a second card.                                                                                                                                       |
| `noUnfinishedTicketPenalty`   | **off** | When **on**, unfinished destination tickets score `0` instead of subtracting their value at game end.                                                                                                                                                                                           |

**Server / UX settings (no game-logic change):**

| Setting           | Default    | Effect                                                                                              |
| ----------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `allowSpectating` | **on**     | Whether non-seated users may connect to watch the game.                                             |
| `roomVisibility`  | **public** | `public` rooms appear in a list on the home screen; `invite-only` rooms are reachable by code only. |

**Hard constraint:** preserve the engine's reproducibility/consistency traits — pure
deterministic `reduce`, seeded counter PRNG only, byte-identical replay verified by the
key-sorted SHA-256 `stateDigest`. No wall-clock, no unseeded randomness.

## 2. Architecture: two disjoint planes

The exploration confirmed the engine already has the exact mechanism we need.

### Plane A — rule variants live in `RuleParams`

`GameState.ruleParams: RuleParams` is already a resolved per-game tuning object that
flows through the whole determinism pipe untouched:

```
GameConfig.ruleParams?: Partial<RuleParams>          (config.ts:14)
  → initGame: { ...DEFAULT_RULE_PARAMS, ...config }  (setup.ts:17)  — no change
  → GameState.ruleParams                              (state.ts:93) — no change
  → stateDigest (part of the SHA-256)                 — no change
  → persistence StoredConfig.ruleParams round-trip    — no change
  → replay() rebuilds via initGame(config)            — no change
```

So the three rule-variant booleans are added to `RuleParams` (in
`packages/shared/src/constants.ts`) with `false` defaults in `DEFAULT_RULE_PARAMS`. Every
consumer reads `state.ruleParams.*`. The booleans **never feed the PRNG**; they only branch
already-deterministic logic, so replay stays byte-identical for a fixed `(seed, ruleParams)`.

### Plane B — server settings live on `RoomDoc`

`allowSpectating` and `roomVisibility` are access/discovery controls. They are **never**
engine inputs and never on the realtime snapshot. They live only on the Mongo `RoomDoc`
(`apps/server/src/lobby/room.repo.ts`).

The lobby UI presents all five as one host-only panel, but they split at the service
boundary: rule variants → `GameConfig.ruleParams` at game start; spectating/visibility →
`RoomDoc` fields read during the LOBBY phase.

## 3. Determinism & versioning (load-bearing)

`stateDigest` is a key-sorted SHA-256 over the _entire_ state including `ruleParams`. Adding
keys to `ruleParams` changes the digest of **every** game — even all-default games — because
the canonical JSON gains keys regardless of value. The lock-in feature also adds a
`completedTickets` field to `PlayerState`, another digest change. Consequences, all expected
under the project's version-pin ADR:

1. **Bump `ENGINE_VERSION` 1 → 2** (`packages/engine/src/types/state.ts`).
2. **Regenerate all golden-replay digest fixtures** (engine `rules`/`engine`/`serialize`
   golden tests). The new digests become the goldens.
3. **Pre-existing v1 persisted games will refuse cross-version replay** — this is the
   documented, intended behavior of the version pin. Acceptable pre-launch. (If production
   games must survive, the alternative is a migration that injects defaults before digesting;
   heavier — flagged as an open decision in §9.)

`secondDrawAfterBlindRainbow = off` is a **deliberate change to the default rule** (the
engine currently always permits the second draw). This is intended per the spec ("default:
off") and is part of why the version bump is required.

## 4. Engine changes — rule variants

### 4.1 `secondDrawAfterBlindRainbow` (simplest)

`reduce.ts applyDrawBlind` (~:216): after the drawn card is added to hand and the
`CARD_DRAWN_BLIND` event is emitted, branch:

```
if (isFirst && card === 'LOCOMOTIVE' && !state.ruleParams.secondDrawAfterBlindRainbow) {
  // end the turn now — the rainbow consumed the whole draw
  return ok(endTurn(board, next, { wasPass: false }))
}
// else: existing behavior (isFirst → DRAWING_CARDS; second draw → endTurn)
```

No new rejection code (it is not a rejected action; the turn simply ends). The face-up
locomotive path (`FACEUP_LOCO_SECOND_DRAW`) is unrelated and unchanged.

### 4.2 `noUnfinishedTicketPenalty` (scoring-only)

`connectivity.ts evaluateTickets` penalizes unfinished tickets at `net -= t.value`. Thread a
flag in; when set, the unfinished branch contributes `0`. The optimizer's net/tiebreak logic
still works (it just never sees negative contributions). Plumb the flag from
`scoring.ts evaluatePlayerTickets`, reading `state.ruleParams.noUnfinishedTicketPenalty`.
Pure end-of-game change; no `redactFor` impact.

### 4.3 `unlimitedStationBorrow` + instant/locked completion (the substantial one)

Two coupled behaviors.

**(a) Unlimited borrow in scoring.** Today `evaluateTickets` lets each station pick exactly
one incident opponent edge (a bounded exhaustive optimization). With the flag on, borrowing
is cost-free and unlimited, so the optimum is simply **union(own edges ∪ all incident
opponent edges at every station city)** — a single union-find pass, no combinatorial search.
Locked routes stay excluded from borrow candidates (unchanged from today's `scoring.ts`).

**(b) Instant + locked completion (mechanical, in state).** Chosen behavior: completed
tickets are **recorded in game state and their points banked the moment they connect** — not
merely shown.

- **New state:** `PlayerState.completedTickets: readonly TicketId[]` — the locked set, in
  completion order. Only ever grows. Populated only when `unlimitedStationBorrow` is on
  (when off, it stays empty and existing end-game scoring + own-track live display apply).
- **Completion check (a pure helper, e.g. `lockCompletedTickets(board, state)`):** runs
  after every connectivity-changing action — `CLAIM_ROUTE`, `BUILD_STATION`, and a committed
  `RESOLVE_TUNNEL` (a tunnel is a claim). It recomputes, for **every** player (not just the
  actor), the set `connected = union(own ∪ all station-borrowed opponent edges)`, and appends
  any kept ticket now connected but not already in `completedTickets`. Cross-player scope is
  required because under unlimited borrow an opponent claiming a route incident to _my_
  station city can complete _my_ ticket.
- **Event:** emit a public `TICKET_COMPLETED { player, ticket }` for each newly-locked ticket
  (drives animation + reveal). Completion is public information already (own-track completions
  are public today).

**Why this is consistent and safe (the key invariant):** under unlimited borrow the borrow
graph is **monotonic** — claimed routes never un-claim, stations never move, and the set of
borrowable edges only grows. Therefore `union(own ∪ all borrows)` is monotonically
increasing, so:

> the locked set at game end == the end-game union-based completion set.

The banked points equal the end-game evaluation exactly — no double counting, no retraction
of a revealed completion. End-game scoring, when `unlimitedStationBorrow` is on, reads the
locked set directly: `ticketsCompleted = completedTickets.length`, and `ticketNet =
Σ(completed values) − (noUnfinishedTicketPenalty ? 0 : Σ(unfinished values))`.

**Running score display.** `PlayerState.routePoints` stays pure (routes only) to keep the
end-game `total = routePoints + ticketNet + stationBonus + longestBonus` formula intact.
Banked ticket points are surfaced for live display as a **projection-time derivation** (sum
of `completedTickets` values), exposed on the snapshot so the scoreboard reflects them
mid-game without corrupting the engine's score field. (Detail finalized in the plan.)

- **Live completion display (`selectors.ts redactFor` `completedTickets`):** when
  `unlimitedStationBorrow` is on, source the public list from `state.completedTickets` (the
  locked set); when off, keep today's derived own-track-only computation.

## 5. Server changes

### 5.1 `RoomDoc` (`room.repo.ts`)

Add `allowSpectating: boolean` (default `true`) and `visibility: 'PUBLIC' | 'INVITE_ONLY'`
(default `'PUBLIC'`). Set defaults in `create()`. Widen the lobby index to include
`visibility`. Add a host-only `updateSettings(code, hostId, settings)` that only mutates
while `status === 'LOBBY'` and stores the three rule-variant booleans too (so `start()` can
read them).

Concretely `RoomDoc` gains a single `settings` sub-document:
`{ unlimitedStationBorrow, secondDrawAfterBlindRainbow, noUnfinishedTicketPenalty,
allowSpectating, visibility }`.

### 5.2 Endpoints (`lobby.controller.ts` / `lobby.service.ts` / `lobby.schemas.ts`)

- `PATCH /api/v1/rooms/:code/settings` — host-only, LOBBY-only; body validated by a new
  Zod `GameSettingsSchema` (→ auto OpenAPI via `apiSchema`). Returns the updated `RoomView`
  (now including `settings`).
- `GET /api/v1/rooms` — **unauthenticated** public list: LOBBY rooms with `visibility ===
'PUBLIC'` (joinable) **plus** STARTED rooms with `visibility === 'PUBLIC' && allowSpectating`
  (watchable). The whole `LobbyController` is currently behind `AccessTokenGuard`; this route
  needs to opt out (a `@Public()`/guard-skip or a separate small unauthenticated controller).
- `start()` — read the three rule variants off `room.settings` and pass them as
  `GameConfig.ruleParams` (the only change at the `GameConfig` build site).
- `RoomView` / `RoomViewSchema` gain the `settings` object.

### 5.3 Spectator path (full support — chosen scope: "browse & watch live games")

Spectating is not currently wired (connections are seat-bound; `onHello` rejects non-seated
players). The engine + proto already support a `null`-viewer projection (`SelfView` unset).
Wire it:

- **Ws ticket:** allow a spectator sentinel `seat: -1` in `WsTicketPayload`; `signWsTicket`
  accepts it.
- **New endpoint** `POST /api/v1/rooms/:code/spectate` → mints a spectator ws-ticket for the
  room's `gameId`, **gated on `room.allowSpectating` and a started game**. Allowed for
  non-members (guests included). Rejected (403) when spectating is off.
- **Hub `onHello`:** for a spectator binding (`seat < 0`), skip the `seatOf`/turn-order
  membership check; bind as spectator; project with `viewer = null`. **Reject any game
  command** from a spectator (they receive snapshots + cosmetic events only). The existing
  egress guard already prevents leaking secrets to a `null` viewer.

### 5.4 Bots

Bots read `state.ruleParams` already. They remain functionally legal under all variants
(they choose only from `legalActions`). Tuning bot heuristics for the variants is **out of
scope** (noted in §10); naive-but-legal play is acceptable.

## 6. Proto / wire

Only the three rule-variant booleans are candidates for the wire (display purposes); the two
server settings stay REST-only.

- `common.proto`: add `message GameSettings { bool unlimited_station_borrow = 1;
bool second_draw_after_blind_rainbow = 2; bool no_unfinished_ticket_penalty = 3; }` and
  embed `GameSettings game_settings = <next tag>;` in `GameSnapshot`. (Optionally a banked
  ticket-points field per player for the live scoreboard — finalized in the plan.)
- `codec/snapshot.ts viewToSnapshot`: project `state.ruleParams.*` → `game_settings`.
- **Regenerate:** `yarn workspace @trm/proto generate` (buf → gitignored `src/gen/`).
  Drift is a CI failure. No `client.proto`/command/event changes.

## 7. Web UI

- `RoomScreen.tsx`: host-only `GameSettingsPanel` (host detection already exists via
  `room.hostId === user?.id`). Five controls: three rule toggles, an `allowSpectating`
  toggle, a `roomVisibility` segmented control. Read-only for non-hosts; locked once
  `status !== 'LOBBY'`. Persists via `PATCH .../settings`. Reuse existing switch / segmented
  patterns from `SettingsModal.tsx`.
- `HomeScreen.tsx`: a **public rooms** section fed by `GET /api/v1/rooms`, with "Join"
  (LOBBY) and "Watch" (STARTED + spectating) actions. "Watch" requests a spectator ticket and
  opens `GameScreen` in read-only mode.
- `GameScreen.tsx`: a **spectator (read-only) mode** when there is no `SelfView` — no hand,
  no action affordances; board, market, public state, and completion/score visible.
- `net/rest.ts`: extend `RoomView` with `settings`; add `getPublicRooms()`,
  `updateRoomSettings()`, `spectate()`.
- `i18n/index.ts`: add keys to **both** `zh-Hant` and `en` for the five setting labels +
  helper text, the two visibility options, "public rooms", "join", "watch", and a
  "spectating" badge, following the existing `difficulty_*` enum-key convention. zh-Hant is
  primary.

## 8. Testing strategy (TDD)

Engine (vitest, `@trm/engine`):

- `secondDrawAfterBlindRainbow`: first blind draw = LOCOMOTIVE ends the turn when off; allows
  a second draw when on; non-loco first draw unaffected; second-draw rule independent of
  face-up loco rule. Digest-stable replay either way.
- `noUnfinishedTicketPenalty`: unfinished tickets contribute `0` vs negative; completed
  unaffected; tiebreakers intact.
- `unlimitedStationBorrow`: scoring uses union-of-all-borrows; **lock-in** appends to
  `completedTickets` on own-track and on station-borrow completion, including a completion
  triggered by an **opponent's** claim into my station city; locked set == end-game completion
  set (the monotonicity invariant) as a property test; `TICKET_COMPLETED` events emitted once
  per ticket.
- Determinism guardrails: `stateDigest(replay) === stateDigest(live)` after every legal
  action for games under each variant and combinations; invariant suite (conservation,
  ownership exclusivity, station limits) still passes; regenerate goldens and assert the new
  digests are stable across a second run.

Server (vitest, mongodb-memory-server): `updateSettings` host-only + LOBBY-only; `start`
passes `ruleParams`; public list filtering (PUBLIC + LOBBY join / STARTED+spectating watch);
spectator ticket gated by `allowSpectating`; `onHello` admits a spectator and the wire-leak
e2e still shows no secrets to a `null` viewer; spectator game-command rejected.

Web (vitest): settings panel host-only & locked post-start; public list renders join/watch;
spectator GameScreen renders read-only.

Proto: round-trip `GameSettings`; `PROTOCOL_VERSION` check.

## 9. Decisions already made (from clarifying questions)

1. **Instant completion = lock points in state** (mechanical), not display-only.
2. **Spectating = full "browse & watch live games"** (public list includes in-progress
   games; non-member spectator ws path built).
3. **Settings configured on the lobby panel, host-only, frozen at game start.**

## 10. Open decisions for the reviewer

1. **Old persisted games:** accept that the `ENGINE_VERSION` bump makes pre-existing v1 saves
   un-replayable (simplest, matches the version-pin ADR), or invest in a defaults-injecting
   migration? Recommendation: accept (pre-launch).
2. **Live banked-ticket-points on the scoreboard:** surface mid-game banked ticket points as
   a projection-time number (extra snapshot field), or only reveal at game end while still
   recording `completedTickets` in state? Recommendation: surface it (it is the visible point
   of "lock in points immediately").
3. **Spectator identity:** spectators may be guests/anonymous. Mint the spectator ticket for
   any caller (authenticated or guest) — confirm we do not require login to watch a public
   game. Recommendation: allow guests to watch.

## 11. Out of scope

- Bot heuristic tuning for the new variants (bots stay legal but naive).
- Changing settings mid-game (all five freeze at start).
- Spectator chat / spectator-only features beyond read-only viewing.
- Per-user defaults / saved presets for settings.
