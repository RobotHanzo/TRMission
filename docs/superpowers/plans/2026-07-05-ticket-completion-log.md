# Ticket-Completion Action Log + Rainbow Locomotive Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine's existing `TICKET_COMPLETED` event fire for own-track ticket completion
in every game (not just the `unlimitedStationBorrow` variant), wire it through the protocol/codec
to the client's action log, and fix the log's face-up locomotive chip to render the rainbow wash
instead of its flat grey hex.

**Architecture:** `lockCompletedTickets` (engine) is generalized to branch per-variant instead of
no-op'ing off-variant, which is a `stateDigest`-affecting behavior change (`ENGINE_VERSION` 6→7).
The already-existing `TICKET_COMPLETED` engine event is un-dropped in `@trm/codec` and given a real
wire message (`PROTOCOL_VERSION` 3→4). The server needs no code change beyond the version-gate
narrowing: `GameSession.history()` re-derives events by replaying `appliedActions` through the
current engine on every call, so both the live broadcast and reconnect backfill pick this up for
free. The web log (`logModel.ts`/`LogPanel.tsx`) gets a new case, and the locomotive chip swaps its
flat hex for the existing `LOCOMOTIVE_GRADIENT` token (already used by `CardMarket.tsx`).

**Tech Stack:** TypeScript, vitest (engine/codec/proto/server/web workspaces), protobuf-es + buf
codegen, i18next.

## Global Constraints

- No `Date`, `Math.random`, `crypto.randomUUID`, `new Date()` inside `packages/engine/src/**`
  (ESLint-enforced purity) — not touched by this plan, but any new engine code must respect it.
- `ENGINE_VERSION` bumps are behavior-changing version markers; every bump must extend the
  version-history comment in `packages/engine/src/types/state.ts`, not just the number.
- `PROTOCOL_VERSION` bumps follow the same pattern in `packages/proto/src/index.ts` — extend the
  comment, don't just change the number.
- After any `.proto` edit, `yarn workspace @trm/proto generate` must be rerun — `src/gen/` is
  gitignored and a drift between it and the `.proto` is a CI failure.
- UI strings live in `apps/web/src/i18n/index.ts`; Traditional Chinese (`zh-Hant`) is primary,
  English is the fallback — every new string needs both.
- Follow this repo's commit convention: create a new commit per task; never `--amend`, never
  `--no-verify`.
- Never use `git add -A`/`git add .` — stage only the files each task actually touches.

---

### Task 1: Engine — generalize `lockCompletedTickets` to fire off-variant; bump `ENGINE_VERSION`

**Files:**

- Modify: `packages/engine/src/reduce.ts:19,791-834`
- Modify: `packages/engine/src/types/state.ts:38-40,129-139`
- Modify: `packages/engine/test/instant-completion.spec.ts:79,147-164`
- Modify: `packages/engine/test/variants-determinism.spec.ts:1-3,22-24,75-80`

**Interfaces:**

- Produces: `lockCompletedTickets(board, state)` (unexported, same signature) now locks own-track
  completions in EVERY game, not just under `ruleParams.unlimitedStationBorrow`.
  `ENGINE_VERSION` becomes `7` (exported from `packages/engine/src/types/state.ts`, already
  re-exported from `packages/engine/src/index.ts` — no change needed there).

This has been empirically verified against the current test suite (see the "why" note at the end
of this task) — only one existing test needed to change its expected outcome.

- [ ] **Step 1: Update the stale `completedTickets` doc comment**

In `packages/engine/src/types/state.ts`, change:

```ts
  /** Tickets locked as completed mid-game (only populated under the unlimitedStationBorrow
   *  variant). Monotonic; points are banked the moment a ticket enters this list. */
  readonly completedTickets: readonly TicketId[];
```

to:

```ts
  /** Tickets locked as completed mid-game the instant own-track connectivity (or, under
   *  unlimitedStationBorrow, the fuller borrow-aware check) joins their endpoints. Monotonic;
   *  points are banked the moment a ticket enters this list. */
  readonly completedTickets: readonly TicketId[];
```

- [ ] **Step 2: Bump `ENGINE_VERSION` and extend the version-history comment**

In `packages/engine/src/types/state.ts`, change:

```ts
// v6: rule 7.5 also forces a re-draw when every kept ticket is locked in `completedTickets` (the
// unlimitedStationBorrow variant's station-borrow completion), not just own-connected — closing a
// gap where a borrow-only completion never triggered the forced re-draw. Off-variant behavior
// (completedTickets always empty) is identical to v5.
export const ENGINE_VERSION = 6;
```

to:

```ts
// v6: rule 7.5 also forces a re-draw when every kept ticket is locked in `completedTickets` (the
// unlimitedStationBorrow variant's station-borrow completion), not just own-connected — closing a
// gap where a borrow-only completion never triggered the forced re-draw. Off-variant behavior
// (completedTickets always empty) is identical to v5.
// v7: TICKET_COMPLETED (and the completedTickets lock) now fires for own-track completion in
// EVERY game, not just unlimitedStationBorrow — closing the gap where a standard game's ticket
// completions were never locked/announced mid-game, only computed on demand for display. This
// only changes *when* completedTickets is populated; a game's final scoring is unaffected
// (evaluatePlayerTickets always re-derives completion independently, never reading this field
// off-variant).
export const ENGINE_VERSION = 7;
```

