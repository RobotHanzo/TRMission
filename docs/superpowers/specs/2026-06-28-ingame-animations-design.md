# In-game animations — design

**Date:** 2026-06-28
**Scope:** `apps/web` only (no proto / engine / server changes required).
**Branch:** `feat/ingame-animations`

## Goal

Add motion and feedback to the in-game experience without changing game truth. Five deliverables:

1. **Draw-card animation** — a card flies from the deck/market slot into the hand.
2. **Draw-ticket animation** — offered cards slide up when the dialog opens; kept cards fly into the
   tickets tray on confirm.
3. **Claim/station glow** — a route blooms in the owner's seat colour when claimed; a station marker
   pops with a ring glow when built. For **all** players.
4. **Ticket-completion fanfare** — a full-screen, **skippable**, ≤7s celebration when one of _your_
   tickets completes: enlarged ticket card, confetti (more for long-haul), and a seat-colour glow
   that sweeps the completed route path from the start station to the end station. Points are awarded
   and shown **instantly** at completion.
5. **Extra animations (approved):** turn-change cue, score `+N` float & count-up, market refill
   flip-in, tunnel reveal flip.

## Decisions (load-bearing)

- **No backend change.** Every animation is driven from events the protocol already emits
  (`RouteClaimed`, `StationBuilt`, `CardDrawnBlind`/`CardTakenFaceup`, `MarketRefilled`,
  `TurnStarted`, `TunnelRevealed`) plus snapshot diffs. Events already reach the client
  (`socket.onEvents` → `store/game.applyEvents`). `server.proto` explicitly frames `EventBatch` as
  "animation hints" — this is exactly that use.
- **Ticket completion is derived client-side.** There is no `TicketCompleted` event. After each
  snapshot we recompute which of _the local player's_ kept tickets are connected (reusing the
  engine's `UnionFind` + station-borrow logic from `packages/engine/src/graph/connectivity.ts`), and
  fire on an incomplete→complete transition. Deriving it locally is _better_ than an event: a BFS
  over owned routes yields the actual start→end **path** to sweep, which an event would not carry.
- **Instant ticket points are self-only.** Opponents' tickets are secret (`PublicPlayerState` carries
  route points only). So instant ticket scoring (the `+N` and the score bump) is shown for the local
  player; opponents' ticket points still reconcile at game-over via `finalScores`. This is a
  display/derivation choice — the deterministic engine is untouched. A future engine change could
  make ticket points live and authoritative for all players, but that is out of scope here.
- **Opponents' draws show a branded cover.** The local player's draw animates the _real_ card
  (colour/art, since the drawn card is visible to its owner); opponents' draws animate a **cover**
  (train mark + 台鐵任務 / TRMission) into their tracker row — for both blind and face-up draws,
  for visual consistency.
- **Reduced motion is a first-class path.** Every effect degrades under `prefers-reduced-motion`:
  glows become instant, fly is skipped, the fanfare becomes a static banner with no confetti/sweep,
  floats appear in place without travel.
- **New CSS lives in `apps/web/src/styles/animations.css`** (a new file) to stay clear of unrelated
  in-progress edits to `global.css` on the parent branch.
- **`canvas-confetti` dependency.** Added to `apps/web` for the fanfare (framework-agnostic,
  Vite-5 safe), with `@types/canvas-confetti`.

## Architecture

### Animation event bus

`store/game.ts` gains a `lastBatch: { seq: number; events: GameEvent[] } | null` field, incremented
on every `applyEvents`. Animation consumers react to `lastBatch` changes (one batch at a time)
instead of diffing the rolling 50-event `recentEvents` buffer.

### `game/animationModel.ts` (pure)

Pure translation of `(prevSnapshot, snapshot, events)` → a list of typed **animation intents**:
`{ kind: 'cardFly', toPlayerId, faceUp, color? }`, `{ kind: 'glowRoute', routeId, seat }`,
`{ kind: 'glowStation', cityId, seat }`, `{ kind: 'scoreFloat', playerId, amount }`,
`{ kind: 'turnCue', playerId, isYou }`, `{ kind: 'marketFlip', slot }`,
`{ kind: 'ticketComplete', ticketId, long, seat, path }`. Pure ⇒ unit-testable.

### `game/tickets.ts` (pure)

