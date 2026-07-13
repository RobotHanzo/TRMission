# Deadlock end-sequence + Pass button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the train-card deadlock — when the card pool is dead and no one can build, a stuck player's only move becomes `PASS` (bots auto-pass, humans click a new Pass button), the end sequence begins with a distinct deadlock banner, and the game concludes with correct scores.

**Architecture:** A pure-engine rule change (extract legality predicates into a new leaf module; drop the "draw tickets" escape hatch when a player has no productive move; add a deadlock endgame trigger) plus a per-viewer `youMustPass` projection flag and an endgame `reason`, threaded through proto → codec → web (Pass button + notification copy).

**Tech Stack:** TypeScript monorepo (Yarn 4 + Turborepo). `@trm/engine` (pure reducer, vitest), `@trm/proto` (protobuf-es via buf), `@trm/codec` (engine⇄wire), `apps/web` (React + Vite + vitest + @testing-library/react).

## Global Constraints

- **Determinism (ADR A4):** `@trm/engine` is ESLint-banned from `Date`/`Math.random`/`crypto.randomUUID`/`new Date()`. The new predicates read state only and consume **no RNG**.
- **A15 termination guarantee:** `PASS` is legal **iff** the acting player has no other legal move. The `events-property.spec` invariant `hasPass ⟺ !hasAnyLegalMove` MUST keep holding.
- **Version pins:** any reducer behavior change bumps `ENGINE_VERSION` (replay refuses to cross versions). `stateDigest` hashes the whole state incl. `engineVersion`, so the bump changes all digests — engine digest tests recompute dynamically (no hardcoded golden digests exist to edit).
- **`GameState` stays minimal:** the endgame `reason` rides the **event**, never the persisted state.
- **Hidden info (risk #1):** never widen a public wire type to carry a secret. `youMustPass` is a boolean on the owner-only `SelfView`.
- **Wire 1:1:** an engine event/field change touches the `.proto` (regenerate), `@trm/codec`, and the web in lock-step. Reuse the existing `NOTHING_TO_DRAW` rule-violation code (no new error taxonomy entry).
- **Copy:** UI ships zh-Hant (primary) + en. The 6th colour is PURPLE. Bots are `id.startsWith('bot:')`.

---

### Task 1: Engine — extract legality predicates; a stuck player's sole move is PASS

**Files:**

- Create: `packages/engine/src/legality.ts`
- Modify: `packages/engine/src/reduce.ts` (remove the moved helpers + the ticket clause; guard `applyDrawTickets`; re-export `hasAnyLegalMove`)
- Modify: `packages/engine/src/turn.ts` (guard the rule-7.5 forced re-draw)
- Test: `packages/engine/test/deadlock.spec.ts` (new)

**Interfaces:**

- Produces:
  - `poolDead(state: GameState): boolean` — no drawable card anywhere (deck+discard empty AND no takeable market slot).
  - `canClaimAnyRoute(board: Board, state: GameState, player: PlayerId): boolean` — extracted from the current claim loop, byte-identical logic.
  - `noPlayerCanClaimRoute(board: Board, state: GameState): boolean` — `turnOrder.every(pid => !canClaimAnyRoute(...))`.
  - `hasAnyLegalMove(board, state, player): boolean` — now "has any **productive** move" (claim / build / draw / event action); the standalone ticket-deck clause is removed.
- Consumes (from existing modules, all leaves — no cycle): `board.ts` (`groupMembersOf`), `config.ts` (`openTrackCount`), `reducers/common.ts` (`getPlayer`), `hand.ts` (`totalCards`), `events/effects.ts` (`allSeatsReservedActive`, `claimsSuspended`, `closedRouteIds`, `skyLanternSurcharge`, `stationsSuspended`, `freeStationAvailable`, `canUseNightMarketSwap`, `hiveOfSparksActive`, `eventResources`).

- [ ] **Step 1: Create `legality.ts` by moving the predicates out of `reduce.ts`**

Create `packages/engine/src/legality.ts`. Move `hasAnyLegalMove` (currently `reduce.ts:1476`) and its private helpers `totalDiscard`, `canAffordCount`, `canAffordRoute` here. While moving, make two changes: (a) **delete** the ticket clause `if (state.ticketDeckShort.length > 0) return true;`, and (b) extract the claim loop into `canClaimAnyRoute`. Add `poolDead` and `noPlayerCanClaimRoute`.

```typescript
import type { PlayerId, CardColor } from '@trm/shared';
import { TRAIN_COLORS } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from './board';
import { groupMembersOf } from './board';
import type { GameState } from './types/state';
import type { CardCounts } from './hand';
import { totalCards } from './hand';
import { getPlayer } from './reducers/common';
import {
  allSeatsReservedActive,
  claimsSuspended,
  closedRouteIds,
  skyLanternSurcharge,
  stationsSuspended,
  freeStationAvailable,
  canUseNightMarketSwap,
  hiveOfSparksActive,
  eventResources,
} from './events/effects';

function totalDiscard(discard: Readonly<CardCounts>): number {
  let n = 0;
  for (const k of Object.keys(discard) as (keyof CardCounts)[]) n += discard[k];
  return n;
}

function canAffordCount(hand: Readonly<Record<CardColor, number>>, count: number): boolean {
  if (hand.LOCOMOTIVE >= count) return true;
  for (const c of TRAIN_COLORS) if (hand[c] + hand.LOCOMOTIVE >= count) return true;
  return false;
}

function canAffordRoute(
  hand: Readonly<Record<CardColor, number>>,
  route: RouteDef,
  extraCards = 0,
): boolean {
  const L = Math.max(0, route.length + extraCards);
  const F = route.ferryLocos;
  if (L < F) return false;
  if (hand.LOCOMOTIVE < F) return false;
  if (hand.LOCOMOTIVE >= L) return true;
  if (route.color === 'GRAY') {
    for (const c of TRAIN_COLORS) if (hand[c] + hand.LOCOMOTIVE >= L) return true;
    return false;
  }
  return hand[route.color] + hand.LOCOMOTIVE >= L;
}

/** No card can be drawn anywhere: deck+discard empty AND no takeable market slot. */
export function poolDead(state: GameState): boolean {
  if (state.deck.length + totalDiscard(state.discard) > 0) return false;
  return !state.market.some(
    (c) => c !== null && !(c === 'LOCOMOTIVE' && allSeatsReservedActive(state)),
  );
}

/** Can `player` claim at least one open route right now? (mirror of enumerateClaimPayments gates) */
export function canClaimAnyRoute(board: Board, state: GameState, player: PlayerId): boolean {
  const p = getPlayer(state, player);
  if (!p || claimsSuspended(state)) return false;
  const resources = eventResources(state, player);
  const closed = closedRouteIds(state);
  for (const route of board.content.routes) {
    if (state.ownership[route.id as string]) continue;
    if (closed.has(route.id as string)) continue;
    const ownsGroupMember = groupMembersOf(board, route.id).some((other) => {
      const sc = state.ownership[other as string];
      return sc && 'owner' in sc && sc.owner === player;
    });
    if (ownsGroupMember) continue;
    if (p.trainCars < route.length) continue;
    const maxReduction =
      (resources.bentoTokens > 0 ? 1 : 0) + (resources.claimDiscounts > 0 ? 1 : 0);
    const surcharge = skyLanternSurcharge(state, route.id);
    for (let reduction = 0; reduction <= maxReduction; reduction++) {
      if (canAffordRoute(p.hand, route, surcharge - reduction)) return true;
    }
  }
  return false;
}

/** True when NO player at the table can claim any open route (the deadlock end-sequence gate). */
export function noPlayerCanClaimRoute(board: Board, state: GameState): boolean {
  return state.turnOrder.every((pid) => !canClaimAnyRoute(board, state, pid));
}

/** Whether the player has ANY legal non-pass move. NOTE: drawing tickets is deliberately NOT a
 *  move here — a player whose only option would be a futile ticket draw in a dead pool must PASS. */
export function hasAnyLegalMove(board: Board, state: GameState, player: PlayerId): boolean {
  const p = getPlayer(state, player);
  if (!p) return false;
  const discardTotal = totalDiscard(state.discard);
  if (state.deck.length + discardTotal > 0) return true;
  if (
    state.market.some((c) => c !== null && !(c === 'LOCOMOTIVE' && allSeatsReservedActive(state)))
  )
    return true;
  if (
    !stationsSuspended(state) &&
    p.stationsRemaining > 0 &&
    state.stations.length < board.cityIds.length
  ) {
    if (freeStationAvailable(state)) return true;
    const built = state.ruleParams.stationsPerPlayer - p.stationsRemaining;
    const cost = built + 1;
    if (canAffordCount(p.hand, cost)) return true;
  }
  if (hiveOfSparksActive(state) && state.deck.length + discardTotal > 0) return true;
  const resources = eventResources(state, player);
  if (
    state.events?.active.some(
      (active) =>
        active.kind === 'SLOPE_REPAIR_ORDER' &&
        active.routeIds?.some(
          (rid) => !state.ownership[rid as string] && !state.events?.repairedRouteIds.includes(rid),
        ),
    ) &&
    (resources.repairPermits > 0 || canAffordCount(p.hand, 2))
  )
    return true;
  if (canUseNightMarketSwap(board, state, player)) return true;
  if (canClaimAnyRoute(board, state, player)) return true;
  return false;
}
```

- [ ] **Step 2: Rewire `reduce.ts` to import from `legality.ts` and guard `applyDrawTickets`**

In `reduce.ts`: delete the moved functions (`hasAnyLegalMove`, `totalDiscard`, `canAffordCount`, `canAffordRoute` — lines ~1476-1578). Import the moved `hasAnyLegalMove` (still used internally by `applyPass`) and re-export the local binding:

```typescript
import { hasAnyLegalMove } from './legality';
// ...at the bottom, replacing the old `export { hasAnyLegalMove };` re-export in selectors' import chain:
export { hasAnyLegalMove };
```

Then fix imports: some `@trm/shared` / `events/effects` names were used **only** by the moved helpers and are now unused in `reduce.ts` — `yarn lint` / `yarn typecheck` will flag them (expected: `TRAIN_COLORS` from `@trm/shared`, and `closedRouteIds` from `events/effects`). Remove exactly the ones flagged. (`selectors.ts:8` keeps `import { reduce, hasAnyLegalMove } from './reduce'` — still valid via the re-export; `index.ts:90` likewise.)

Change the `applyDrawTickets` dispatch to pass `board` (`reduce.ts:95`):

```typescript
        case 'DRAW_TICKETS':
          return applyDrawTickets(board, state, action.player);
```

Update `applyDrawTickets` to reject when the player has no productive move (stuck ⇒ must pass), reusing `NOTHING_TO_DRAW`:

```typescript
function applyDrawTickets(board: Board, state: GameState, player: PlayerId): ReduceResult {
  // A stuck player (dead pool, no productive move) may not draw futile tickets — PASS is their
  // sole legal move (A15). Otherwise draw as before; an empty short deck is still an error.
  if (!hasAnyLegalMove(board, state, player))
    return err(violation('NOTHING_TO_DRAW', 'no productive move — must pass'));
  const offer = offerTickets(state, player);
  if (!offer) return err(violation('NOTHING_TO_DRAW', 'ticket deck empty'));
  return ok(offer);
}
```

`selectors.ts` already does `import { reduce, hasAnyLegalMove } from './reduce'` and re-exports it — unchanged, since `reduce.ts` re-exports.

- [ ] **Step 3: Guard the rule-7.5 forced re-draw in `turn.ts`**

In `turn.ts`, add the import and guard the forced re-draw so a stuck player is never forced into a ticket draw. Change the block at `turn.ts:107`:

```typescript
import { hasAnyLegalMove, poolDead, noPlayerCanClaimRoute } from './legality';
// ...
if (
  next.turn.phase === 'AWAIT_ACTION' &&
  hasAnyLegalMove(board, next, nextPlayer) &&
  allKeptTicketsCompleted(board, next, nextPlayer)
) {
  const forced = offerTickets(next, nextPlayer);
  if (forced) {
    events.push(...forced.events);
    return { state: forced.state, events };
  }
}
```

(`poolDead`/`noPlayerCanClaimRoute` are imported now; they are used in Task 2.)

- [ ] **Step 4: Write the failing test**

Create `packages/engine/test/deadlock.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { asPlayerId, emptyHand, type SeatIndex } from '@trm/shared';
import { taiwanBoard, CONTENT_HASH } from '../src/taiwan';
import type { GameConfig } from '../src/config';
import type { GameState } from '../src/types/state';
import { initGame } from '../src/setup';
import { reduce } from '../src/reduce';
import { legalActions } from '../src/selectors';
import { hasAnyLegalMove } from '../src/legality';
import { cloneState } from '../src/serialize';
import { currentPlayerId } from '../src/turn';

/** Drive past SETUP_TICKETS so it is p0's turn in AWAIT_ACTION, then force a dead-pool state. */
function deadPool(handP0: Partial<Record<string, number>> = {}): {
  board: ReturnType<typeof taiwanBoard>;
  state: GameState;
} {
  const board = taiwanBoard();
  const players = [0, 1].map((i) => ({ id: asPlayerId(`p${i}`), seat: i as SeatIndex }));
  const config: GameConfig = { seed: 'deadlock', players, contentHash: CONTENT_HASH };
  let state = initGame(board, config);
  while (state.turn.phase === 'SETUP_TICKETS') {
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer);
    const offer = state.players[pid as string]?.pendingTicketOffer ?? [];
    const r = reduce(board, state, { t: 'KEEP_INITIAL_TICKETS', player: pid!, keep: [...offer] });
    if (!r.ok) throw new Error(`setup failed: ${r.error.code}`);
    state = r.value.state;
  }
  const s = cloneState(state);
  // Dead pool: no deck, no discard, empty market. Empty hands ⇒ no claim/build. Trains high so the
  // trains≤2 endgame path never fires. Short ticket deck kept non-empty on purpose.
  return {
    board,
    state: {
      ...s,
      deck: [],
      discard: emptyHand(),
      market: s.market.map(() => null),
      players: {
        p0: { ...s.players.p0!, hand: { ...emptyHand(), ...handP0 }, trainCars: 40 },
        p1: { ...s.players.p1!, hand: emptyHand(), trainCars: 40 },
      },
    },
  };
}

describe('dead-pool deadlock: a stuck player must PASS', () => {
  it('a stuck player has PASS as their sole legal action, and DRAW_TICKETS is rejected', () => {
    const { board, state } = deadPool();
    expect(state.ticketDeckShort.length).toBeGreaterThan(0); // the escape hatch we are closing
    const p0 = asPlayerId('p0');
    expect(hasAnyLegalMove(board, state, p0)).toBe(false);
    const acts = legalActions(board, state, p0);
    expect(acts.map((a) => a.t)).toEqual(['PASS']);
    const draw = reduce(board, state, { t: 'DRAW_TICKETS', player: p0 });
    expect(draw.ok).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it passes (implementation already landed in Steps 1-3)**

Run: `yarn workspace @trm/engine test --run deadlock`
Expected: PASS (the `deadlock.spec` case above).

- [ ] **Step 6: Run the engine suite to confirm no regressions in the legality mirrors**

Run: `yarn workspace @trm/engine test --run` (or at minimum: `--run events-property`, `--run termination`, `--run forcedTicketDraw`, `--run events-typhoon`, `--run events-gala`, `--run events-dayoff`, `--run draw-pool-exhausted`)
Expected: PASS. These pin `hasPass ⟺ !hasAnyLegalMove` and the station/typhoon `hasAnyLegalMove` mirrors; the reworked function keeps them true because every existing fixture that expects `hasAnyLegalMove === false` already has an empty short ticket deck.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/legality.ts packages/engine/src/reduce.ts packages/engine/src/turn.ts packages/engine/test/deadlock.spec.ts
git commit -m "feat(engine): a stuck player in a dead pool must PASS (no futile ticket draw)"
```

---

### Task 2: Engine — deadlock endgame trigger + `reason` on the event + version bump

**Files:**

- Modify: `packages/engine/src/types/events.ts` (add `reason` to `ENDGAME_TRIGGERED`)
- Modify: `packages/engine/src/turn.ts` (extend the trigger; emit `reason`)
- Modify: `packages/engine/src/types/state.ts` (`ENGINE_VERSION` 8 → 9 + comment)
- Test: `packages/engine/test/deadlock.spec.ts` (extend)

**Interfaces:**

- Consumes: `poolDead`, `noPlayerCanClaimRoute` (Task 1); the existing `Endgame`/countdown machinery.
- Produces: `ENDGAME_TRIGGERED` now carries `reason: 'FINAL_TRAINS' | 'DEADLOCK'`.

- [ ] **Step 1: Add `reason` to the `ENDGAME_TRIGGERED` event type**

In `packages/engine/src/types/events.ts`, extend the `ENDGAME_TRIGGERED` member:

```typescript
  | {
      readonly e: 'ENDGAME_TRIGGERED';
      readonly player: PlayerId;
      readonly finalTurnsRemaining: number;
      readonly reason: 'FINAL_TRAINS' | 'DEADLOCK';
      readonly visibility: 'PUBLIC';
    }
```

- [ ] **Step 2: Extend the trigger and emit `reason` in `turn.ts`**

Replace the trigger block at `turn.ts:33-49`:

```typescript
let endgame = state.endgame;
let triggeredNow = false;
const trainsTrigger = (player?.trainCars ?? Infinity) <= state.ruleParams.endgameTrainThreshold;
// Deadlock: the card pool is dead and no one can claim a route, so no one's trains will ever
// drop to the threshold. Begin the end sequence anyway.
const deadlockTrigger = !trainsTrigger && poolDead(state) && noPlayerCanClaimRoute(board, state);
if (!endgame.triggered && (trainsTrigger || deadlockTrigger)) {
  endgame = { triggered: true, triggerPlayerIndex: curIdx, finalTurnsRemaining: n };
  triggeredNow = true;
  events.push({
    e: 'ENDGAME_TRIGGERED',
    player: curPlayer,
    finalTurnsRemaining: n,
    reason: trainsTrigger ? 'FINAL_TRAINS' : 'DEADLOCK',
    visibility: 'PUBLIC',
  });
} else if (endgame.triggered) {
  endgame = { ...endgame, finalTurnsRemaining: endgame.finalTurnsRemaining - 1 };
}
```

- [ ] **Step 3: Bump `ENGINE_VERSION`**

In `packages/engine/src/types/state.ts`, add a version comment above `ENGINE_VERSION` and bump it to 9:

```typescript
// v9: deadlock end-sequence — a player with no productive move in a dead card pool must PASS
// (futile ticket draws are no longer forced), and the endgame is triggered when the pool is dead
// and no one can claim a route (ENDGAME_TRIGGERED gains `reason`). Off-path play is unchanged.
export const ENGINE_VERSION = 9;
```

- [ ] **Step 4: Write the failing test (extend `deadlock.spec.ts`)**

Append to `packages/engine/test/deadlock.spec.ts`:

```typescript
describe('dead-pool deadlock: the end sequence begins and the game ends', () => {
  it('a stuck table triggers ENDGAME_TRIGGERED reason=DEADLOCK and ends after a round of passes', () => {
    const { board, state } = deadPool();
    const p0 = asPlayerId('p0');
    const p1 = asPlayerId('p1');
    const r0 = reduce(board, state, { t: 'PASS', player: p0 });
    expect(r0.ok).toBe(true);
    if (!r0.ok) return;
    const trig = r0.value.events.find((e) => e.e === 'ENDGAME_TRIGGERED');
    expect(trig).toBeDefined();
    expect(trig && 'reason' in trig ? trig.reason : null).toBe('DEADLOCK');
    expect(r0.value.state.endgame.triggered).toBe(true);
    expect(currentPlayerId(r0.value.state)).toBe(p1);
    const r1 = reduce(board, r0.value.state, { t: 'PASS', player: p1 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.state.turn.phase).toBe('GAME_OVER');
    expect(r1.value.state.finalScores).not.toBeNull();
  });

  it('a player who can still build a station gets a real final turn (not skipped)', () => {
    // p0 can afford a first station (cost 1 card) but has 0 trains, so NO route is claimable by
    // anyone (routes require trains; stations do not). p1 is empty-handed. Advance to p1 so the
    // trigger fires on p1's pass and lands back on p0.
    const { board, state: base } = deadPool({ RED: 1 });
    const p1 = asPlayerId('p1');
    const p0 = asPlayerId('p0');
    const state: GameState = {
      ...base,
      turn: { ...base.turn, orderIndex: 1 },
      players: { ...base.players, p0: { ...base.players.p0!, trainCars: 0 } },
    };
    const r = reduce(board, state, { t: 'PASS', player: p1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.endgame.triggered).toBe(true);
    expect(currentPlayerId(r.value.state)).toBe(p0);
    const acts = legalActions(board, r.value.state, p0).map((a) => a.t);
    expect(acts).toContain('BUILD_STATION');
    expect(acts).not.toContain('PASS'); // p0 has a productive move, so PASS is illegal
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/engine test --run deadlock`
Expected: PASS (all three `deadlock.spec` cases).

- [ ] **Step 6: Run the full engine suite (version bump + trigger)**

Run: `yarn workspace @trm/engine test --run`
Expected: PASS. Engine digest tests recompute (no hardcoded golden digests); `off-mode-identity` strips `engineVersion`. If any spec constructs an `ENDGAME_TRIGGERED` event literal (grep `e: 'ENDGAME_TRIGGERED'` under `test/`), add `reason: 'FINAL_TRAINS'` to it.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/types/events.ts packages/engine/src/turn.ts packages/engine/src/types/state.ts packages/engine/test/deadlock.spec.ts
git commit -m "feat(engine): begin the end sequence on a dead-pool deadlock (ENGINE_VERSION 9)"
```

---

### Task 3: Engine projection — `youMustPass` on `RedactedView`

**Files:**

- Modify: `packages/engine/src/types/view.ts` (add `youMustPass`)
- Modify: `packages/engine/src/selectors.ts` (compute it in `redactFor`)
- Test: `packages/engine/test/redact.spec.ts` (extend)

**Interfaces:**

- Consumes: `hasAnyLegalMove` (Task 1), `RedactedView` (existing).
- Produces: `RedactedView.youMustPass: boolean` — true iff the viewer is the current player, in `AWAIT_ACTION`, with no legal move.

- [ ] **Step 1: Add the field to `RedactedView`**

In `packages/engine/src/types/view.ts`, add to `RedactedView` (near `currentPlayer`):

```typescript
  /** True iff `viewer` is the current player in AWAIT_ACTION with no legal move — surface a Pass
   *  control. Always false for opponents/spectators (the client cannot derive it from a redacted
   *  snapshot). */
  readonly youMustPass: boolean;
```

- [ ] **Step 2: Compute it in `redactFor`**

In `packages/engine/src/selectors.ts`, `redactFor` already imports `hasAnyLegalMove` and `currentPlayerId`. Add before the `return {`:

```typescript
const youMustPass =
  state.turn.phase === 'AWAIT_ACTION' &&
  viewer !== null &&
  viewer === (state.turnOrder[state.turn.orderIndex] as PlayerId) &&
  !hasAnyLegalMove(board, state, viewer);
```

Add `youMustPass,` to the returned object (next to `currentPlayer`).

- [ ] **Step 3: Write the failing test (extend `redact.spec.ts`)**

Add to `packages/engine/test/redact.spec.ts` (follow the file's existing board/state setup helpers):

```typescript
it('youMustPass is true only for the stuck current player and false for others', () => {
  const { board, state } = deadPoolFixture(); // build a dead-pool AWAIT_ACTION state for p0 (see deadlock.spec deadPool())
  const p0 = asPlayerId('p0');
  const p1 = asPlayerId('p1');
  expect(redactFor(board, state, p0).youMustPass).toBe(true);
  expect(redactFor(board, state, p1).youMustPass).toBe(false);
  expect(redactFor(board, state, null).youMustPass).toBe(false);
});
```

If `redact.spec.ts` has no dead-pool helper, inline the same override used in `deadlock.spec` (`deck:[]`, `discard: emptyHand()`, `market: map(()=>null)`, empty hands, `trainCars: 40`).

- [ ] **Step 4: Run the test**

Run: `yarn workspace @trm/engine test --run redact`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/types/view.ts packages/engine/src/selectors.ts packages/engine/test/redact.spec.ts
git commit -m "feat(engine): surface youMustPass on the redacted view"
```

---

### Task 4: Proto — `SelfView.you_must_pass` + `EndgameTriggered.reason`; regenerate

**Files:**

- Modify: `packages/proto/proto/trmission/v1/common.proto` (`SelfView`)
- Modify: `packages/proto/proto/trmission/v1/server.proto` (`EndgameTriggered`)

**Interfaces:**

- Produces: generated `SelfView.youMustPass: boolean` and `EndgameTriggered.reason: string` (protobuf-es camelCases the field names).

- [ ] **Step 1: Add the SelfView field**

In `packages/proto/proto/trmission/v1/common.proto`, `message SelfView` (currently fields 1-4):

```proto
message SelfView {
  string player_id = 1;
  CardCounts hand = 2;
  repeated string kept_ticket_ids = 3;
  repeated string pending_offer_ticket_ids = 4;
  bool you_must_pass = 5; // true ⇒ show a Pass control (current player, AWAIT_ACTION, no legal move)
}
```

- [ ] **Step 2: Add the EndgameTriggered reason field**

In `packages/proto/proto/trmission/v1/server.proto`, `message EndgameTriggered`:

```proto
message EndgameTriggered {
  string player_id = 1;
  uint32 final_turns_remaining = 2;
  string reason = 3; // "FINAL_TRAINS" | "DEADLOCK" (mirrors engine ENDGAME_TRIGGERED.reason)
}
```

- [ ] **Step 3: Regenerate and verify**

Run: `yarn workspace @trm/proto generate && yarn workspace @trm/proto test`
Expected: codegen writes `src/gen/**`; proto round-trip tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/proto/proto/trmission/v1/common.proto packages/proto/proto/trmission/v1/server.proto
git commit -m "feat(proto): SelfView.you_must_pass + EndgameTriggered.reason"
```

---

### Task 5: Codec — map `youMustPass` and endgame `reason`

**Files:**

- Modify: `packages/codec/src/snapshot.ts` (`you` block)
- Modify: `packages/codec/src/events.ts` (`endgameTriggered` case)
- Test: `packages/codec/test/codec.spec.ts` (extend)

**Interfaces:**

- Consumes: `RedactedView.youMustPass` (Task 3), `GameEvent` `ENDGAME_TRIGGERED.reason` (Task 2), generated proto fields (Task 4).

- [ ] **Step 1: Map `youMustPass` in the snapshot codec**

In `packages/codec/src/snapshot.ts`, add to the `you` object literal (`snapshot.ts:152`):

```typescript
    you:
      self === undefined || self.hand === null
        ? undefined
        : {
            playerId: self.id as string,
            hand: handToCardCounts(self.hand),
            keptTicketIds: (self.keptTickets ?? []).map((id) => id as string),
            pendingOfferTicketIds: (self.pendingTicketOffer ?? []).map((id) => id as string),
            youMustPass: view.youMustPass,
          },
```

- [ ] **Step 2: Map `reason` in the events codec**

In `packages/codec/src/events.ts`, `ENDGAME_TRIGGERED` case (`events.ts:111`):

```typescript
    case 'ENDGAME_TRIGGERED':
      return wrap({
        case: 'endgameTriggered',
        value: {
          playerId: ev.player as string,
          finalTurnsRemaining: ev.finalTurnsRemaining,
          reason: ev.reason,
        },
      });
```

- [ ] **Step 3: Write the failing test (extend `codec.spec.ts`)**

Add to `packages/codec/test/codec.spec.ts`:

```typescript
it('carries youMustPass on the self view and reason on the endgame event', () => {
  // viewToSnapshot: build a minimal RedactedView with youMustPass true and a self player (follow
  // the file's existing baseView helper; set youMustPass: true and a viewer with a visible hand).
  const snap = viewToSnapshot({ ...baseView, youMustPass: true }, 1, p0);
  expect(snap.you?.youMustPass).toBe(true);

  const ev = eventToProto(
    {
      e: 'ENDGAME_TRIGGERED',
      player: p0,
      finalTurnsRemaining: 2,
      reason: 'DEADLOCK',
      visibility: 'PUBLIC',
    },
    p0,
  );
  expect(ev?.event.case).toBe('endgameTriggered');
  expect(ev?.event.case === 'endgameTriggered' ? ev.event.value.reason : '').toBe('DEADLOCK');
});
```

(Reuse the file's existing `baseView`, `p0`, `viewToSnapshot`, `eventToProto` imports. If `baseView` lacks `youMustPass`, add `youMustPass: false` to it so the existing tests still typecheck.)

- [ ] **Step 4: Run codec tests**

Run: `yarn workspace @trm/codec test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/codec/src/snapshot.ts packages/codec/src/events.ts packages/codec/test/codec.spec.ts
git commit -m "feat(codec): map youMustPass + endgame reason"
```

---

### Task 6: Web — Pass/Skip button gated on `youMustPass`

**Files:**

- Modify: `apps/web/src/screens/GameStage.tsx` (add the button in `hud-actions`)
- Modify: `apps/web/src/i18n/index.ts` (`passTurn` label, both locales)
- Test: `apps/web/src/screens/GameStage.events.test.tsx` (extend)

**Interfaces:**

- Consumes: `snapshot.you?.youMustPass` (Task 5), `commands.pass()` (existing on `GameCommands`).

- [ ] **Step 1: Add the button**

In `apps/web/src/screens/GameStage.tsx`, inside the `hud-actions` div (right before its closing `</div>` at line 594):

```tsx
{
  canAct && snapshot.you?.youMustPass && (
    <button
      type="button"
      className="accent"
      data-anim="pass-turn"
      onClick={() => {
        markFirstAction('pass');
        commands?.pass();
      }}
    >
      {t('passTurn')}
    </button>
  );
}
```

- [ ] **Step 2: Add the i18n label (both locales)**

In `apps/web/src/i18n/index.ts`, add next to `drawTickets` in each block:

- zh-Hant (near line 185): `passTurn: '略過回合（無法行動）',`
- en (near line 931): `passTurn: 'Skip turn (no moves)',`

- [ ] **Step 3: Write the failing test (extend `GameStage.events.test.tsx`)**

Add a `describe` block. The `snap()` helper's `you` accepts `youMustPass` once the proto field exists:

```tsx
describe('GameStage Pass button', () => {
  it('shows a Pass button only when youMustPass and dispatches pass()', () => {
    const commands = { pass: vi.fn() } as unknown as GameCommands;
    const stuck = snap(Phase.AWAIT_ACTION, undefined, {
      hand: {
        playerId: 'p0',
        hand: {},
        keptTicketIds: [],
        pendingOfferTicketIds: [],
        youMustPass: true,
      },
    });
    const { unmount } = render(
      <GameStage snapshot={stuck} commands={commands} onLeave={() => {}} sandbox />,
    );
    const btn = screen.getByRole('button', { name: i18n.t('passTurn') });
    fireEvent.click(btn);
    expect(commands.pass).toHaveBeenCalledTimes(1);
    unmount();

    const notStuck = snap(Phase.AWAIT_ACTION, undefined); // default you has no youMustPass
    render(<GameStage snapshot={notStuck} commands={commandSpies()} onLeave={() => {}} sandbox />);
    expect(screen.queryByRole('button', { name: i18n.t('passTurn') })).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `yarn workspace @trm/web test --run GameStage.events`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/GameStage.tsx apps/web/src/i18n/index.ts apps/web/src/screens/GameStage.events.test.tsx
git commit -m "feat(web): Pass/Skip button when the player has no legal moves"
```

---

### Task 7: Web — "skipped" + deadlock-endgame notifications

**Files:**

- Modify: `apps/web/src/game/logModel.ts` (thread `reason` into the `endgame` datum)
- Modify: `apps/web/src/components/LogPanel.tsx` (deadlock endgame line)
- Modify: `apps/web/src/store/animations.ts` (`EndgameCue.reason`; `showEndgameWarning` param)
- Modify: `apps/web/src/hooks/useAnimationDriver.ts` (capture the event `reason` and pass it)
- Modify: `apps/web/src/components/EndgameWarning.tsx` (deadlock sub-note)
- Modify: `apps/web/src/i18n/index.ts` (`log.passed` copy, `log.endgameDeadlock`, endgame banner deadlock strings, both locales)
- Test: `apps/web/src/game/logModel.test.ts` (extend)

**Interfaces:**

- Consumes: proto `EndgameTriggered.reason` (Task 4), the existing `passed`/`endgame` log kinds and `showEndgameWarning`.
- Produces: `showEndgameWarning(finalTurns: number, triggeredByYou: boolean, deadlock: boolean)`; `EndgameCue.reason: 'FINAL_TRAINS' | 'DEADLOCK'`.

- [ ] **Step 1: Thread `reason` into the endgame log datum**

In `apps/web/src/game/logModel.ts`, the `endgameTriggered` case (line 134):

```typescript
      case 'endgameTriggered':
        out.push({
          kind: 'endgame',
          playerId: ev.value.playerId,
          data: { turns: ev.value.finalTurnsRemaining, reason: ev.value.reason || 'FINAL_TRAINS' },
          importance: 'alert',
        });
        break;
```

- [ ] **Step 2: Render the deadlock endgame line in `LogPanel`**

In `apps/web/src/components/LogPanel.tsx`, replace the `endgame` case (line 109):

```typescript
      case 'endgame':
        return e.data.reason === 'DEADLOCK'
          ? t('log.endgameDeadlock')
          : t('log.endgame', { turns: e.data.turns });
```

- [ ] **Step 3: Add `reason` to the endgame cue + `showEndgameWarning`**

In `apps/web/src/store/animations.ts`: extend `EndgameCue` and the action signature/impl:

```typescript
export interface EndgameCue {
  id: number;
  finalTurns: number;
  triggeredByYou: boolean;
  /** true ⇒ the end sequence began because the table deadlocked (no routes claimable). */
  deadlock: boolean;
}
// ...in the actions interface:
  showEndgameWarning(finalTurns: number, triggeredByYou: boolean, deadlock: boolean): void;
// ...in the implementation:
  showEndgameWarning: (finalTurns, triggeredByYou, deadlock) =>
    set({ endgameCue: { id: nextId(), finalTurns, triggeredByYou, deadlock } }),
```

- [ ] **Step 4: Capture the event reason in the animation driver and pass it**

In `apps/web/src/hooks/useAnimationDriver.ts`, add a ref that a `lastBatch` effect keeps updated, and pass it into the (state-driven) endgame effect. Add near the other refs:

```typescript
const endgameReasonRef = useRef<'FINAL_TRAINS' | 'DEADLOCK'>('FINAL_TRAINS');
```

Add an effect (declared BEFORE the endgame-warning effect) that records the reason from the delivered batch:

```typescript
useEffect(() => {
  const events = lastBatch?.events ?? [];
  for (const e of events) {
    if (e.event.case === 'endgameTriggered') {
      endgameReasonRef.current = e.event.value.reason === 'DEADLOCK' ? 'DEADLOCK' : 'FINAL_TRAINS';
    }
  }
}, [lastBatch]);
```

Update the endgame-warning call (line 127):

```typescript
showEndgameWarning(
  eg.finalTurnsRemaining,
  !!me && triggerId === me,
  endgameReasonRef.current === 'DEADLOCK',
);
```

- [ ] **Step 5: Render the deadlock sub-note in `EndgameWarning`**

In `apps/web/src/components/EndgameWarning.tsx`, use the cue's `deadlock` flag for the subtitle/note:

```tsx
        <div className="endgame-sub">
          {cue.deadlock
            ? t('endgameByDeadlock')
            : cue.triggeredByYou
              ? t('endgameByYou')
              : t('endgameByOther')}
        </div>
        <div className="endgame-note">{cue.deadlock ? t('endgameNoteDeadlock') : t('endgameNote')}</div>
```

- [ ] **Step 6: Add / update i18n strings (both locales)**

In `apps/web/src/i18n/index.ts`:

zh-Hant — update `log.passed` (line 422) and add keys:

```typescript
        passed: '{{name}} 無法行動，跳過',
        endgameDeadlock: '最終回合：已無法再鋪設任何路線',
```

zh-Hant banner block (near line 252):

```typescript
      endgameByDeadlock: '已無人能再鋪設路線——終局開始！',
      endgameNoteDeadlock: '無法行動的玩家將自動跳過',
```

en — update `log.passed` (line 1187) and add keys:

```typescript
        passed: '{{name}} skipped — no possible moves',
        endgameDeadlock: 'Final round — no more routes can be built',
```

en banner block (near line 999):

```typescript
      endgameByDeadlock: 'No more routes can be built — the final round begins!',
      endgameNoteDeadlock: 'Players with no possible moves are skipped',
```

- [ ] **Step 7: Write the failing test (extend `logModel.test.ts`)**

Add to `apps/web/src/game/logModel.test.ts`:

```typescript
it('carries the endgame reason into the log datum', () => {
  const deadlock = entriesFromEvents([
    ev({
      case: 'endgameTriggered',
      value: { playerId: 'p1', finalTurnsRemaining: 2, reason: 'DEADLOCK' },
    }),
  ]);
  expect(deadlock[0]).toMatchObject({ kind: 'endgame', data: { reason: 'DEADLOCK' } });

  const trains = entriesFromEvents([
    ev({
      case: 'endgameTriggered',
      value: { playerId: 'p1', finalTurnsRemaining: 2, reason: 'FINAL_TRAINS' },
    }),
  ]);
  expect(trains[0]).toMatchObject({ kind: 'endgame', data: { reason: 'FINAL_TRAINS' } });
});
```

- [ ] **Step 8: Run web tests**

Run: `yarn workspace @trm/web test --run logModel && yarn workspace @trm/web test --run GameStage`
Expected: PASS. (If the existing `logModel.test.ts` endgame assertion uses `toEqual` on the datum, update its expected `data` to include `reason: 'FINAL_TRAINS'`.)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/game/logModel.ts apps/web/src/components/LogPanel.tsx apps/web/src/store/animations.ts apps/web/src/hooks/useAnimationDriver.ts apps/web/src/components/EndgameWarning.tsx apps/web/src/i18n/index.ts apps/web/src/game/logModel.test.ts
git commit -m "feat(web): skipped + deadlock end-sequence notifications"
```

---

### Task 8: Whole-repo verification

**Files:** none (validation only).

- [ ] **Step 1: Typecheck + lint + test across the monorepo**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: all PASS. Pay attention to `apps/server` e2e specs (`bots.e2e`, `bots-5p.e2e`, `wire-game.e2e`, `codec.spec`, `history-replay-compat`) — they consume the engine + codec; the version bump and new fields must not break the wire round-trip or the leak test. `history-replay-compat.spec` intentionally stores an `engineVersion: 8` fixture as _old_ data — it should still pass under current version 9.

- [ ] **Step 2: Drive the change end-to-end (verify skill)**

Invoke the `verify` skill (or `yarn workspace @trm/server dev` + `@trm/web dev` with `TRM_DEV_GAME=1`) and drive a game into the deadlock, confirming: bots auto-pass, a stuck human sees the Pass button, the deadlock endgame banner + "skipped — no possible moves" log lines appear, and the game reaches GAME_OVER with scores.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`
Expected: graph refreshed (AST-only, no API cost).

- [ ] **Step 4: Final commit (if verification produced fixups)**

```bash
git add -p
git commit -m "chore: verification fixups for deadlock end-sequence"
```