- [ ] **Step 3: Update the failing-first test in `instant-completion.spec.ts`**

In `packages/engine/test/instant-completion.spec.ts`, change the describe title (line 79):

```ts
describe('instant locked ticket completion (unlimitedStationBorrow on)', () => {
```

to:

```ts
describe('instant locked ticket completion', () => {
```

Then replace the last test in that file (lines 147-164):

```ts
  it('does not record completion in state when the variant is off', () => {
    const { board, config } = cfg(); // default: unlimitedStationBorrow false
    const { t, r } = findDirect(board)!;
    const me = asPlayerId('p0');
    const state = readyState(initGame(board, config), {
      p0: { hand: locoHand(), keptTickets: [t.id] },
    });
    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: me,
      routeId: r.id,
      payment: allLoco(r.length),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.players['p0']!.completedTickets).toEqual([]);
    expect(res.value.events.some((e) => e.e === 'TICKET_COMPLETED')).toBe(false);
  });
});
```

with:

```ts
  it('also locks own-track completion when the variant is off (default game)', () => {
    const { board, config } = cfg(); // default: unlimitedStationBorrow false
    const { t, r } = findDirect(board)!;
    const me = asPlayerId('p0');
    const state = readyState(initGame(board, config), {
      p0: { hand: locoHand(), keptTickets: [t.id] },
    });
    const res = reduce(board, state, {
      t: 'CLAIM_ROUTE',
      player: me,
      routeId: r.id,
      payment: allLoco(r.length),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.players['p0']!.completedTickets).toContain(t.id);
    expect(
      res.value.events.some(
        (e) => e.e === 'TICKET_COMPLETED' && e.ticket === t.id && e.player === me,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 4: Run the instant-completion suite to verify it fails (pre-fix)**

Run: `yarn workspace @trm/engine test --run instant-completion`
Expected: FAIL — `also locks own-track completion when the variant is off` fails because
`lockCompletedTickets` still no-ops off-variant (`completedTickets` is `[]`, no `TICKET_COMPLETED`
event). The other 2 tests in the file still pass.

- [ ] **Step 5: Generalize `lockCompletedTickets` in `reduce.ts`**

In `packages/engine/src/reduce.ts:19`, change:

```ts
import { borrowConnectedTicketIds, citiesConnected } from './graph/connectivity';
```

to:

```ts
import {
  borrowConnectedTicketIds,
  ownConnectedTicketIds,
  citiesConnected,
} from './graph/connectivity';
```

Then replace the whole `lockCompletedTickets` function and its doc comment (currently around
lines 782-834):

```ts
// ─────────────────────────────────────── instant ticket completion ──────────────────────────

/**
 * Under `unlimitedStationBorrow`, re-evaluate every player's kept tickets after a connectivity
 * change and lock any newly-completed ones into `completedTickets`, emitting TICKET_COMPLETED.
 * No-op when the variant is off. ALL players are checked because an opponent's claim into a
 * player's station city can complete that player's ticket. The borrow graph only grows, so this
 * is monotonic — a locked ticket never retracts, and the locked set equals the end-game total.
 */