- `completedTicketIds(snapshot): Set<string>` — builds the local player's owned edges + station
  borrows from the snapshot and runs union-find (reusing the engine helper) to mark which kept
  tickets are connected.
- `pathForTicket(snapshot, ticketId): string[]` — BFS over the usable edge graph (owned + borrowed)
  returning the ordered route ids from endpoint a to endpoint b (for the sweep).
- `liveTicketPoints(snapshot): number` — sum of completed kept-ticket values (for the instant score
  bump on the local player).

### `useAnimationDriver(snapshot)` (hook, mounted once in `GameScreen`)

Holds `prevSnapshot` + `prevCompleted` refs. On each new `lastBatch`/snapshot it computes intents via
`animationModel` and a completed-set diff, then dispatches them into the animation store. The first
snapshot only **initializes** the refs (no firing) so reconnect/resume never replays a stale fanfare.

### `store/animations.ts` (zustand)

Transient animation state the views render from: `glowingRoutes`/`glowingStations` (id→expiry),
`flights` (in-flight cards), `floats` (score `+N`s), `turnCue`, `marketFlips`, and the current
`fanfare` (the active ticket-completion overlay, or null). Entries self-expire.

### `<AnimationLayer/>` (fixed viewport portal)

Renders flights, score floats, and the fanfare above the board. Uses FLIP
(`getBoundingClientRect`) between **tagged DOM anchors**: the deck button, each market slot, the hand
tray, and each tracker row (`data-anim="deck|market-slot|hand|tracker"`, `data-player-id`,
`data-slot`). Board-space anchors (city markers) carry `data-city` so the fanfare can locate the
start/end stations on screen for the sweep and confetti origins.

### `useReducedMotion()`

Small hook over `matchMedia('(prefers-reduced-motion: reduce)')`, consumed by the driver and layer.

## Per-item implementation

1. **Draw fly (item 1).** `CardTakenFaceup`/`CardDrawnBlind` → `cardFly` intent. Source rect = clicked
   deck/market slot; target = hand tray (self) or tracker row (opponent). Self → real card face
   (reuse `TrainCarCard`, read-only); opponent → `FlyingCard variant="cover"` (branded back). Deck
   count ticks as it lands.
2. **Ticket dialog (item 2).** `KeepTicketsModal`: offered cards get a staggered slide-up on mount
   (CSS). On confirm, kept cards fly to the tickets tray anchor (`data-anim="tickets"`); discards fade.
3. **Claim/station glow (item 3).** `glowRoute`/`glowStation` intents add a transient class the
   `Board` reads (`route.just-claimed` draws a seat-colour bloom along `g.path`; `.station.just-built`
   pops + ring). ~1.2s, auto-expire.
4. **Ticket fanfare (item 4).** `ticketComplete` intent opens the fanfare overlay: dim board,
   enlarged ticket card, "任務完成 / Ticket Complete" + value, confetti (long-haul = larger/longer
   burst). Simultaneously, the board sweeps a seat-colour glow along `path` from start→end (staggered
   per-segment draw-on via an SVG overlay). Instant: `+N` float + local score bump. Skip via click /
   Esc / auto-dismiss; hard cap < 7s. Reduced-motion → static banner, no confetti/sweep.
5. **Extras.**
   - **Turn cue:** `TurnStarted` → pulse the new current tracker; stronger "your turn" pulse when it's
     the local player.
   - **Score `+N`:** `RouteClaimed.points_awarded` → float + count-up near the owner's tracker score;
     plus the ticket-completion `+N` (item 4).
   - **Market flip:** changed market slots (diff vs prev snapshot, or `MarketRefilled`) flip-in.
   - **Tunnel flip:** the 3 revealed cards in `TunnelModal` flip one-by-one (staggered) on mount.

## Score display

The local player's displayed total becomes `routePoints (snapshot) + liveTicketPoints(snapshot)`,
animated on increment. Opponents show snapshot `routePoints` only (ticket points hidden until
game-over). Applies to `PlayerTrackers` (and any HUD score readout).

## Testing & verification

- **Unit (vitest, TDD):** `game/tickets.ts` (completion, path, live points incl. station-borrow and
  reconnect-no-fire), `game/animationModel.ts` (events → intents, including opponent-cover and
  self-real-card branches).
- **Component (Testing-Library):** fanfare renders + skip (click/Esc/auto) + reduced-motion banner;
  driver fires once per transition and not on first snapshot.
