# Per-Game Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a room host configure five per-game settings on the lobby screen — three deterministic engine rule variants plus room visibility and spectating — and add a public-rooms list with live-game spectating.

**Architecture:** Two disjoint planes. Rule variants ride the engine's existing `RuleParams` (config → `initGame` → `GameState.ruleParams` → digest → replay) so determinism is inherited. Server/UX settings live on the Mongo `RoomDoc`. "Instant ticket completion" is mechanical: completed tickets are recorded in `PlayerState.completedTickets` the moment they connect (a monotonic, lock-in-safe invariant under unlimited borrow). Full spectating reuses the engine's existing `null`-viewer projection, wired through a `seat = -1` ws-ticket sentinel.

**Tech Stack:** Yarn 4 + Turborepo, TS (strict, ESM), vitest, NestJS + Mongo (mongodb-memory-server in tests), protobuf-es via buf, React + Vite 5 + zustand + react-i18next.

## Global Constraints

- **Determinism (ADR A4):** `@trm/engine` is ESLint-banned from `Date`, `new Date()`, `Math.random`, `crypto.randomUUID`, `Date.now`. All randomness comes from `GameState.rng` (seeded counter PRNG). The three rule booleans must NEVER feed the PRNG — they only branch deterministic logic. `stateDigest(replay) === stateDigest(live)` after every legal action is a CI gate.
- **6th colour is PURPLE** everywhere (never PINK). The rainbow/wild card enum value is `LOCOMOTIVE`.
- **Hidden info (risk #1):** opponents are counts-only `PublicPlayerState`; the viewer's secrets live in `SelfView` (`you`), unset for spectators. Never add a secret-bearing field to a public type. All egress goes through `redactFor`.
- **swc, not tsx** for server runtime/tests. Don't change.
- **Vite pinned at ^5** in `apps/web`. Don't bump.
- **Proto codegen:** after any `.proto` edit, run `yarn workspace @trm/proto generate`. `src/gen/**` is gitignored; drift is a CI failure.
- **Naming/tooling pins:** seat colours are abstract indices on the wire. Keep the error taxonomy 1:1 across engine `RuleViolationCode` → proto `RejectionCode` → REST → i18n.
- **Defaults:** `unlimitedStationBorrow=false`, `secondDrawAfterBlindRainbow=false`, `noUnfinishedTicketPenalty=false`, `allowSpectating=true`, `roomVisibility/visibility='PUBLIC'`.
- **Commit style:** end commit messages with the repo's required `Co-Authored-By` / `Claude-Session` trailers (see existing commits). Run on branch `feat/per-game-settings`.
- **Decisions locked (from brainstorming §9/§10):** instant completion = lock points in state; spectating = full browse-&-watch; settings on the lobby panel frozen at start; accept that the `ENGINE_VERSION` bump makes pre-existing v1 saves un-replayable; surface live banked ticket points (derived client-side); allow guests to watch.

## File Structure

**Created:**
- (none new in engine — additions go into existing files)
- `apps/server/src/lobby/lobby.public.controller.ts` — unauthenticated public-rooms list endpoint.

**Modified — shared/engine:**
- `packages/shared/src/constants.ts` — three booleans on `RuleParams` + defaults.
- `packages/engine/src/types/state.ts` — `PlayerState.completedTickets`; bump `ENGINE_VERSION`.
- `packages/engine/src/types/events.ts` — `TICKET_COMPLETED` event.
- `packages/engine/src/types/view.ts` — (no shape change; `completedTickets` already present).
- `packages/engine/src/graph/connectivity.ts` — `borrowConnectedTicketIds`; penalty flag in `evaluateTickets`.
- `packages/engine/src/scoring.ts` — `stationBorrowEdges`; `evaluatePlayerTickets` variant branches.
- `packages/engine/src/reduce.ts` — `secondDrawAfterBlindRainbow`; `lockCompletedTickets` + hooks.
- `packages/engine/src/selectors.ts` — `redactFor` sources completion from state when unlimited.
- `packages/engine/src/setup.ts` — init `completedTickets: []`.

**Modified — proto/server:**
- `packages/proto/proto/trmission/v1/common.proto` — `GameSettings` + `GameSnapshot.game_settings`.
- `apps/server/src/codec/snapshot.ts` — project `game_settings`.
- `apps/server/src/lobby/room.repo.ts` — `RoomDoc.settings`; `updateSettings`; `findPublic`.
- `apps/server/src/lobby/lobby.schemas.ts` — `GameSettingsSchema`/DTO; `settings` on `RoomViewSchema`.
- `apps/server/src/lobby/lobby.service.ts` — `updateSettings`, `listPublic`, `spectateTicket`; `start()` passes `ruleParams`; `toView` includes `settings`.
- `apps/server/src/lobby/lobby.controller.ts` — `PATCH /:code/settings`, `POST /:code/spectate`.
- `apps/server/src/lobby/lobby.module.ts` — register the public controller.
- `apps/server/src/ws/ticket.ts` / `connection.ts` / `hub.ts` — spectator binding (`seat = -1`), spectator set, fan-out, command rejection.

**Modified — web:**
- `apps/web/src/net/rest.ts` — `RoomView.settings`, `getPublicRooms`, `updateRoomSettings`, `spectate`.
- `apps/web/src/i18n/index.ts` — keys in `zh-Hant` + `en`.
- `apps/web/src/screens/RoomScreen.tsx` — host-only `GameSettingsPanel`.
- `apps/web/src/screens/HomeScreen.tsx` — public-rooms list (Join/Watch).
- `apps/web/src/screens/GameScreen.tsx` — spectator banner; banked ticket points in score.
- `apps/web/src/store/ui.ts` — `enterGame` carries a spectator flag (if needed for banner).

---

## Phase A — Shared foundation

### Task A1: Add the three rule-variant booleans to `RuleParams`

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Test: `packages/shared/test/constants.spec.ts` (create if absent)

**Interfaces:**
- Produces: `RuleParams.unlimitedStationBorrow: boolean`, `RuleParams.secondDrawAfterBlindRainbow: boolean`, `RuleParams.noUnfinishedTicketPenalty: boolean`; all `false` in `DEFAULT_RULE_PARAMS`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_RULE_PARAMS } from '../src/constants';