function lockCompletedTickets(
  board: Board,
  state: GameState,
): { state: GameState; events: GameEvent[] } {
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

with:

```ts
// ─────────────────────────────────────── instant ticket completion ──────────────────────────

/**
 * Re-evaluate every player's kept tickets after a connectivity change and lock any
 * newly-completed ones into `completedTickets`, emitting TICKET_COMPLETED. Own-track completion
 * (`ownConnectedTicketIds`) is checked in EVERY game; under `unlimitedStationBorrow` the fuller
 * borrow-aware check (`borrowConnectedTicketIds`, a superset) is used instead. ALL players are
 * checked because an opponent's claim into a player's station city can complete that player's
 * ticket under the borrow variant. Both checks are monotonic — a locked ticket never retracts,
 * and the locked set equals the end-game total.
 */
function lockCompletedTickets(
  board: Board,
  state: GameState,
): { state: GameState; events: GameEvent[] } {
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

    const connected = state.ruleParams.unlimitedStationBorrow
      ? borrowConnectedTicketIds({
          ownEdges,
          borrowEdges: stationBorrowEdges(board, next, pid),
          tickets,
        })
      : ownConnectedTicketIds({ ownEdges, tickets });
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

- [ ] **Step 6: Run the instant-completion suite to verify it passes**

Run: `yarn workspace @trm/engine test --run instant-completion`
Expected: PASS (3 tests).

- [ ] **Step 7: Update `variants-determinism.spec.ts`**

Change the import (line 3):

```ts
import { borrowConnectedTicketIds } from '../src/graph/connectivity';
```

to:

```ts
import { borrowConnectedTicketIds, ownConnectedTicketIds } from '../src/graph/connectivity';
```

Change the version test (lines 22-24):

```ts
it('is engine version 6 (rule 7.5 also counts unlimitedStationBorrow-locked completion)', () => {
  expect(ENGINE_VERSION).toBe(6);
});
```

to:

```ts
it('is engine version 7 (TICKET_COMPLETED/completedTickets lock now fires off-variant too)', () => {
  expect(ENGINE_VERSION).toBe(7);
});
```

Replace the off-variant test (lines 75-80):

```ts
  it('records no locked completion when the variant is off (default game)', () => {
    const r = playGreedyGame(3, 'no-variant', {});
    for (const pid of r.finalState.turnOrder) {
      expect(r.finalState.players[pid as string]!.completedTickets).toEqual([]);
    }
  });
});
```

with:

```ts
  it('locked completion (variant off) always equals a fresh own-track recomputation', () => {
    const r = playGreedyGame(3, 'no-variant', {});
    expect(r.finalState.turn.phase).toBe('GAME_OVER');
    for (const pid of r.finalState.turnOrder) {
      const p = r.finalState.players[pid as string]!;
      const keptGoals = p.keptTickets
        .map((id) => {
          const t = r.board.ticketById.get(id as string);
          return t ? { id: id as string, a: t.a as string, b: t.b as string } : null;
        })
        .filter((x): x is { id: string; a: string; b: string } => x !== null);
      const fresh = new Set(
        ownConnectedTicketIds({
          ownEdges: ownEdgesOf(r.board, r.finalState, pid as string),
          tickets: keptGoals,
        }),
      );
      const locked = new Set(p.completedTickets as readonly string[]);
      expect(locked).toEqual(fresh);
    }
  });
});
```

Note: this seed (`'no-variant'`, 3 players) happens to never complete a ticket via own track
before `GAME_OVER` — verified empirically while writing this plan — so both sides of the
`toEqual` are empty sets here. That's fine: the assertion is a genuine regression guard (it would
catch the lock diverging from a fresh recomputation), it's just not exercising the non-empty case
in this particular run. The non-empty case is already covered directly by
`instant-completion.spec.ts`'s hand-crafted scenario (Step 3 above), and by the sibling
`unlimitedStationBorrow` monotonicity test already in this file (`'locked completion set equals a
fresh end-game evaluation'`). Do **not** add a `sawCompletion` sanity assertion here (unlike the
borrow-variant sibling test) — it would fail for this seed.

- [ ] **Step 8: Run the full engine test suite**

Run: `yarn workspace @trm/engine test`
Expected: PASS — all suites green, including `off-mode-identity.spec.ts` (verified empirically
while writing this plan: the frozen `golden/off-mode.json` fixture's game never completes a ticket
via own track either, so this change is a no-op for that fixture — **no golden-fixture
regeneration is needed**) and `variants-determinism.spec.ts`'s `'replays byte-identically under
each variant'` test (this change doesn't affect replay determinism, only what state/events a
single reduce produces).

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/reduce.ts packages/engine/src/types/state.ts packages/engine/test/instant-completion.spec.ts packages/engine/test/variants-determinism.spec.ts
git commit -m "$(cat <<'EOF'
feat(engine): TICKET_COMPLETED now fires for own-track completion off-variant