- **Manual:** `yarn workspace @trm/web dev` against a dev server with bots auto-playing; observe
  draws/claims/glows/turn cue/market flip/tunnel flip; force a ticket completion to film the fanfare.
  Capture a GIF.

## Commit hygiene

Parent branch `feat/url-routing-reload-state` has unrelated uncommitted WIP (PaymentModal,
RoomScreen, rest.ts, payments, TrainCarCard, global.css, vitest.setup, new tests). Work happens on
`feat/ingame-animations`; only animation files are staged/committed. The WIP is left untouched.

## Out of scope

- Sound effects.
- A user-facing animation on/off toggle beyond OS `prefers-reduced-motion` (can be added later).

---

## REVISION 1 (2026-06-28) — finished tickets are public; instant points for all

Supersedes the earlier "instant ticket scoring is self-only" decision. User decisions:

- **Finished tickets are not secret.** Once a player completes a ticket it is revealed to everyone
  (in-progress tickets stay secret). The client cannot derive an opponent's tickets, so this needs a
  small **backend** change to reveal finished tickets through the sanctioned projection.
- **Own-track instant completion.** A ticket counts as completed — instantly, permanently, points
  awarded, revealed, animated — the moment the player's **own** routes connect its two cities (no
  station borrowing in the instant trigger). Such a ticket is _guaranteed_ to also count at game-end,
  so **end-game scoring and the station-borrow optimisation are unchanged** and the live total can
  never diverge from the final. The rare ticket completable only via a station borrow resolves at
  game-end exactly as today (no instant award for it).
- **Fanfare scope:** the local player's completion → full-screen confetti fanfare + board sweep; an
  opponent's completion → _subtle_ cue (revealed ticket near their tracker + board path glow in their
  seat colour + score float), **no** full-screen takeover.

### Backend changes (security-preserving)

`PublicPlayerState` stays **COUNTS ONLY** (risk #1 invariant) — we do **not** put ticket ids on it.
Instead add a separate, explicitly-public collection:

- **proto** (`common.proto`): new `message CompletedTicket { string player_id = 1; string ticket_id = 2; }`
  and `repeated CompletedTicket completed_tickets = N;` on `GameSnapshot`. Regenerate (`buf`).
- **engine**:
  - `graph/connectivity.ts`: add pure `ownConnectedTicketIds({ ownEdges, tickets, vertices }): string[]`
    (union-find over own edges; `tickets` carry `{ id, a, b }`).
  - `selectors.ts`: change `redactFor(state, viewer)` → `redactFor(board, state, viewer)`; compute each
    player's own-track completed tickets (route endpoints from `board`, kept tickets + ownership from
    `state`) and add `completedTickets: { player; ticket }[]` to `RedactedView` (`types/view.ts`).
    Visible to all viewers — these are public.
  - update the single prod caller `game-session.project` → `redactFor(this.board, this.state, viewer)`
    and the 3 calls in `test/redact.spec.ts`.
- **server codec** (`codec/snapshot.ts`): map `view.completedTickets` → proto `completed_tickets`.
- **tests:** `connectivity.spec.ts` for `ownConnectedTicketIds`; `redact.spec.ts` asserts completed
  own-track tickets surface in `completedTickets` for all viewers and incomplete ones do not; the wire
  leak e2e remains valid (it asserts no in-progress secrets; `completed_tickets` is sanctioned public).

### Web changes (vs the original plan)

- Completion is now read from the wire (`snapshot.completedTickets`), authoritative for **all**
  players — not derived locally. So `game/tickets.ts` reduces to: `pathForTicket(snapshot, playerId,
ticketId)` (BFS over that player's public owned routes between the ticket's endpoints, for the
  sweep) and `playerLiveTotal(snapshot, playerId)` (= `routePoints` + Σ value of that player's
  `completedTickets`).
- `useAnimationDriver` diffs `snapshot.completedTickets` (per player) across snapshots to fire
  completion intents — `ticketComplete` carries `{ playerId, ticketId, isYou, long, seat, path }`.
  Self → full-screen fanfare; opponent → subtle cue. First snapshot initialises without firing.
- Score display: **every** player's tracker total = `playerLiveTotal` (not just self).
- The opponent-subtle cue: a small revealed `TicketCard` floating near the owner's tracker
  (`data-player-id`) for ~2.5s + the board path glow + a score float; no backdrop.