describe('RuleParams rule variants', () => {
  it('defaults all three variant flags to false', () => {
    expect(DEFAULT_RULE_PARAMS.unlimitedStationBorrow).toBe(false);
    expect(DEFAULT_RULE_PARAMS.secondDrawAfterBlindRainbow).toBe(false);
    expect(DEFAULT_RULE_PARAMS.noUnfinishedTicketPenalty).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/shared test --run constants`
Expected: FAIL (properties undefined / type error).

- [ ] **Step 3: Implement**

In `RuleParams` interface add (after `routePoints`):
```ts
  /** Variant: a station may borrow ALL incident opponent routes (not just one), and ticket
   *  completion is recorded + scored the moment it connects. */
  unlimitedStationBorrow: boolean;
  /** Variant: a rainbow (LOCOMOTIVE) as the first BLIND draw does NOT end the draw. */
  secondDrawAfterBlindRainbow: boolean;
  /** Variant: unfinished destination tickets score 0 instead of subtracting their value. */
  noUnfinishedTicketPenalty: boolean;
```
In `DEFAULT_RULE_PARAMS` add (before the closing `})`):
```ts
  unlimitedStationBorrow: false,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/shared test --run constants`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `yarn workspace @trm/shared typecheck`
```bash
git add packages/shared/src/constants.ts packages/shared/test/constants.spec.ts
git commit -m "feat(shared): add three per-game rule-variant flags to RuleParams"
```

---

## Phase B — Engine rule variants

> All engine tests run with `yarn workspace @trm/engine test --run <substring>`. Use the existing test directory `packages/engine/test/`. A helper to build a game: `initGame(taiwanBoard(), { seed, players, contentHash: CONTENT_HASH, ruleParams })`. Look at an existing spec (e.g. `rules.spec.ts`) for the seat/player setup idiom before writing new specs.

### Task B1: `secondDrawAfterBlindRainbow`

**Files:**
- Modify: `packages/engine/src/reduce.ts` (`applyDrawBlind`, ~:216-237)
- Test: `packages/engine/test/draw-rainbow.spec.ts` (create)

**Interfaces:**
- Consumes: `state.ruleParams.secondDrawAfterBlindRainbow`, `endTurn` (already imported).
- Behavior: when the **first** blind draw is `LOCOMOTIVE` and the flag is `false`, the turn ends (one card taken). When `true`, the player proceeds to `DRAWING_CARDS` (may draw a second). Non-loco first draws and the face-up loco rule are unaffected.

- [ ] **Step 1: Write the failing test**

Build a state where it is a player's turn in `AWAIT_ACTION` with a deck whose top card is `LOCOMOTIVE`. The simplest robust approach: construct via `initGame`, advance through `KEEP_INITIAL_TICKETS` for all players, then **directly set** the deck top to `LOCOMOTIVE` using `cloneState` and overwriting `deck` (test-only). Assert:
```ts
import { describe, it, expect } from 'vitest';
import { reduce, cloneState } from '../src';
// ...build `state` at AWAIT_ACTION for currentPlayer P, board = taiwanBoard()
function withLocoTop(s) { const c = cloneState(s); return { ...c, deck: [...c.deck.slice(0, -1), 'LOCOMOTIVE'] }; }

it('OFF: a blind rainbow on the first draw ends the turn', () => {
  const s = withLocoTop(awaitState); // ruleParams.secondDrawAfterBlindRainbow = false (default)
  const r = reduce(board, s, { t: 'DRAW_BLIND', player: P });
  expect(r.ok).toBe(true);
  // turn advanced to the next player; not stuck in DRAWING_CARDS
  expect(r.value.state.turn.phase).toBe('AWAIT_ACTION');
  expect(r.value.state.turn.orderIndex).not.toBe(s.turn.orderIndex);
});

it('ON: a blind rainbow on the first draw still allows a second draw', () => {
  const base = withLocoTop(awaitStateOn); // built with ruleParams.secondDrawAfterBlindRainbow = true
  const r = reduce(board, base, { t: 'DRAW_BLIND', player: P });
  expect(r.ok).toBe(true);
  expect(r.value.state.turn.phase).toBe('DRAWING_CARDS');
  expect(r.value.state.turn.cardsDrawnThisTurn).toBe(1);
});

it('OFF: a non-rainbow first blind draw still allows a second draw', () => {
  const s = { ...awaitState, deck: [...awaitState.deck.slice(0, -1), 'RED'] };
  const r = reduce(board, s, { t: 'DRAW_BLIND', player: P });
  expect(r.value.state.turn.phase).toBe('DRAWING_CARDS');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/engine test --run draw-rainbow`
Expected: FAIL (OFF case currently proceeds to `DRAWING_CARDS`).

- [ ] **Step 3: Implement**

In `applyDrawBlind`, replace the `if (isFirst) { ... }` block (currently lines ~231-234) with:
```ts
  if (isFirst) {
    if (d.card === 'LOCOMOTIVE' && !state.ruleParams.secondDrawAfterBlindRainbow) {
      // Variant default: a blind rainbow consumes the whole draw — end the turn now.
      const out = endTurn(board, next, { wasPass: false });
      return ok({ state: out.state, events: [...events, ...out.events] });
    }
    next = { ...next, turn: { ...next.turn, phase: 'DRAWING_CARDS', cardsDrawnThisTurn: 1 } };
    return ok({ state: next, events });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/engine test --run draw-rainbow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/reduce.ts packages/engine/test/draw-rainbow.spec.ts
git commit -m "feat(engine): secondDrawAfterBlindRainbow variant (default: blind rainbow ends draw)"
```

### Task B2: `noUnfinishedTicketPenalty`

**Files:**
- Modify: `packages/engine/src/graph/connectivity.ts` (`evaluateTickets`, :52-111)
- Modify: `packages/engine/src/scoring.ts` (`evaluatePlayerTickets`, :56-96 — thread the flag)
- Test: `packages/engine/test/connectivity.spec.ts` (extend) or `ticket-penalty.spec.ts` (create)

**Interfaces:**
- Produces: `evaluateTickets(args)` accepts `noUnfinishedTicketPenalty?: boolean`; when true, unfinished tickets contribute `0` to `net` instead of `-value`. `completed` count unchanged.
- Consumes (B2): `state.ruleParams.noUnfinishedTicketPenalty` in `evaluatePlayerTickets`.

- [ ] **Step 1: Write the failing test (unit, on `evaluateTickets`)**

```ts
import { evaluateTickets } from '../src/graph/connectivity';

it('noUnfinishedTicketPenalty: unfinished ticket scores 0 not negative', () => {
  const args = {
    ownEdges: [], stationCities: [], borrowCandidates: new Map(),
    tickets: [{ a: 'X', b: 'Y', value: 10 }], vertices: ['X', 'Y'],
  };
  expect(evaluateTickets(args).net).toBe(-10);
  expect(evaluateTickets({ ...args, noUnfinishedTicketPenalty: true }).net).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/engine test --run connectivity`
Expected: FAIL (flag not accepted / still -10).

- [ ] **Step 3: Implement in `evaluateTickets`**

Add to the args type: `readonly noUnfinishedTicketPenalty?: boolean;`. Destructure it (default `false`). In `evaluate()` change the unfinished branch:
```ts
      } else if (!noUnfinishedTicketPenalty) {
        net -= t.value;
      }
```

In `scoring.ts evaluatePlayerTickets`, pass the flag into the `evaluateTickets({...})` call:
```ts
  const ticketEval = evaluateTickets({
    ownEdges: edges.map((e) => ({ a: e.u, b: e.v })),
    stationCities,
    borrowCandidates,
    tickets: goals.map((g) => ({ a: g.a, b: g.b, value: g.value })),
    vertices: cityIds,
    noUnfinishedTicketPenalty: state.ruleParams.noUnfinishedTicketPenalty,
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/engine test --run connectivity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/graph/connectivity.ts packages/engine/src/scoring.ts packages/engine/test/
git commit -m "feat(engine): noUnfinishedTicketPenalty variant (unfinished tickets score 0)"
```

### Task B3: `unlimitedStationBorrow` end-game scoring + `borrowConnectedTicketIds`

**Files:**
- Modify: `packages/engine/src/graph/connectivity.ts` — add `borrowConnectedTicketIds`.
- Modify: `packages/engine/src/scoring.ts` — add `stationBorrowEdges`; branch `evaluatePlayerTickets`.
- Modify: `packages/engine/src/index.ts` — export `borrowConnectedTicketIds`, `stationBorrowEdges`.
- Test: `packages/engine/test/station-borrow.spec.ts` (create)

**Interfaces:**
- Produces:
  - `borrowConnectedTicketIds(args: { ownEdges: readonly Edge[]; borrowEdges: readonly Edge[]; tickets: readonly IdTicketGoal[]; vertices?: readonly string[] }): string[]` — ids of tickets connected by `own ∪ borrow` edges (a single monotonic union).
  - `stationBorrowEdges(board: Board, state: GameState, playerId: PlayerId): Edge[]` — all non-locked opponent edges incident to any city where `playerId` has a station (deduped).
  - `evaluatePlayerTickets` returns the same `PlayerTicketDetail` but, when `state.ruleParams.unlimitedStationBorrow`, computes completion as `own ∪ stationBorrowEdges` (every station borrows everything).

- [ ] **Step 1: Write the failing test**

```ts
import { borrowConnectedTicketIds } from '../src/graph/connectivity';

it('borrowConnectedTicketIds unions own + borrowed edges', () => {
  // X-M is mine; M-Y is an opponent edge I can borrow via a station at M.
  const ids = borrowConnectedTicketIds({
    ownEdges: [{ a: 'X', b: 'M' }],
    borrowEdges: [{ a: 'M', b: 'Y' }],
    tickets: [{ id: 't1', a: 'X', b: 'Y' }],
  });
  expect(ids).toEqual(['t1']);
});
```
Add an integration test on `evaluatePlayerTickets`: build a small game where a player owns one leg of a ticket, has a station at the junction city, and an opponent owns the other leg. With `unlimitedStationBorrow=false` the single-borrow optimum still completes it (value positive); craft a case needing **two** different incident opponent edges at one station to complete **two** tickets — that scores both only when `unlimitedStationBorrow=true`:
```ts
it('unlimited borrow lets one station complete two tickets via two opponent edges', () => {
  // stateOn: ruleParams.unlimitedStationBorrow = true, player has station at hub H,
  // owns nothing else; opponent owns H-A and H-B; player tickets {start..A} and {start..B}
  // are only connected if BOTH H-A and H-B are borrowed.
  const off = evaluatePlayerTickets(board, stateOff, P);
  const on = evaluatePlayerTickets(board, stateOn, P);
  expect(on.completed).toBeGreaterThan(off.completed);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/engine test --run station-borrow`
Expected: FAIL (`borrowConnectedTicketIds` undefined; `on.completed` not greater).

- [ ] **Step 3: Implement**

In `connectivity.ts` (after `ownConnectedTicketIds`):
```ts
/**
 * Tickets connected by the player's own edges UNION all their station-borrowed edges. Under the
 * `unlimitedStationBorrow` variant every station borrows ALL its incident opponent edges, so the
 * borrow graph only grows — this union is monotonic and is the basis for instant, locked completion.
 */
export function borrowConnectedTicketIds(args: {
  ownEdges: readonly Edge[];
  borrowEdges: readonly Edge[];
  tickets: readonly IdTicketGoal[];
  vertices?: readonly string[];
}): string[] {
  const uf = new UnionFind(args.vertices);
  for (const e of args.ownEdges) uf.union(e.a, e.b);
  for (const e of args.borrowEdges) uf.union(e.a, e.b);
  return args.tickets.filter((t) => uf.connected(t.a, t.b)).map((t) => t.id);
}
```

In `scoring.ts`, export a borrow-edge collector (place near `borrowCandidatesForCity`):
```ts
/** All non-locked opponent edges incident to any city where `playerId` built a station (deduped). */
export function stationBorrowEdges(board: Board, state: GameState, playerId: PlayerId): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<string>();
  for (const s of state.stations) {
    if (s.playerId !== playerId) continue;
    for (const e of borrowCandidatesForCity(board, state, s.cityId as string, playerId)) {
      const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
      if (!seen.has(key)) { seen.add(key); out.push(e); }
    }
  }
  return out;
}
```

In `evaluatePlayerTickets`, after computing `edges`, `cityIds`, and `goals` (and before the existing `evaluateTickets` call), branch:
```ts
  if (state.ruleParams.unlimitedStationBorrow) {
    const uf = new UnionFind(cityIds);
    for (const e of edges) uf.union(e.u, e.v);
    for (const e of stationBorrowEdges(board, state, playerId)) uf.union(e.a, e.b);
    let net = 0;
    let completed = 0;
    const completedTicketIds: TicketId[] = [];
    for (const g of goals) {
      if (uf.connected(g.a, g.b)) {
        net += g.value;
        completed += 1;
        completedTicketIds.push(g.id);
      } else if (!state.ruleParams.noUnfinishedTicketPenalty) {
        net -= g.value;
      }
    }
    return { net, completed, completedTicketIds };
  }
```
(The existing one-borrow-per-station path remains for the `false` case, now with the penalty flag from B2.)

Export both new symbols from `index.ts`:
```ts
export { evaluateTickets, ownConnectedTicketIds, borrowConnectedTicketIds } from './graph/connectivity';
export { computeFinalScores, evaluatePlayerTickets, longestTrailRouteIdsFor, stationBorrowEdges } from './scoring';
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/engine test --run station-borrow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/graph/connectivity.ts packages/engine/src/scoring.ts packages/engine/src/index.ts packages/engine/test/station-borrow.spec.ts
git commit -m "feat(engine): unlimitedStationBorrow scoring (union all station borrows)"
```

### Task B4: Instant + locked ticket completion (state + hook + event + redaction)

**Files:**
- Modify: `packages/engine/src/types/state.ts` — `PlayerState.completedTickets`.
- Modify: `packages/engine/src/setup.ts` — init `completedTickets: []`.
- Modify: `packages/engine/src/types/events.ts` — `TICKET_COMPLETED`.
- Modify: `packages/engine/src/reduce.ts` — `lockCompletedTickets` + hooks in claim/tunnel/station.
- Modify: `packages/engine/src/selectors.ts` — source `completedTickets` from state when unlimited.
- Test: `packages/engine/test/instant-completion.spec.ts` (create)

**Interfaces:**
- Produces: `PlayerState.completedTickets: readonly TicketId[]` (only grows; populated only when `unlimitedStationBorrow`). New event `{ e: 'TICKET_COMPLETED'; player: PlayerId; ticket: TicketId; visibility: 'PUBLIC' }`.
- Consumes: `borrowConnectedTicketIds`, `stationBorrowEdges` (Task B3); `withPlayer` (reducers/common).

- [ ] **Step 1: Write the failing test**

```ts
it('locks a ticket the moment own track connects it (unlimited borrow on)', () => {
  // game with ruleParams.unlimitedStationBorrow=true; player P kept ticket A↔B.
  // After P claims the final route joining A and B:
  const r = reduce(board, justBeforeJoin, claimFinalLeg);
  expect(r.ok).toBe(true);
  const p = r.value.state.players[P];
  expect(p.completedTickets).toContain(ticketAB);
  expect(r.value.events.some((e) => e.e === 'TICKET_COMPLETED' && e.ticket === ticketAB)).toBe(true);
});

it("locks a borrow-completed ticket when an OPPONENT claims the borrowed leg", () => {
  // P has a station at hub H and owns start↔H; ticket start↔C needs H↔C, owned by opponent.
  // Opponent claims H↔C:
  const r = reduce(board, beforeOpponentClaim, opponentClaimsHC);
  const p = r.value.state.players[P];
  expect(p.completedTickets).toContain(ticketStartC);
});

it('does not lock anything when unlimitedStationBorrow is off', () => {
  const r = reduce(board, offState, claimFinalLeg);
  expect(r.value.state.players[P].completedTickets).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/engine test --run instant-completion`
Expected: FAIL (`completedTickets` undefined; no event).

- [ ] **Step 3: Implement state + setup + event**

`types/state.ts` — in `PlayerState` add after `routePoints`:
```ts
  /** Tickets locked as completed mid-game (only populated under the unlimitedStationBorrow
   *  variant). Monotonic; points are banked the moment a ticket enters this list. */
  readonly completedTickets: readonly TicketId[];
```
`setup.ts` — in the player object literal add `completedTickets: [],`.
`types/events.ts` — add to the `GameEvent` union:
```ts
  | { readonly e: 'TICKET_COMPLETED'; readonly player: PlayerId; readonly ticket: TicketId; readonly visibility: 'PUBLIC' }
```

- [ ] **Step 4: Implement the lock-in helper + hooks in `reduce.ts`**

Add imports at the top of `reduce.ts`:
```ts
import type { TicketId } from '@trm/shared';
import { asTicketId } from '@trm/shared';
import { borrowConnectedTicketIds } from './graph/connectivity';
import { stationBorrowEdges } from './scoring';
```
(Confirm `asTicketId` exists in `@trm/shared/ids`; if the brand helper has a different name, use that.)

Add the helper (near the bottom, before `hasAnyLegalMove`):
```ts
/**
 * Under `unlimitedStationBorrow`, re-evaluate every player's kept tickets after a connectivity
 * change and lock any newly-completed ones into `completedTickets`, emitting TICKET_COMPLETED.
 * No-op when the variant is off. All players are checked because an opponent's claim into a
 * player's station city can complete that player's ticket. Monotonic → never retracts.
 */
function lockCompletedTickets(board: Board, state: GameState): { state: GameState; events: GameEvent[] } {
  if (!state.ruleParams.unlimitedStationBorrow) return { state, events: [] };
  let next = state;
  const events: GameEvent[] = [];
  for (const pid of state.turnOrder) {
    const p = next.players[pid as string];
    if (!p || p.keptTickets.length === 0) continue;
    const already = new Set(p.completedTickets as readonly string[]);

    const ownEdges: { a: string; b: string }[] = [];
    for (const [routeId, cell] of Object.entries(next.ownership)) {
      if ('owner' in cell && cell.owner === pid) {
        const r = board.routeById.get(routeId);
        if (r) ownEdges.push({ a: r.a as string, b: r.b as string });
      }
    }
    const tickets = p.keptTickets
      .map((tid) => {
        const t = board.ticketById.get(tid as string);
        return t ? { id: tid as string, a: t.a as string, b: t.b as string } : null;
      })
      .filter((x): x is { id: string; a: string; b: string } => x !== null);

    const connected = borrowConnectedTicketIds({
      ownEdges,
      borrowEdges: stationBorrowEdges(board, next, pid),
      tickets,
    });
    const newly = connected.filter((id) => !already.has(id));
    if (newly.length > 0) {
      const newIds = newly.map((id) => asTicketId(id));
      next = withPlayer(next, pid, (pl) => ({
        ...pl,
        completedTickets: [...pl.completedTickets, ...newIds],
      }));
      for (const id of newIds)
        events.push({ e: 'TICKET_COMPLETED', player: pid, ticket: id, visibility: 'PUBLIC' });
    }
  }
  return { state: next, events };
}
```

Hook it into the three connectivity-changing handlers, **after the ownership/station mutation and before `endTurn`**:

`applyClaimRoute` (normal claim branch):
```ts
  let next = spendCards(state, player, pay.value.spent);
  const eff = applyClaimEffects(board, next, player, route);
  next = eff.state;
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
  const out = endTurn(board, next, { wasPass: false });
  return ok({ state: out.state, events: [...eff.events, ...lock.events, ...out.events] });
```

`applyResolveTunnel` (commit branch, the part after `eff`):
```ts
  next = eff.state;
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
  const out = endTurn(board, next, { wasPass: false });
  return ok({
    state: out.state,
    events: [
      { e: 'TUNNEL_RESOLVED', player, routeId: pt.routeId, committed: true, visibility: 'PUBLIC' },
      ...eff.events,
      ...lock.events,
      ...out.events,
    ],
  });
```

`applyBuildStation`:
```ts
  next = { ...next, stations: [...next.stations, { playerId: player, cityId }] };
  const lock = lockCompletedTickets(board, next);
  next = lock.state;
  const out = endTurn(board, next, { wasPass: false });
  return ok({
    state: out.state,
    events: [{ e: 'STATION_BUILT', player, cityId, visibility: 'PUBLIC' }, ...lock.events, ...out.events],
  });
```

- [ ] **Step 5: Implement `redactFor` completion source (`selectors.ts`)**

Replace the per-player loop that builds `completedTickets` (~:165-185) so it reads the locked set under the variant:
```ts
  for (const id of state.turnOrder) {
    const p = state.players[id as string];
    if (!p || p.keptTickets.length === 0) continue;
    if (state.ruleParams.unlimitedStationBorrow) {
      for (const tid of p.completedTickets) completedTickets.push({ player: id, ticket: tid });
      continue;
    }
    const ownEdges: { a: string; b: string }[] = [];
    for (const [routeId, cell] of Object.entries(state.ownership)) {
      if ('owner' in cell && cell.owner === id) {
        const r = board.routeById.get(routeId);
        if (r) ownEdges.push({ a: r.a as string, b: r.b as string });
      }
    }
    const tickets = p.keptTickets
      .map((tid) => {
        const t = board.ticketById.get(tid as string);
        return t ? { id: tid as string, a: t.a as string, b: t.b as string } : null;
      })
      .filter((x): x is { id: string; a: string; b: string } => x !== null);
    const done = new Set(ownConnectedTicketIds({ ownEdges, tickets }));
    for (const tid of p.keptTickets) {
      if (done.has(tid as string)) completedTickets.push({ player: id, ticket: tid });
    }
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn workspace @trm/engine test --run instant-completion`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/types/state.ts packages/engine/src/setup.ts packages/engine/src/types/events.ts packages/engine/src/reduce.ts packages/engine/src/selectors.ts packages/engine/test/instant-completion.spec.ts
git commit -m "feat(engine): instant locked ticket completion under unlimitedStationBorrow"
```

### Task B5: Version bump, invariant cross-check, golden regeneration

**Files:**
- Modify: `packages/engine/src/types/state.ts` — `ENGINE_VERSION = 2`.
- Test: `packages/engine/test/variants-determinism.spec.ts` (create); regenerate existing golden digests.

**Interfaces:**
- Produces: `ENGINE_VERSION === 2`. All existing golden-replay digests updated to the new canonical values.

- [ ] **Step 1: Write the invariant cross-check test**

```ts
it('locked completion set equals a fresh end-game evaluation (monotonicity invariant)', () => {
  // Play a scripted game under unlimitedStationBorrow=true to GAME_OVER (or near it).
  for (const pid of finalState.turnOrder) {
    const p = finalState.players[pid];
    // fresh union-of-all-borrows completion:
    const fresh = new Set(borrowConnectedTicketIds({
      ownEdges: ownEdgesOf(finalState, pid),
      borrowEdges: stationBorrowEdges(board, finalState, pid),
      tickets: keptGoals(finalState, pid),
    }));
    expect(new Set(p.completedTickets)).toEqual(fresh);
  }
});

it('replays byte-identically under each variant', () => {
  for (const ruleParams of [
    { unlimitedStationBorrow: true },
    { secondDrawAfterBlindRainbow: true },
    { noUnfinishedTicketPenalty: true },
  ]) {
    const live = playScript(ruleParams);          // apply actions one by one
    const replayed = replay(board, configWith(ruleParams), live.actions);
    expect(stateDigest(replayed.state)).toBe(stateDigest(live.state));
  }
});
```

- [ ] **Step 2: Run to verify it fails (or the golden specs fail on the new digests)**

Run: `yarn workspace @trm/engine test`
Expected: the new spec PASSes for the invariant, but **existing golden-digest specs FAIL** because adding `ruleParams` keys + `completedTickets` changed every digest. This is expected.

- [ ] **Step 3: Bump the engine version + regenerate goldens**

Set `ENGINE_VERSION = 2` in `types/state.ts`. Then update each failing golden digest assertion to its new value. Find them:

Run: `yarn workspace @trm/engine test 2>&1 | grep -iE "digest|golden|expected"` to list the mismatches. For each, copy the **actual** digest the test now produces into the fixture/expectation (these are deterministic). Do NOT loosen the assertions — only replace the constant.

- [ ] **Step 4: Run the whole engine suite to verify green**

Run: `yarn workspace @trm/engine test`
Expected: PASS (all specs, including the regenerated goldens, the property/invariant suite, and the variant determinism spec). Run twice to confirm the new digests are stable.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `yarn workspace @trm/engine lint && yarn workspace @trm/engine typecheck`
```bash
git add packages/engine
git commit -m "feat(engine): bump ENGINE_VERSION to 2; regenerate golden digests for rule variants"
```

---

## Phase C — Proto + codec (display of active variants)

### Task C1: `GameSettings` message on the snapshot

**Files:**
- Modify: `packages/proto/proto/trmission/v1/common.proto`
- Modify: `apps/server/src/codec/snapshot.ts`
- Test: `packages/proto/test/*` (round-trip), `apps/server/test/*` (snapshot codec) — extend existing.

**Interfaces:**
- Produces: `message GameSettings { bool unlimited_station_borrow = 1; bool second_draw_after_blind_rainbow = 2; bool no_unfinished_ticket_penalty = 3; }`, field `GameSettings game_settings = 21;` on `GameSnapshot`. `viewToSnapshot` reads `view.ruleParams` — so `RedactedView` must expose the three booleans.

- [ ] **Step 1: Expose the flags on `RedactedView`**

In `packages/engine/src/types/view.ts` add to `RedactedView`:
```ts
  readonly settings: {
    readonly unlimitedStationBorrow: boolean;
    readonly secondDrawAfterBlindRainbow: boolean;
    readonly noUnfinishedTicketPenalty: boolean;
  };
```
In `selectors.ts redactFor` return object add:
```ts
    settings: {
      unlimitedStationBorrow: state.ruleParams.unlimitedStationBorrow,
      secondDrawAfterBlindRainbow: state.ruleParams.secondDrawAfterBlindRainbow,
      noUnfinishedTicketPenalty: state.ruleParams.noUnfinishedTicketPenalty,
    },
```
Commit this engine change with the codec task or separately.

- [ ] **Step 2: Write the failing proto round-trip test**

In the proto test suite, create a `GameSettings` and assert binary round-trip preserves the three booleans; assert `GameSnapshot.gameSettings` survives `toBinary`/`fromBinary`.

- [ ] **Step 3: Edit `.proto` + regenerate**

In `common.proto` add the message (near `GameSnapshot`) and the field inside `GameSnapshot` (next free tag is `21`):
```proto
message GameSettings {
  bool unlimited_station_borrow = 1;
  bool second_draw_after_blind_rainbow = 2;
  bool no_unfinished_ticket_penalty = 3;
}
```
```proto
  // Active rule variants for this game (display only; the engine has already baked
  // their consequences into this snapshot). Present for players and spectators alike.
  GameSettings game_settings = 21;
```
Run: `yarn workspace @trm/proto generate`
Run: `yarn workspace @trm/proto test`
Expected: PASS.

- [ ] **Step 4: Project it in `snapshot.ts`**

In `viewToSnapshot`'s `create(GameSnapshotSchema, { ... })` add:
```ts
    gameSettings: {
      unlimitedStationBorrow: view.settings.unlimitedStationBorrow,
      secondDrawAfterBlindRainbow: view.settings.secondDrawAfterBlindRainbow,
      noUnfinishedTicketPenalty: view.settings.noUnfinishedTicketPenalty,
    },
```

- [ ] **Step 5: Run server codec tests + commit**

Run: `yarn workspace @trm/server test --run snapshot` (or the codec spec name)
Expected: PASS.
```bash
git add packages/proto/proto packages/engine/src/types/view.ts packages/engine/src/selectors.ts apps/server/src/codec/snapshot.ts packages/proto/test apps/server/test
git commit -m "feat(proto): surface active GameSettings on the game snapshot"
```

---

## Phase D — Server (rooms, settings, public list, spectating)

### Task D1: `RoomDoc.settings` + repo `updateSettings` + `findPublic`

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts`
- Test: `apps/server/test/room.repo.spec.ts` (create or extend; uses mongodb-memory-server like existing lobby tests)

**Interfaces:**
- Produces:
```ts
export interface RoomSettings {
  unlimitedStationBorrow: boolean;
  secondDrawAfterBlindRainbow: boolean;
  noUnfinishedTicketPenalty: boolean;
  allowSpectating: boolean;
  visibility: 'PUBLIC' | 'INVITE_ONLY';
}
export const DEFAULT_ROOM_SETTINGS: RoomSettings; // all variants false, allowSpectating true, visibility 'PUBLIC'
```
  `RoomDoc.settings: RoomSettings`. `RoomRepo.updateSettings(code, hostId, patch: Partial<RoomSettings>): Promise<RoomDoc | 'not_found' | 'forbidden' | 'started'>`. `RoomRepo.findPublic(): Promise<RoomDoc[]>` (PUBLIC rooms in LOBBY, plus STARTED rooms with `allowSpectating`, newest first).

- [ ] **Step 1: Write failing tests**

```ts
it('create() defaults settings to all-off variants, spectating on, public', async () => {
  const r = await repo.create(host, 5);
  expect(r.settings).toEqual({
    unlimitedStationBorrow: false, secondDrawAfterBlindRainbow: false,
    noUnfinishedTicketPenalty: false, allowSpectating: true, visibility: 'PUBLIC',
  });
});
it('updateSettings is host-only and LOBBY-only', async () => {
  const r = await repo.create(host, 5);
  expect(await repo.updateSettings(r._id, 'someone-else', { allowSpectating: false })).toBe('forbidden');
  const ok = await repo.updateSettings(r._id, host.userId, { visibility: 'INVITE_ONLY' });
  expect((ok as RoomDoc).settings.visibility).toBe('INVITE_ONLY');
});
it('findPublic returns PUBLIC lobby rooms and hides INVITE_ONLY', async () => { /* ... */ });
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run room.repo`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the `RoomSettings`/`DEFAULT_ROOM_SETTINGS` exports. Add `settings: RoomSettings;` to `RoomDoc`. In `create()` set `settings: { ...DEFAULT_ROOM_SETTINGS }`. Add:
```ts
async updateSettings(
  code: string, hostId: string, patch: Partial<RoomSettings>,
): Promise<RoomDoc | 'not_found' | 'forbidden' | 'started'> {
  const room = await this.col.findOne({ _id: code });
  if (!room) return 'not_found';
  if (room.status !== 'LOBBY') return 'started';
  if (room.hostId !== hostId) return 'forbidden';
  const settings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings, ...patch };
  await this.col.updateOne({ _id: code, hostId, status: 'LOBBY' },
    { $set: { settings, updatedAt: new Date() } });
  return (await this.col.findOne({ _id: code })) ?? 'not_found';
}

async findPublic(): Promise<RoomDoc[]> {
  return this.col.find({
    'settings.visibility': 'PUBLIC',
    $or: [{ status: 'LOBBY' }, { status: 'STARTED', 'settings.allowSpectating': true }],
  }).sort({ updatedAt: -1 }).limit(50).toArray();
}
```
Widen the index in `onModuleInit`:
```ts
await this.col.createIndex({ 'settings.visibility': 1, status: 1, updatedAt: -1 });
```
Note: existing rooms created before this change lack `settings`; guard reads with `room.settings ?? DEFAULT_ROOM_SETTINGS` where consumed. (Pre-launch, acceptable; documented.)

- [ ] **Step 4: Run to verify it passes**

Run: `yarn workspace @trm/server test --run room.repo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/test/room.repo.spec.ts
git commit -m "feat(server): RoomDoc.settings, host-only updateSettings, findPublic"
```

### Task D2: Settings DTO + `RoomView.settings` + PATCH endpoint + service

**Files:**
- Modify: `apps/server/src/lobby/lobby.schemas.ts`, `lobby.service.ts`, `lobby.controller.ts`
- Test: `apps/server/test/lobby.e2e.spec.ts` (extend) / `lobby.service.spec.ts`

**Interfaces:**
- Produces: `GameSettingsSchema` (Zod) → `UpdateSettingsDto`; `RoomViewSchema.settings`; `RoomView.settings`; `LobbyService.updateSettings(code, user, patch): Promise<RoomView>`; controller `PATCH /api/v1/rooms/:code/settings`.

- [ ] **Step 1: Write a failing e2e/service test**

```ts
it('PATCH /rooms/:code/settings updates settings for the host only', async () => {
  // host creates room, PATCH visibility INVITE_ONLY → 200 with settings.visibility
  // non-host PATCH → 403
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run lobby`
Expected: FAIL.

- [ ] **Step 3: Implement schema + DTO**

In `lobby.schemas.ts`:
```ts
export const GameSettingsSchema = z.object({
  unlimitedStationBorrow: z.boolean(),
  secondDrawAfterBlindRainbow: z.boolean(),
  noUnfinishedTicketPenalty: z.boolean(),
  allowSpectating: z.boolean(),
  visibility: z.enum(['PUBLIC', 'INVITE_ONLY']),
});
export const UpdateSettingsSchema = GameSettingsSchema.partial();
export class UpdateSettingsDto extends createZodDto(UpdateSettingsSchema) {}
```
Add `settings: GameSettingsSchema` to `RoomViewSchema`.

- [ ] **Step 4: Implement service + `toView`**

In `lobby.service.ts`: extend `RoomView` with `settings: RoomSettings`; in `toView` include `settings: r.settings ?? DEFAULT_ROOM_SETTINGS`. Add:
```ts
async updateSettings(code: string, user: AuthUser, patch: Partial<RoomSettings>): Promise<RoomView> {
  const r = await this.rooms.updateSettings(code, user.userId, patch);
  if (r === 'not_found') throw new NotFoundException('room not found');
  if (r === 'started') throw new BadRequestException('game already started');
  if (r === 'forbidden') throw new ForbiddenException('only the host can change settings');
  return toView(r);
}
```

- [ ] **Step 5: Implement controller route**

In `lobby.controller.ts` (import `Patch`, `UpdateSettingsDto`, `UpdateSettingsSchema`):
```ts
@Patch(':code/settings')
@HttpCode(200)
@ApiOperation({ summary: 'Host updates per-game settings (LOBBY only)' })
@ApiBody({ schema: apiSchema(UpdateSettingsSchema) })
@ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
updateSettings(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body() body: UpdateSettingsDto) {
  return this.lobby.updateSettings(code.toUpperCase(), user, body);
}
```

- [ ] **Step 6: Run to verify it passes + commit**

Run: `yarn workspace @trm/server test --run lobby`
Expected: PASS.
```bash
git add apps/server/src/lobby/lobby.schemas.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/lobby.controller.ts apps/server/test
git commit -m "feat(server): PATCH /rooms/:code/settings + settings on RoomView"
```

### Task D3: `start()` passes rule variants into the engine

**Files:**
- Modify: `apps/server/src/lobby/lobby.service.ts` (`start`, :122-147)
- Test: `apps/server/test/lobby.*` — assert the created match's `ruleParams` reflect the room settings.

**Interfaces:**
- Consumes: `room.settings`. Produces: `GameConfig.ruleParams` carrying the three rule variants.

- [ ] **Step 1: Write the failing test**

Drive: create room → set `unlimitedStationBorrow: true` via updateSettings → ready all → start → assert the game's genesis state has `ruleParams.unlimitedStationBorrow === true` (read via the store/registry or a `hub.createMatch` spy).

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run lobby`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `start()`, build `ruleParams` from `room.settings` and include it in the config:
```ts
const s = room.settings ?? DEFAULT_ROOM_SETTINGS;
const config: GameConfig = {
  seed, players, contentHash: CONTENT_HASH,
  ruleParams: {
    unlimitedStationBorrow: s.unlimitedStationBorrow,
    secondDrawAfterBlindRainbow: s.secondDrawAfterBlindRainbow,
    noUnfinishedTicketPenalty: s.noUnfinishedTicketPenalty,
  },
};
```

- [ ] **Step 4: Run to verify it passes + commit**

Run: `yarn workspace @trm/server test --run lobby`
Expected: PASS.
```bash
git add apps/server/src/lobby/lobby.service.ts apps/server/test
git commit -m "feat(server): pass per-game rule variants into the engine at game start"
```

### Task D4: Public-rooms list endpoint (unauthenticated)

**Files:**
- Create: `apps/server/src/lobby/lobby.public.controller.ts`
- Modify: `apps/server/src/lobby/lobby.service.ts` (`listPublic`), `lobby.module.ts`, `lobby.schemas.ts`
- Test: `apps/server/test/lobby.e2e.spec.ts` — list returns PUBLIC rooms with no auth header.

**Interfaces:**
- Produces: `LobbyService.listPublic(): Promise<RoomView[]>`; `GET /api/v1/rooms/public` (no `AccessTokenGuard`).

(Use a dedicated path `/rooms/public` on a separate controller WITHOUT the guard, to avoid colliding with the guarded `GET /rooms/:code` and to keep the unauthenticated surface explicit.)

- [ ] **Step 1: Write the failing test**

```ts
it('GET /rooms/public lists PUBLIC rooms without auth', async () => {
  // create a PUBLIC room (authed) and an INVITE_ONLY room; GET /rooms/public with NO token
  // → 200, contains the public code, excludes the invite-only one.
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run lobby`
Expected: FAIL.

- [ ] **Step 3: Implement service method**

In `lobby.service.ts`:
```ts
async listPublic(): Promise<RoomView[]> {
  return (await this.rooms.findPublic()).map(toView);
}
```

- [ ] **Step 4: Implement the unauthenticated controller**

`lobby.public.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LobbyService } from './lobby.service';
import { apiSchema } from '../openapi/openapi';
import { RoomViewSchema } from './lobby.schemas';
import { z } from 'zod';

@ApiTags('lobby')
@Controller('api/v1/rooms')
export class LobbyPublicController {
  constructor(private readonly lobby: LobbyService) {}

  @Get('public')
  @ApiOperation({ summary: 'List public rooms (lobby to join + live games to watch)' })
  @ApiResponse({ status: 200, schema: apiSchema(z.array(RoomViewSchema)) })
  list() {
    return this.lobby.listPublic();
  }
}
```
Register `LobbyPublicController` in `lobby.module.ts` `controllers: [...]`. Ensure no global guard blocks it (the guard is controller-scoped via `@UseGuards` on `LobbyController`, so a separate controller without it is open — verify there is no app-level `APP_GUARD`; if there is, add the project's `@Public()` decorator instead).

- [ ] **Step 5: Run to verify it passes + commit**

Run: `yarn workspace @trm/server test --run lobby`
Expected: PASS.
```bash
git add apps/server/src/lobby/lobby.public.controller.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/lobby.module.ts apps/server/test
git commit -m "feat(server): unauthenticated GET /rooms/public list"
```

### Task D5: Spectator path (ticket, gate, hub binding, fan-out, command rejection)

**Files:**
- Modify: `apps/server/src/ws/ticket.ts` (allow `seat: -1` — already numeric, but assert sentinel is preserved), `apps/server/src/ws/connection.ts` (binding stays as-is; `seat: -1` = spectator), `apps/server/src/ws/hub.ts` (spectator set, `onHello`, `broadcast`, `onGameCommand`).
- Modify: `apps/server/src/lobby/lobby.service.ts` (`spectateTicket`), `lobby.controller.ts` (`POST /:code/spectate`).
- Test: `apps/server/test/wire-game.e2e.spec.ts` (spectator gets snapshots, no secrets, cannot command), `lobby` (spectate gated).

**Interfaces:**
- Produces: `LobbyService.spectateTicket(code, user): Promise<TicketResult>` (rejects when `!settings.allowSpectating` or no started game; mints a ws-ticket with `seat: -1` and `playerId` = the caller's id, or a synthetic `spectator:<uuid>` for anonymous). Hub admits `seat < 0` as a spectator: receives projected (`viewer=null`) snapshots + PUBLIC events; any game command → `NOT_IN_GAME`.

- [ ] **Step 1: Write failing tests**

```ts
// lobby: spectate gated
it('spectate returns a ticket when allowSpectating, 403 when off', async () => { /* ... */ });

// hub/wire: spectator receives a snapshot with no `you`, and cannot send commands
it('a spectator connection gets snapshots but no SelfView and cannot act', async () => {
  // mint a spectator ticket (seat:-1) for a live game, hello → expect snapshot with you unset;
  // send a DRAW_BLIND command → expect a NOT_IN_GAME rejection; no state change.
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @trm/server test --run wire-game` and `--run lobby`
Expected: FAIL.

- [ ] **Step 3: Implement the spectate service + endpoint**

In `lobby.service.ts`:
```ts
async spectateTicket(code: string, user: AuthUser): Promise<TicketResult> {
  const room = await this.require(code);
  const s = room.settings ?? DEFAULT_ROOM_SETTINGS;
  if (!s.allowSpectating) throw new ForbiddenException('spectating is disabled for this room');
  if (!room.gameId) throw new BadRequestException('game has not started');
  return {
    gameId: room.gameId,
    ticket: this.tokens.signWsTicket({ gameId: room.gameId, playerId: user.userId, seat: -1 }),
  };
}
```
Controller (`lobby.controller.ts`):
```ts
@Post(':code/spectate')
@HttpCode(200)
@ApiOperation({ summary: 'Mint a spectator ws-ticket for a live game (if spectating is allowed)' })
@ApiResponse({ status: 200, schema: apiSchema(TicketResultSchema) })
spectate(@CurrentUser() user: AuthUser, @Param('code') code: string) {
  return this.lobby.spectateTicket(code.toUpperCase(), user);
}
```
(Spectators must be authenticated — guests count. The guarded controller is fine since guests get an access token. Anonymous-without-guest is out of scope; the home "Watch" flow ensures a guest session first.)

- [ ] **Step 4: Implement the hub spectator path**

In `hub.ts`, add a spectator registry field: `private readonly spectators = new Map<string, Set<Connection>>();`

In `onHello`, branch BEFORE the seat-membership check:
```ts
    const player = asPlayerId(binding.playerId);
    if (binding.seat < 0) {
      // Spectator binding: no seat, view as `null`. Never added to `members`.
      conn.binding = { gameId: binding.gameId, player, seat: -1 };
      conn.lastClientSeq = Math.max(conn.lastClientSeq, clientSeq);
      let set = this.spectators.get(binding.gameId);
      if (!set) { set = new Set(); this.spectators.set(binding.gameId, set); }
      set.add(conn);
      conn.send(welcomeFrame(binding.gameId, binding.playerId, -1), clientSeq);
      this.sendProjected(conn, match, null, clientSeq);
      return;
    }
    const inGame = match.session.turnOrder.includes(player);
    // ...existing seat check unchanged
```

In `onGameCommand`, after the `conn.binding` null-check, reject spectators:
```ts
    if (conn.binding.seat < 0) {
      conn.send(rejectionFrame(env.clientSeq, RejectionCode.NOT_IN_GAME, 'errors:notInGame', 'spectators cannot act'));
      return;
    }
```

In `broadcast`, after the members loop, fan out to spectators (PUBLIC events only, `viewer=null`):
```ts
    const specs = this.spectators.get(match.session.gameId);
    if (specs) {
      const pubEvents = events
        .map((e) => eventToProto(e, null))
        .filter((e): e is PbGameEvent => e !== null);
      for (const spec of specs) {
        this.sendProjected(spec, match, null, 0);
        if (pubEvents.length > 0) spec.send(eventsFrame(version, pubEvents));
      }
    }
```
Confirm `eventToProto(e, null)` drops `{ private }`-visibility events (it should, since a null viewer never matches `private`). If its signature is `(e, viewer: PlayerId)`, widen it to `PlayerId | null` and treat `null` as "public only".

In `closeConnection`, also remove from spectators:
```ts
    const sset = this.spectators.get(conn.binding.gameId);
    sset?.delete(conn);
```

- [ ] **Step 5: Run to verify it passes**

Run: `yarn workspace @trm/server test --run wire-game` and `--run lobby`
Expected: PASS. Also run the full leak test: `yarn workspace @trm/server test --run wire-game` and confirm no secrets reach the `null` viewer.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/ws apps/server/src/lobby apps/server/src/codec/events.ts apps/server/test
git commit -m "feat(server): full spectator path (ticket gate, hub binding, fan-out, command rejection)"
```

---

## Phase E — Web (settings panel, public list, spectator UI)

### Task E1: REST client additions

**Files:**
- Modify: `apps/web/src/net/rest.ts`
- Test: `apps/web/src/net/rest.test.ts` (extend)

**Interfaces:**
- Produces: `RoomSettings` type; `RoomView.settings: RoomSettings`; `api.getPublicRooms(): Promise<RoomView[]>`; `api.updateRoomSettings(code, patch: Partial<RoomSettings>): Promise<RoomView>`; `api.spectate(code): Promise<TicketResult>`.

- [ ] **Step 1: Write the failing test** (mock `fetch`, assert the right method/path/body for each new call).

- [ ] **Step 2: Run to verify it fails** — `yarn workspace @trm/web test --run rest`

- [ ] **Step 3: Implement**

```ts
export interface RoomSettings {
  unlimitedStationBorrow: boolean;
  secondDrawAfterBlindRainbow: boolean;
  noUnfinishedTicketPenalty: boolean;
  allowSpectating: boolean;
  visibility: 'PUBLIC' | 'INVITE_ONLY';
}
```
Add `settings: RoomSettings;` to `RoomView`. In `api`:
```ts
  getPublicRooms: () => req<RoomView[]>('GET', '/rooms/public'),
  updateRoomSettings: (code: string, patch: Partial<RoomSettings>) =>
    req<RoomView>('PATCH', `/rooms/${code}/settings`, patch),
  spectate: (code: string) => req<TicketResult>('POST', `/rooms/${code}/spectate`),
```

- [ ] **Step 4: Run to verify it passes + commit**

Run: `yarn workspace @trm/web test --run rest`
```bash
git add apps/web/src/net/rest.ts apps/web/src/net/rest.test.ts
git commit -m "feat(web): REST client for room settings, public list, spectate"
```

### Task E2: i18n keys (zh-Hant + en)

**Files:**
- Modify: `apps/web/src/i18n/index.ts`

**Interfaces:**
- Produces: keys used by E3/E4/E5. Add the SAME keys to both `zh-Hant` and `en` blocks.

- [ ] **Step 1: Implement (no test; verified by usage in later tasks)**

Add to both locale blocks (zh-Hant values shown; provide natural en equivalents):
```ts
      gameSettings: '遊戲設定',
      settingUnlimitedStationBorrow: '車站無限借用路線',
      settingUnlimitedStationBorrowDesc: '每個車站可借用所有相鄰的對手路線；任務於連通當下即時鎖定計分。',
      settingSecondDrawAfterRainbow: '盲抽彩虹後可再抽一張',
      settingSecondDrawAfterRainbowDesc: '關閉時，第一張盲抽到彩虹（火車頭）即結束抽牌。',
      settingNoUnfinishedPenalty: '未完成任務不扣分',
      settingNoUnfinishedPenaltyDesc: '開啟時，未完成的任務卡計 0 分而非扣分。',
      allowSpectating: '允許觀戰',
      roomVisibility: '房間可見度',
      visibility_PUBLIC: '公開',
      visibility_INVITE_ONLY: '僅限邀請',
      publicRooms: '公開房間',
      noPublicRooms: '目前沒有公開房間',
      watch: '觀戰',
      spectating: '觀戰中',
      spectatingHint: '你正在觀戰，無法進行操作。',
```

- [ ] **Step 2: Typecheck + commit**

Run: `yarn workspace @trm/web typecheck`
```bash
git add apps/web/src/i18n/index.ts
git commit -m "feat(web): i18n keys for per-game settings, public rooms, spectating"
```

### Task E3: Host-only Game Settings panel in the lobby

**Files:**
- Modify: `apps/web/src/screens/RoomScreen.tsx`
- Test: `apps/web/src/screens/RoomScreen.test.tsx` (extend)

**Interfaces:**
- Consumes: `api.updateRoomSettings`, `room.settings`, `isHost`. Renders toggles for the 3 variants + spectating, a segmented control for visibility. Read-only for non-hosts; the whole panel is disabled when `room.status !== 'LOBBY'`.

- [ ] **Step 1: Write the failing test**

```ts
it('host sees enabled settings controls; non-host sees them disabled', () => { /* render with room.hostId === user.id and !== */ });
it('toggling a setting calls updateRoomSettings', () => { /* click → api.updateRoomSettings called with patch */ });
```

- [ ] **Step 2: Run to verify it fails** — `yarn workspace @trm/web test --run RoomScreen`

- [ ] **Step 3: Implement**

Add a `setSetting` helper near the other guards in `RoomScreen`:
```ts
const setSetting = (patch: Partial<RoomSettings>) => void guard(api.updateRoomSettings(code, patch));
const settings = room.settings;
const settingsLocked = !isHost || room.status !== 'LOBBY';
```
Render a panel between the member list and the bot controls:
```tsx
<fieldset className="card stack" disabled={settingsLocked}>
  <legend>{t('gameSettings')}</legend>
  {([
    ['unlimitedStationBorrow', 'settingUnlimitedStationBorrow', 'settingUnlimitedStationBorrowDesc'],
    ['secondDrawAfterBlindRainbow', 'settingSecondDrawAfterRainbow', 'settingSecondDrawAfterRainbowDesc'],
    ['noUnfinishedTicketPenalty', 'settingNoUnfinishedPenalty', 'settingNoUnfinishedPenaltyDesc'],
  ] as const).map(([key, label, desc]) => (
    <label key={key} className="row between">
      <span><strong>{t(label)}</strong><br /><span className="muted">{t(desc)}</span></span>
      <input type="checkbox" checked={settings[key]} onChange={(e) => setSetting({ [key]: e.target.checked })} />
    </label>
  ))}
  <label className="row between">
    <span><strong>{t('allowSpectating')}</strong></span>
    <input type="checkbox" checked={settings.allowSpectating}
      onChange={(e) => setSetting({ allowSpectating: e.target.checked })} />
  </label>
  <div className="row between">
    <strong>{t('roomVisibility')}</strong>
    <div className="row">
      {(['PUBLIC', 'INVITE_ONLY'] as const).map((v) => (
        <button key={v} className={settings.visibility === v ? 'primary' : ''}
          onClick={() => setSetting({ visibility: v })} disabled={settingsLocked}>
          {t(`visibility_${v}`)}
        </button>
      ))}
    </div>
  </div>
</fieldset>
```
Import `RoomSettings` from `../net/rest`.

- [ ] **Step 4: Run to verify it passes + commit**

Run: `yarn workspace @trm/web test --run RoomScreen`
```bash
git add apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx
git commit -m "feat(web): host-only game settings panel in the lobby"
```

### Task E4: Public-rooms list on the home screen

**Files:**
- Modify: `apps/web/src/screens/HomeScreen.tsx`
- Test: `apps/web/src/screens/HomeScreen.test.tsx` (extend)

**Interfaces:**
- Consumes: `api.getPublicRooms`, `api.spectate`, `enterRoom`, `connectGame`, `enterGame`. Renders a list; each LOBBY room → Join; each STARTED room → Watch.

- [ ] **Step 1: Write the failing test** — mock `api.getPublicRooms` to return one LOBBY + one STARTED room; assert a Join and a Watch control render; clicking Watch calls `api.spectate`.

- [ ] **Step 2: Run to verify it fails** — `yarn workspace @trm/web test --run HomeScreen`

- [ ] **Step 3: Implement**

Add state + effect:
```tsx
const [publicRooms, setPublicRooms] = useState<RoomView[]>([]);
useEffect(() => {
  let active = true;
  const load = () => api.getPublicRooms().then((r) => active && setPublicRooms(r)).catch(() => {});
  void load();
  const id = setInterval(load, 5000);
  return () => { active = false; clearInterval(id); };
}, []);
const watch = async (code: string) => {
  const tk = await api.spectate(code);
  connectGame(tk.ticket);
  enterGame(tk.gameId, tk.ticket); // spectator: snapshot will have no `you`
};
```
Render after the create/join card:
```tsx
<div className="card stack">
  <h3>{t('publicRooms')}</h3>
  {publicRooms.length === 0 && <p className="muted">{t('noPublicRooms')}</p>}
  {publicRooms.map((r) => (
    <div key={r.code} className="row between">
      <span><code>{r.code}</code> · {r.members.length}/{r.maxPlayers}</span>
      {r.status === 'LOBBY'
        ? <button onClick={() => enterRoom(r.code)}>{t('joinRoom')}</button>
        : <button onClick={() => void watch(r.code)}>{t('watch')}</button>}
    </div>
  ))}
</div>
```
Import `connectGame` from `../net/connection`, `enterGame` from `useUi`, `RoomView` from `../net/rest`.

- [ ] **Step 4: Run to verify it passes + commit**

Run: `yarn workspace @trm/web test --run HomeScreen`
```bash
git add apps/web/src/screens/HomeScreen.tsx apps/web/src/screens/HomeScreen.test.tsx
git commit -m "feat(web): public rooms list with Join/Watch on the home screen"
```

### Task E5: Spectator read-only game view + banked ticket points

**Files:**
- Modify: `apps/web/src/screens/GameScreen.tsx`
- Test: `apps/web/src/screens/*` (extend if a GameScreen test exists; else add a focused render test)

**Interfaces:**
- Consumes: `snapshot.you` (undefined ⇒ spectator), `snapshot.completedTickets`, content ticket values. Renders a "spectating" banner and hides action affordances when `you` is undefined; shows running score = `routePoints + Σ(completed ticket values)`.

- [ ] **Step 1: Write the failing test** — render `GameScreen` with a snapshot whose `you` is undefined; assert the spectating banner renders and no action buttons (e.g. claim/draw) are present.

- [ ] **Step 2: Run to verify it fails** — `yarn workspace @trm/web test --run GameScreen`

- [ ] **Step 3: Implement**

Add near the top of the component body (after `snapshot` is read):
```tsx
const isSpectator = !snapshot.you;
```
Render the banner (e.g., above the board):
```tsx
{isSpectator && <div className="banner muted">{t('spectating')} — {t('spectatingHint')}</div>}
```
Guard action affordances: most already key off `me` (which is `null` for spectators) and current-turn checks. Verify each interactive control (claim, draw, build, ticket-keep) is additionally gated by `!isSpectator`; add `disabled={isSpectator}` / early-returns where a control could otherwise fire. (Read the component and audit each `onClick` that dispatches a command.)

Banked ticket points (decision §10.2 — derive client-side; no proto change): compute per player from `snapshot.completedTickets` and the content ticket values, and display `routePoints + banked` as the running score wherever the scoreboard/tracker shows a player's points:
```tsx
import { ticketById } from '../game/content'; // or the existing content accessor
const bankedFor = (playerId: string) => snapshot.completedTickets
  .filter((c) => c.playerId === playerId)
  .reduce((sum, c) => sum + (ticketById(c.ticketId)?.value ?? 0), 0);
// displayed score = player.routePoints + bankedFor(player.id)
```
(Adjust to the real content accessor name in `apps/web/src/game/content.ts`.)

- [ ] **Step 4: Run to verify it passes + commit**

Run: `yarn workspace @trm/web test --run GameScreen`
```bash
git add apps/web/src/screens/GameScreen.tsx apps/web/src/screens
git commit -m "feat(web): spectator read-only game view + live banked ticket points"
```

---

## Phase F — Full verification

### Task F1: Cross-package green + format

- [ ] **Step 1: Regenerate proto, then run the whole pipeline**

```bash
yarn workspace @trm/proto generate
yarn build
yarn typecheck
yarn lint
yarn test
yarn format:check
```
Expected: all PASS. (`yarn build` runs proto codegen first per the turbo graph.)

- [ ] **Step 2: Fix any failures, re-run, then final commit if needed**

```bash
git add -A
git commit -m "chore: per-game settings — full-pipeline green (typecheck/lint/test/format)"
```

### Task F2: Manual smoke (optional, if a dev environment is available)

- [ ] Start Mongo + server + web; create a room; toggle each setting as host; confirm a non-host sees them read-only; set INVITE_ONLY and confirm the room drops off `GET /rooms/public`; start a game with `unlimitedStationBorrow` and confirm a ticket locks + score banks mid-game; open the public list as another user and Watch the live game (no hand, no actions); verify `secondDrawAfterBlindRainbow=off` ends the draw on a blind rainbow.

---

## Self-Review (completed by the plan author)

**Spec coverage:** §1 settings → A1, B1–B4, D1–D5; §2 two planes → A1 (RuleParams) + D1 (RoomDoc); §3 versioning → B5; §4.1 → B1; §4.2 → B2; §4.3 → B3+B4; §5 server → D1–D5; §6 proto → C1; §7 web → E1–E5; §8 testing → tests in every task + F1; §9 decisions → reflected (lock-in B4, full spectator D5/E4/E5, lobby panel E3, version bump B5, banked points E5 client-derived, guests watch D5). All covered.

**Placeholder scan:** code shown for each implementation step; test bodies sketch the assertions with the real APIs. The few "audit the component" notes (E5) are genuine read-then-edit steps, not deferred logic.

**Type consistency:** `RoomSettings`/`DEFAULT_ROOM_SETTINGS` defined in D1, reused verbatim in D2/D3/D5/E1; `borrowConnectedTicketIds`/`stationBorrowEdges` defined in B3, used in B4; `completedTickets` defined in B4, read in B3's end-game branch and C1/E5; `game_settings` tag 21 consistent C1↔snapshot; `seat: -1` spectator sentinel consistent D5.