lockCompletedTickets only ran under unlimitedStationBorrow, so a standard
game's ticket completions were never locked into completedTickets or
announced via TICKET_COMPLETED — only computed on demand for display.
Generalized to check own-track connectivity in every game (the borrow
variant still uses the fuller borrow-aware check). Bumps ENGINE_VERSION
6 -> 7 (behavior-changing: changes when completedTickets is populated,
never final scoring).
EOF
)"
```

---

### Task 2: Server — narrow the replay-compat allowlist to engine v7 only

**Files:**

- Modify: `apps/server/src/history/history.repo.ts:42-52`
- Modify: `apps/server/test/history-replay-compat.spec.ts`

**Interfaces:**

- Consumes: `ENGINE_VERSION` is now `7` (Task 1).
- Produces: `REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] = [7]` (unchanged export
  name/type).

- [ ] **Step 1: Update the failing test**

Replace the full contents of `apps/server/test/history-replay-compat.spec.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CONTENT_HASH } from '@trm/engine';
import { createTestApp, type TestApp } from './app';
import { HistoryRepo, REPLAY_COMPATIBLE_ENGINE_VERSIONS } from '../src/history/history.repo';
import type { MatchHistoryDoc } from '../src/persistence/types';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('history: replay-compat engine-version allowlist (plan risk R1)', () => {
  it('marks a v7-stamped game replayable and a v6-stamped game not (on a resolvable map)', async () => {
    const userId = 'u-compat';
    const now = Date.now();
    const base = {
      players: [{ userId, seat: 0 }],
      turnOrder: [userId],
      seed: 's',
      contentHash: CONTENT_HASH, // official Taiwan resolves synchronously → board build is not the gate
      finalScores: { players: [], ranking: [] },
      winners: [] as string[],
    };
    await t.db.collection<MatchHistoryDoc>('matchHistory').insertMany([
      { _id: 'g-v7', ...base, engineVersion: 7, completedAt: new Date(now - 1000) },
      { _id: 'g-v6', ...base, engineVersion: 6, completedAt: new Date(now - 2000) },
    ]);

    const rows = await t.app.get(HistoryRepo).listForUser(userId);
    const byId = new Map(rows.map((r) => [r.gameId, r]));
    // v7 is in the allowlist AND its map still builds → replayable.
    expect(byId.get('g-v7')?.replayable).toBe(true);
    // v6 predates the (narrowed) allowlist → not replayable, even though it used to be.
    expect(byId.get('g-v6')?.replayable).toBe(false);
  });

  it('allowlists only the current engine major — this fix is not provably inert for older majors', () => {
    expect(REPLAY_COMPATIBLE_ENGINE_VERSIONS).toEqual([7]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run history-replay-compat`
Expected: FAIL — `REPLAY_COMPATIBLE_ENGINE_VERSIONS` is still `[6]`, so `g-v7` is marked
`replayable: false` (not in the list) and `g-v6` is marked `replayable: true` (still in the list);
the second test's `toEqual([7])` also fails.

- [ ] **Step 3: Narrow the allowlist in `history.repo.ts`**

In `apps/server/src/history/history.repo.ts:42-52`, change:

```ts
/**
 * Engine major versions whose persisted action logs the current server can still replay
 * byte-identically. v5 replayed a v4 log identically (v5 only added inert genesis fields), but v6
 * is NOT provably inert for v4/v5 games: it changes turn sequencing for any `unlimitedStationBorrow`
 * game where a player's kept tickets completed via station-borrow only (not own track) — a replay
 * of such a game would now diverge into a forced ticket re-draw a turn earlier than it actually
 * happened, breaking the next logged action's phase expectation. So v6 stands alone rather than
 * extending the allowlist. Only extend this list for a new version when the change is provably
 * inert for the versions already listed.
 */
export const REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] = [6];
```

to:

```ts
/**
 * Engine major versions whose persisted action logs the current server can still replay
 * byte-identically. v5 replayed a v4 log identically (v5 only added inert genesis fields), but v6
 * is NOT provably inert for v4/v5 games (see history in git blame), and v7 is not provably inert
 * for v6 either: v7 locks own-track ticket completions into `completedTickets` (and emits
 * TICKET_COMPLETED) mid-game for every ruleset, not just unlimitedStationBorrow, which changes
 * `stateDigest` at exactly the points a ticket completes — a v6 game replayed under v7 would
 * digest-mismatch at that step. So v7 stands alone rather than extending the allowlist. Only
 * extend this list for a new version when the change is provably inert for the versions already
 * listed.
 */
export const REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] = [7];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run history-replay-compat`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full server test suite**

Run: `yarn workspace @trm/server test`
Expected: PASS. Confirm no other spec hardcodes `REPLAY_COMPATIBLE_ENGINE_VERSIONS` or an
`engineVersion: 6`/`7` expectation elsewhere (a repo-wide grep for `REPLAY_COMPATIBLE_ENGINE_VERSIONS`
during planning found only `history.repo.ts` and this spec).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/history/history.repo.ts apps/server/test/history-replay-compat.spec.ts
git commit -m "$(cat <<'EOF'
fix(server): narrow replay-compat allowlist to engine v7 only

The v6->v7 instant-completion fix isn't provably inert for existing
history (it changes stateDigest at the moment a ticket completes in any
ruleset), so extending the allowlist to [6, 7] could offer a replay that
digest-mismatches mid-playback. Existing v6 (and older) match history now
shows as not replayable.
EOF
)"
```

---

### Task 3: Proto — add the `TicketCompleted` wire message; bump `PROTOCOL_VERSION`

**Files:**

- Modify: `packages/proto/proto/trmission/v1/server.proto`
- Modify: `packages/proto/src/index.ts`

**Interfaces:**

- Produces: `TicketCompleted { player_id: string; ticket_id: string }` message, wired into
  `GameEvent.event` oneof as `ticket_completed` (field 25) — consumed by
  `packages/codec/src/events.ts` in Task 4 as the `'ticketCompleted'` case, and by
  `apps/web/src/game/logModel.ts` in Task 5.
- `PROTOCOL_VERSION` becomes `4`.

There is no test-first cycle here (this is schema + codegen, not logic) — verification is the
generated types compiling and the existing proto test suite still passing.

- [ ] **Step 1: Add the message and oneof case to `server.proto`**

In `packages/proto/proto/trmission/v1/server.proto`, change:

```proto
message GameEnded {}
```

to:

```proto
message GameEnded {}

// A destination ticket completed mid-game (own routes connect both endpoints, or — under
// unlimitedStationBorrow — a station-borrowed edge does). PUBLIC: finished tickets are public by
// design (see CompletedTicket in common.proto); the two endpoint cities/value are not carried
// here since they're static catalog content the client already resolves by ticket_id.
message TicketCompleted {
  string player_id = 1;
  string ticket_id = 2;
}
```

Then change the `GameEvent` oneof:

```proto
message GameEvent {
  oneof event {
    GameStarted game_started = 1;
    InitialTicketsOffered initial_tickets_offered = 2;
    InitialTicketsKept initial_tickets_kept = 3;
    TurnStarted turn_started = 4;
    CardDrawnBlind card_drawn_blind = 5;
    CardTakenFaceup card_taken_faceup = 6;
    MarketRefilled market_refilled = 7;
    MarketRecycled market_recycled = 8;
    DeckReshuffled deck_reshuffled = 9;
    RouteClaimed route_claimed = 10;
    DoubleRouteLocked double_route_locked = 11;
    TunnelRevealed tunnel_revealed = 12;
    TunnelResolved tunnel_resolved = 13;
    StationBuilt station_built = 14;
    TicketsOffered tickets_offered = 15;
    TicketsKept tickets_kept = 16;
    PlayerPassed player_passed = 17;
    TurnEnded turn_ended = 18;
    EndgameTriggered endgame_triggered = 19;
    GameEnded game_ended = 20;
    RandomEventAnnounced random_event_announced = 21;
    RandomEventStarted random_event_started = 22;
    RandomEventEnded random_event_ended = 23;
    RandomEventBonus random_event_bonus = 24;
  }
}
```

to:

```proto
message GameEvent {
  oneof event {
    GameStarted game_started = 1;
    InitialTicketsOffered initial_tickets_offered = 2;
    InitialTicketsKept initial_tickets_kept = 3;
    TurnStarted turn_started = 4;
    CardDrawnBlind card_drawn_blind = 5;
    CardTakenFaceup card_taken_faceup = 6;
    MarketRefilled market_refilled = 7;
    MarketRecycled market_recycled = 8;
    DeckReshuffled deck_reshuffled = 9;
    RouteClaimed route_claimed = 10;
    DoubleRouteLocked double_route_locked = 11;
    TunnelRevealed tunnel_revealed = 12;
    TunnelResolved tunnel_resolved = 13;
    StationBuilt station_built = 14;
    TicketsOffered tickets_offered = 15;
    TicketsKept tickets_kept = 16;
    PlayerPassed player_passed = 17;
    TurnEnded turn_ended = 18;
    EndgameTriggered endgame_triggered = 19;
    GameEnded game_ended = 20;
    RandomEventAnnounced random_event_announced = 21;
    RandomEventStarted random_event_started = 22;
    RandomEventEnded random_event_ended = 23;
    RandomEventBonus random_event_bonus = 24;
    TicketCompleted ticket_completed = 25;
  }
}
```

- [ ] **Step 2: Bump `PROTOCOL_VERSION` in `packages/proto/src/index.ts`**

Change:

```ts
// The current protocol version. Bump on any breaking wire change; `ClientHello`
// and `Welcome` carry it so peers can reject incompatible builds.
// v3: random-events wire shape — GameSettings.events_mode, GameSnapshot.random_events, and the
// four RandomEvent* GameEvent oneof cases (M4).
export const PROTOCOL_VERSION = 3;
```

to:

```ts
// The current protocol version. Bump on any breaking wire change; `ClientHello`
// and `Welcome` carry it so peers can reject incompatible builds.
// v3: random-events wire shape — GameSettings.events_mode, GameSnapshot.random_events, and the
// four RandomEvent* GameEvent oneof cases (M4).
// v4: TicketCompleted GameEvent oneof case (own-track ticket completion, now announced in every
// game — see ENGINE_VERSION v7 in @trm/engine).
export const PROTOCOL_VERSION = 4;
```

- [ ] **Step 3: Regenerate the codegen**

Run: `yarn workspace @trm/proto generate`
Expected: succeeds, regenerating `packages/proto/src/gen/**` (gitignored) to include
`TicketCompletedSchema` and the new `ticketCompleted` oneof case on `GameEvent`.

- [ ] **Step 4: Run the proto test suite**

Run: `yarn workspace @trm/proto test`
Expected: PASS (existing round-trip tests are unaffected — this is a purely additive schema
change).

- [ ] **Step 5: Commit**

```bash
git add packages/proto/proto/trmission/v1/server.proto packages/proto/src/index.ts
git commit -m "$(cat <<'EOF'
feat(proto): add TicketCompleted GameEvent wire message

Adds the message + GameEvent oneof case (field 25) so the engine's
TICKET_COMPLETED event (now firing in every ruleset, not just
unlimitedStationBorrow) can reach the client. Bumps PROTOCOL_VERSION
3 -> 4, matching the precedent set for the random-events oneof cases.
Generated src/gen/** is gitignored and regenerated via
`yarn workspace @trm/proto generate`.
EOF
)"
```

Note: `src/gen/**` is gitignored, so `git add` above only stages the `.proto` source and
`index.ts` — the regenerated code is rebuilt by every consumer's own `generate`/`build` step
(already wired into `turbo`'s `^build` dependency per the root `CLAUDE.md`).

---

### Task 4: Codec — stop dropping `TICKET_COMPLETED`

**Files:**

- Modify: `packages/codec/src/events.ts:118-121`
- Modify: `packages/codec/test/codec.spec.ts`

**Interfaces:**

- Consumes: `TicketCompletedSchema`/`ticketCompleted` oneof case from `@trm/proto` (Task 3).
- Produces: `eventToProto` now returns a real frame for the engine's `'TICKET_COMPLETED'` case
  instead of `null`.

- [ ] **Step 1: Write the failing test**

In `packages/codec/test/codec.spec.ts`, add this test inside the existing `describe('@trm/codec
eventToProto', ...)` block (after the last `it`, before the closing `});`):

```ts
it('wraps TICKET_COMPLETED into a real frame (public — finished tickets are not hidden)', () => {
  const completed: GameEvent = {
    e: 'TICKET_COMPLETED',
    player: p1,
    ticket: asTicketId('S17'),
    visibility: 'PUBLIC',
  };
  const forOwner = eventToProto(completed, p1);
  const forOther = eventToProto(completed, p2);
  expect(forOwner?.event.case).toBe('ticketCompleted');
  expect(forOther?.event.case).toBe('ticketCompleted');
  if (forOwner?.event.case !== 'ticketCompleted') throw new Error('wrong case');
  expect(forOwner.event.value.playerId).toBe('p1');
  expect(forOwner.event.value.ticketId).toBe('S17');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/codec test --run codec`
Expected: FAIL — `forOwner?.event.case` is `undefined` (currently `eventToProto` returns `null`
for `TICKET_COMPLETED`), so `toBe('ticketCompleted')` fails.

- [ ] **Step 3: Un-drop the case in `events.ts`**

In `packages/codec/src/events.ts`, change:

```ts
    case 'TICKET_COMPLETED':
      // Cosmetic-only: completion is already conveyed authoritatively by the snapshot's
      // `completed_tickets` list, so this engine event has no dedicated wire frame.
      return null;
```

to:

```ts
    case 'TICKET_COMPLETED':
      return wrap({
        case: 'ticketCompleted',
        value: { playerId: ev.player as string, ticketId: ev.ticket as string },
      });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/codec test --run codec`
Expected: PASS.

- [ ] **Step 5: Run the full codec test suite**

Run: `yarn workspace @trm/codec test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/codec/src/events.ts packages/codec/test/codec.spec.ts
git commit -m "$(cat <<'EOF'
feat(codec): stop dropping TICKET_COMPLETED, wrap it into a real frame

Now that the event fires in every ruleset (not just
unlimitedStationBorrow) and has a dedicated wire message
(TicketCompleted), forward it instead of discarding it — it's PUBLIC,
same as ROUTE_CLAIMED/STATION_BUILT, so no owner-gating is needed.
EOF
)"
```

---

### Task 5: Web — log a line when a ticket completes

**Files:**

- Modify: `apps/web/src/game/logModel.ts:6-23,42-170`
- Modify: `apps/web/src/game/logModel.test.ts`
- Modify: `apps/web/src/components/LogPanel.tsx:9,44-88`
- Modify: `apps/web/src/components/LogPanel.test.tsx`
- Modify: `apps/web/src/i18n/index.ts` (`log` block in both the `zh-Hant` and `en` resources)

**Interfaces:**

- Consumes: the `'ticketCompleted'` proto `GameEvent` case (Task 3/4); `ticketLabel(id, locale)`
  from `apps/web/src/game/content.ts` (existing, returns `{ a, b, value, long } | null`).
- Produces: `LogKind` gains `'ticketCompleted'`; `entriesFromEvents` handles it; `LogPanel`
  renders it.

- [ ] **Step 1: Write the failing test for `entriesFromEvents`**

In `apps/web/src/game/logModel.test.ts`, add this case inside the existing `it('maps important
actions with the right importance', ...)` test — change:

```ts
it('maps important actions with the right importance', () => {
  const out = entriesFromEvents([
    ev({ case: 'routeClaimed', value: { playerId: 'p1', routeId: 'R1', pointsAwarded: 7 } }),
    ev({ case: 'stationBuilt', value: { playerId: 'p2', cityId: 'C9' } }),
    ev({ case: 'endgameTriggered', value: { playerId: 'p1', finalTurnsRemaining: 2 } }),
  ]);
  expect(out).toEqual([
    {
      kind: 'routeClaimed',
      playerId: 'p1',
      data: { routeId: 'R1', points: 7 },
      importance: 'highlight',
    },
    { kind: 'stationBuilt', playerId: 'p2', data: { cityId: 'C9' }, importance: 'highlight' },
    { kind: 'endgame', playerId: 'p1', data: { turns: 2 }, importance: 'alert' },
  ]);
});
```

to:

```ts
it('maps important actions with the right importance', () => {
  const out = entriesFromEvents([
    ev({ case: 'routeClaimed', value: { playerId: 'p1', routeId: 'R1', pointsAwarded: 7 } }),
    ev({ case: 'stationBuilt', value: { playerId: 'p2', cityId: 'C9' } }),
    ev({ case: 'endgameTriggered', value: { playerId: 'p1', finalTurnsRemaining: 2 } }),
    ev({ case: 'ticketCompleted', value: { playerId: 'p1', ticketId: 'S17' } }),
  ]);
  expect(out).toEqual([
    {
      kind: 'routeClaimed',
      playerId: 'p1',
      data: { routeId: 'R1', points: 7 },
      importance: 'highlight',
    },
    { kind: 'stationBuilt', playerId: 'p2', data: { cityId: 'C9' }, importance: 'highlight' },
    { kind: 'endgame', playerId: 'p1', data: { turns: 2 }, importance: 'alert' },
    {
      kind: 'ticketCompleted',
      playerId: 'p1',
      data: { ticketId: 'S17' },
      importance: 'highlight',
    },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run logModel`
Expected: FAIL — `entriesFromEvents` has no `'ticketCompleted'` case, so that event is silently
omitted (falls into the `default: break`) and the 4th expected entry is missing from `out`.

- [ ] **Step 3: Add the `LogKind` + `entriesFromEvents` case in `logModel.ts`**

In `apps/web/src/game/logModel.ts`, change the `LogKind` union:

```ts
export type LogKind =
  | 'gameStarted'
  | 'turnStarted'
  | 'routeClaimed'
  | 'stationBuilt'
  | 'tunnelRevealed'
  | 'tunnelCommitted'
  | 'tunnelAborted'
  | 'drewBlind'
  | 'tookFaceup'
  | 'ticketsKept'
  | 'passed'
  | 'endgame'
  | 'gameEnded'
  | 'eventAnnounced'
  | 'eventStarted'
  | 'eventEnded'
  | 'eventBonus';
```

to:

```ts
export type LogKind =
  | 'gameStarted'
  | 'turnStarted'
  | 'routeClaimed'
  | 'stationBuilt'
  | 'tunnelRevealed'
  | 'tunnelCommitted'
  | 'tunnelAborted'
  | 'drewBlind'
  | 'tookFaceup'
  | 'ticketsKept'
  | 'ticketCompleted'
  | 'passed'
  | 'endgame'
  | 'gameEnded'
  | 'eventAnnounced'
  | 'eventStarted'
  | 'eventEnded'
  | 'eventBonus';
```

Then add a case to `entriesFromEvents`'s switch — change:

```ts
      case 'randomEventBonus':
        out.push({
          kind: 'eventBonus',
          playerId: ev.value.playerId || null,
          data: {
            reason: ev.value.reason,
            points: ev.value.points,
            cityId: ev.value.cityId,
            routeId: ev.value.routeId,
          },
          importance: 'highlight',
        });
        break;
      default:
        break; // omit the rest
```

to:

```ts
      case 'randomEventBonus':
        out.push({
          kind: 'eventBonus',
          playerId: ev.value.playerId || null,
          data: {
            reason: ev.value.reason,
            points: ev.value.points,
            cityId: ev.value.cityId,
            routeId: ev.value.routeId,
          },
          importance: 'highlight',
        });
        break;
      case 'ticketCompleted':
        out.push({
          kind: 'ticketCompleted',
          playerId: ev.value.playerId,
          data: { ticketId: ev.value.ticketId },
          importance: 'highlight',
        });
        break;
      default:
        break; // omit the rest
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run logModel`
Expected: PASS.

- [ ] **Step 5: Add the i18n strings**

In `apps/web/src/i18n/index.ts`, in the `zh-Hant` `log` block, change:

```ts
        ticketsKept: '{{name}} 保留了 {{count}} 張任務卡',
        passed: '{{name}} 跳過',
```

to:

```ts
        ticketsKept: '{{name}} 保留了 {{count}} 張任務卡',
        ticketCompleted: '{{name}} 完成任務 {{from}}–{{to}}（+{{points}}）',
        passed: '{{name}} 跳過',
```

In the `en` `log` block, change:

```ts
        ticketsKept: '{{name}} kept {{count}} ticket(s)',
        passed: '{{name}} passed',
```

to:

```ts
        ticketsKept: '{{name}} kept {{count}} ticket(s)',
        ticketCompleted: '{{name}} completed the {{from}}–{{to}} mission (+{{points}})',
        passed: '{{name}} passed',
```

- [ ] **Step 6: Write the failing `LogPanel` render test**

In `apps/web/src/components/LogPanel.test.tsx`, add this test inside the `describe('LogPanel',
...)` block (after the last `it`, before the closing `});`):

```ts
  it('renders a ticket-completed line with the resolved cities and points', () => {
    const ticket = TICKETS[0]!;
    useLog.setState({
      entries: [
        {
          id: 1,
          kind: 'ticketCompleted',
          playerId: 'p1',
          data: { ticketId: ticket.id },
          importance: 'highlight',
        },
      ],
      nextId: 2,
    });
    render(<LogPanel />);
    expect(document.querySelector('.log-line.log-highlight')).not.toBeNull();
    expect(screen.getByText(new RegExp(`\\+${ticket.value}`))).toBeInTheDocument();
  });
```

Add the `TICKETS` import to the top of the file — change:

```ts
import { LogPanel } from './LogPanel';
import { useLog } from '../store/log';
import { useGame } from '../store/game';
```

to:

```ts
import { LogPanel } from './LogPanel';
import { useLog } from '../store/log';
import { useGame } from '../store/game';
import { TICKETS } from '../game/content';
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run LogPanel`
Expected: FAIL — `LogPanel`'s `lineText` switch has no `'ticketCompleted'` case, so the function
falls through returning `undefined` and nothing matching `+{{points}}` renders.

- [ ] **Step 8: Add the render case in `LogPanel.tsx`**

In `apps/web/src/components/LogPanel.tsx`, change the import:

```ts
import { cityName, routeById } from '../game/content';
```

to:

```ts
import { cityName, routeById, ticketLabel } from '../game/content';
```

Then add a case to the `lineText` switch — change:

```ts
      case 'eventBonus':
        return t(`log.eventBonus.${String(e.data.reason)}`, {
          points: Number(e.data.points),
          city: e.data.cityId ? cityName(String(e.data.cityId), locale) : '',
          route: e.data.routeId ? routeName(String(e.data.routeId)) : '',
        });
    }
  };
```

to:

```ts
      case 'eventBonus':
        return t(`log.eventBonus.${String(e.data.reason)}`, {
          points: Number(e.data.points),
          city: e.data.cityId ? cityName(String(e.data.cityId), locale) : '',
          route: e.data.routeId ? routeName(String(e.data.routeId)) : '',
        });
      case 'ticketCompleted': {
        const label = ticketLabel(String(e.data.ticketId), locale);
        return label
          ? t('log.ticketCompleted', {
              name,
              from: label.a,
              to: label.b,
              points: label.value,
            })
          : '';
      }
    }
  };
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run LogPanel`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/game/logModel.ts apps/web/src/game/logModel.test.ts apps/web/src/components/LogPanel.tsx apps/web/src/components/LogPanel.test.tsx apps/web/src/i18n/index.ts
git commit -m "$(cat <<'EOF'
feat(web): log a line when a player completes a ticket mission

Adds the 'ticketCompleted' LogKind, wired from the wire event added in
@trm/proto/@trm/codec, rendered via the existing ticketLabel() helper
(same catalog lookup the scoreboard already uses) so the line reads
"{name} completed the {from}-{to} mission (+{points})".
EOF
)"
```

---

### Task 6: Web — rainbow locomotive chip in the log

**Files:**

- Modify: `apps/web/src/components/LogPanel.tsx:8,112-119`
- Modify: `apps/web/src/components/LogPanel.test.tsx`

**Interfaces:**

- Consumes: `LOCOMOTIVE_GRADIENT` from `apps/web/src/theme/colors.ts` (existing, already used by
  `CardMarket.tsx`).

- [ ] **Step 1: Write the failing test**

In `apps/web/src/components/LogPanel.test.tsx`, add this test inside the `describe('LogPanel',
...)` block:

```ts
  it('renders the taken face-up locomotive chip as the rainbow gradient, not a flat hex', () => {
    useLog.setState({
      entries: [
        {
          id: 1,
          kind: 'tookFaceup',
          playerId: 'p1',
          data: { color: 'LOCOMOTIVE' },
          importance: 'normal',
        },
      ],
      nextId: 2,
    });
    render(<LogPanel />);
    const chip = document.querySelector('.log-chip') as HTMLElement;
    expect(chip.style.background).toContain('linear-gradient');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run LogPanel`
Expected: FAIL — the chip currently renders `background: CARD_COLOR_TOKENS.LOCOMOTIVE.hex`
(`#9AA0A6`, a flat colour), so `chip.style.background` does not contain `linear-gradient`.

- [ ] **Step 3: Use the gradient for the locomotive chip**

In `apps/web/src/components/LogPanel.tsx`, change the import:

```ts
import { SEAT_COLORS, CARD_COLOR_TOKENS } from '../theme/colors';
```

to:

```ts
import { SEAT_COLORS, CARD_COLOR_TOKENS, LOCOMOTIVE_GRADIENT } from '../theme/colors';
```

Then change the chip render — change:

```ts
                {e.kind === 'tookFaceup' && color && (
                  <span
                    className="log-chip"
                    style={{ background: CARD_COLOR_TOKENS[color].hex }}
                    title={CARD_COLOR_TOKENS[color].nameZh}
                    aria-hidden
                  />
                )}
```

to:

```ts
                {e.kind === 'tookFaceup' && color && (
                  <span
                    className="log-chip"
                    style={{
                      background:
                        color === 'LOCOMOTIVE' ? LOCOMOTIVE_GRADIENT : CARD_COLOR_TOKENS[color].hex,
                    }}
                    title={CARD_COLOR_TOKENS[color].nameZh}
                    aria-hidden
                  />
                )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run LogPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/LogPanel.tsx apps/web/src/components/LogPanel.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): render the log's face-up locomotive chip as a rainbow wash

The wild card read as flat grey (#9AA0A6) in the action log even though
CardMarket.tsx already renders it with LOCOMOTIVE_GRADIENT for the same
"any colour" reason. Mirrors that existing fix.
EOF
)"
```

---

### Task 7: Full validation sweep

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole repo**

Run: `yarn typecheck`
Expected: PASS, no errors in `packages/engine`, `packages/proto`, `packages/codec`,
`apps/server`, or `apps/web`.

- [ ] **Step 2: Lint the whole repo**

Run: `yarn lint`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `yarn test`
Expected: PASS across every workspace in the turbo graph.

- [ ] **Step 4: Fix anything the sweep surfaces**

If any step above fails, fix the issue in the relevant task's files, re-run the failing command,
and commit the fix with a message referencing which task it corrects (e.g. `fix(engine): ...`).
Do not proceed until `yarn typecheck`, `yarn lint`, and `yarn test` are all green.
