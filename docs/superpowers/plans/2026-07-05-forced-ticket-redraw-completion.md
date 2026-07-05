# Forced Ticket Re-draw Completion Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the engine's rule-7.5 forced ticket re-draw so it also fires when a player's kept
tickets are completed via the `unlimitedStationBorrow` variant's station-borrow (not just live
own-track connectivity), and add a frontend notification explaining the forced re-draw when it
fires.

**Architecture:** Generalize `allKeptTicketsOwnConnected` (engine) into `allKeptTicketsCompleted`,
which treats a kept ticket as done if it's own-connected right now OR already locked in
`PlayerState.completedTickets`. This requires an `ENGINE_VERSION` bump (behavior-changing) and, as
a direct consequence, narrowing the server's replay-compatibility allowlist so old match history
isn't presented as replayable when it can no longer safely be. The frontend then detects the
forced-redraw case (via the `TURN_STARTED` + `TICKETS_OFFERED` event pairing already on the wire)
and surfaces a notification chip through the existing `pushNotification` plumbing — no protocol
change.

**Tech Stack:** TypeScript, vitest (all three workspaces), Zustand (web store), i18next.

## Global Constraints

- No `Date`, `Math.random`, `crypto.randomUUID` inside `packages/engine/src/**` (ESLint-enforced
  purity) — not touched by this plan, but any new engine code must respect it.
- `ENGINE_VERSION` bumps are behavior-changing version markers; every bump must extend the
  version-history comment in `packages/engine/src/types/state.ts`, not just the number.
- `REPLAY_COMPATIBLE_ENGINE_VERSIONS` (`apps/server/src/history/history.repo.ts`) is narrowed to
  `[6]` only — do not extend it to include 4 or 5, per the explicit decision in the design spec
  (this fix is not provably inert for existing `unlimitedStationBorrow` games).
- UI strings live in `apps/web/src/i18n/index.ts`; Traditional Chinese (`zh-Hant`) is primary,
  English is the fallback — every new string needs both.
- Follow this repo's commit convention: create a new commit per task; never `--amend`, never
  `--no-verify`.

---

### Task 1: Engine — generalize rule 7.5's completion check + bump ENGINE_VERSION

**Files:**

- Modify: `packages/engine/src/tickets.ts:38-71`
- Modify: `packages/engine/src/turn.ts:1-11,86-96`
- Modify: `packages/engine/src/types/state.ts:129-135`
- Modify: `packages/engine/test/forcedTicketDraw.spec.ts`
- Modify: `packages/engine/test/variants-determinism.spec.ts:22-24`

**Interfaces:**

- Produces: `allKeptTicketsCompleted(board: Board, state: GameState, player: PlayerId): boolean`
  (exported from `packages/engine/src/tickets.ts`, replaces `allKeptTicketsOwnConnected`).
  `ENGINE_VERSION` becomes `6` (exported from `packages/engine/src/types/state.ts`, re-exported
  from `packages/engine/src/index.ts` already — no change needed there).

- [ ] **Step 1: Write the failing test for borrow-only completion**

Add this test to `packages/engine/test/forcedTicketDraw.spec.ts`, inside the existing
`describe('forced ticket re-draw (rule 7.5)', ...)` block (after the last `it`, before the closing
`});`):

```ts
it('forces a redraw when the completed ticket is locked via station-borrow only (unlimitedStationBorrow)', () => {
  const { board, config } = cfg({ unlimitedStationBorrow: true });
  const { t, r } = findDirect(board);
  const r2 = findOtherSimple(board, r.id as string);
  const p0 = asPlayerId('p0');
  const p1 = asPlayerId('p1');

  const state: GameState = {
    ...readyState(
      initGame(board, config),
      { p0: { keptTickets: [t.id] }, p1: { hand: locoHand(), keptTickets: [] } },
      { [r.id as string]: { owner: p1 } }, // p1 owns the direct route — p0 owns nothing itself
    ),
    stations: [{ playerId: p0, cityId: t.a as string }], // p0's station borrows p1's route
  };

  const res = reduce(board, state, {
    t: 'CLAIM_ROUTE',
    player: p1,
    routeId: r2.id,
    payment: allLoco(r2.length),
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const ns = res.value.state;
  // The borrow-only completion gets locked as a side effect of p1's claim (lockCompletedTickets
  // runs for every player before endTurn)...
  expect(ns.players['p0']!.completedTickets).toContain(t.id);
  // ...and p0's turn, which starts next, opens straight into a forced re-draw even though p0
  // owns no track at all.
  expect(ns.turn.phase).toBe('TICKET_SELECTION');
  expect(currentPlayerId(ns)).toBe(p0);
  expect(ns.players['p0']!.pendingTicketOffer).not.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/engine test --run forcedTicketDraw`
Expected: FAIL — the new test's `expect(ns.turn.phase).toBe('TICKET_SELECTION')` assertion fails
(actual phase is `AWAIT_ACTION`), because `allKeptTicketsOwnConnected` doesn't consult
`completedTickets` yet.

- [ ] **Step 3: Generalize the predicate in `tickets.ts`**

Replace the whole `allKeptTicketsOwnConnected` function (lines 38-71 of
`packages/engine/src/tickets.ts`) with:

```ts
/**
 * Rule 7.5 predicate: true iff `player` holds at least one kept ticket and EVERY kept ticket is
 * already complete — either connected by their own track right now (own-edge connectivity,
 * knowable mid-game and monotonic) or already locked into `completedTickets` (the
 * `unlimitedStationBorrow` variant's station-borrow completion, also monotonic). Checking both
 * means this predicate is correct under either ruleset without branching on `ruleParams`: when the
 * variant is off, `completedTickets` stays permanently empty, so this reduces to the own-connected
 * check alone. Such a player has no objective left, so the turn sequencer forces them to draw new
 * tickets at the start of their turn.
 */
export function allKeptTicketsCompleted(board: Board, state: GameState, player: PlayerId): boolean {
  const p = state.players[player as string];
  if (!p || p.keptTickets.length === 0) return false;

  const ownEdges: { a: string; b: string }[] = [];
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if ('owner' in cell && cell.owner === player) {
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
  // A kept ticket without a definition should never happen — be conservative and don't force.
  if (tickets.length !== p.keptTickets.length) return false;

  const ownConnected = new Set(ownConnectedTicketIds({ ownEdges, tickets }));
  const completed = new Set(p.completedTickets as readonly string[]);
  return tickets.every((t) => ownConnected.has(t.id) || completed.has(t.id));
}
```

- [ ] **Step 4: Update the call site in `turn.ts`**

In `packages/engine/src/turn.ts:6`, change:

```ts
import { offerTickets, allKeptTicketsOwnConnected } from './tickets';
```

to:

```ts
import { offerTickets, allKeptTicketsCompleted } from './tickets';
```

In `packages/engine/src/turn.ts:86-90`, change:

```ts
  // Rule 7.5 — forced ticket re-draw: a player who has already connected every kept ticket by their
  // own track has no objective left, so their turn opens straight into a fresh ticket draw instead
  // of AWAIT_ACTION. Skipped (a normal turn) when the short ticket deck is exhausted — an impossible
  // draw can't be forced.
  if (allKeptTicketsOwnConnected(board, next, nextPlayer)) {
```

to:

```ts
  // Rule 7.5 — forced ticket re-draw: a player whose every kept ticket is already complete (own
  // track, or — under unlimitedStationBorrow — already locked via station-borrow completion) has
  // no objective left, so their turn opens straight into a fresh ticket draw instead of
  // AWAIT_ACTION. Skipped (a normal turn) when the short ticket deck is exhausted — an impossible
  // draw can't be forced.
  if (allKeptTicketsCompleted(board, next, nextPlayer)) {
```

- [ ] **Step 5: Run the forced-redraw tests to verify they pass**

Run: `yarn workspace @trm/engine test --run forcedTicketDraw`
Expected: PASS (5 tests — the 4 existing plus the new one).

- [ ] **Step 6: Bump `ENGINE_VERSION` and extend the version-history comment**

In `packages/engine/src/types/state.ts:129-135`, change:

```ts
export const SCHEMA_VERSION = 1;
// v4: two independent v3 bumps merged — main's `doubleRouteSingleFor23` ruleParam, plus rule 7.5
// forced ticket re-draw (a player with every kept ticket already own-connected is forced to draw
// new tickets at the start of their turn — the turn opens in TICKET_SELECTION, not AWAIT_ACTION).
// v5: random events — RuleParams.eventsMode + optional GameState.events; off-mode behavior
// identical to v4.
export const ENGINE_VERSION = 5;
```

to:

```ts
export const SCHEMA_VERSION = 1;
// v4: two independent v3 bumps merged — main's `doubleRouteSingleFor23` ruleParam, plus rule 7.5
// forced ticket re-draw (a player with every kept ticket already own-connected is forced to draw
// new tickets at the start of their turn — the turn opens in TICKET_SELECTION, not AWAIT_ACTION).
// v5: random events — RuleParams.eventsMode + optional GameState.events; off-mode behavior
// identical to v4.
// v6: rule 7.5 also forces a re-draw when every kept ticket is locked in `completedTickets` (the
// unlimitedStationBorrow variant's station-borrow completion), not just own-connected — closing a
// gap where a borrow-only completion never triggered the forced re-draw. Off-variant behavior
// (completedTickets always empty) is identical to v5.
export const ENGINE_VERSION = 6;
```

- [ ] **Step 7: Update the hardcoded version test**

In `packages/engine/test/variants-determinism.spec.ts:22-24`, change:

```ts
it('is engine version 5 (random events: eventsMode + optional GameState.events)', () => {
  expect(ENGINE_VERSION).toBe(5);
});
```

to:

```ts
it('is engine version 6 (rule 7.5 also counts unlimitedStationBorrow-locked completion)', () => {
  expect(ENGINE_VERSION).toBe(6);
});
```

- [ ] **Step 8: Run the full engine test suite**

Run: `yarn workspace @trm/engine test`
Expected: PASS — all suites green, including `variants-determinism.spec.ts` and
`off-mode-identity.spec.ts` (the off-mode golden fixture uses default `ruleParams`, i.e.
`unlimitedStationBorrow: false`, so `completedTickets` stays empty and the predicate change is a
no-op for that fixture).

- [ ] **Step 9: Commit**

```bash
git add packages/engine/src/tickets.ts packages/engine/src/turn.ts packages/engine/src/types/state.ts packages/engine/test/forcedTicketDraw.spec.ts packages/engine/test/variants-determinism.spec.ts
git commit -m "$(cat <<'EOF'
fix(engine): rule 7.5 also forces redraw on borrow-only ticket completion

allKeptTicketsOwnConnected only checked live own-track connectivity, so a
player who completed every kept ticket via unlimitedStationBorrow's
station-borrow (never own-connected) was never forced to redraw. Renamed to
allKeptTicketsCompleted and it now also consults the locked
completedTickets set. Bumps ENGINE_VERSION 5 -> 6 (behavior-changing).
EOF
)"
```

---

### Task 2: Server — narrow the replay-compatibility allowlist to engine v6 only

**Files:**

- Modify: `apps/server/src/history/history.repo.ts:42-49`
- Modify: `apps/server/test/history-replay-compat.spec.ts`

**Interfaces:**

- Consumes: `ENGINE_VERSION` is now `6` (Task 1).
- Produces: `REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] = [6]` (unchanged export name/type).

- [ ] **Step 1: Write the failing test**

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
  it('marks a v6-stamped game replayable and a v5-stamped game not (on a resolvable map)', async () => {
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
      { _id: 'g-v6', ...base, engineVersion: 6, completedAt: new Date(now - 1000) },
      { _id: 'g-v5', ...base, engineVersion: 5, completedAt: new Date(now - 2000) },
    ]);

    const rows = await t.app.get(HistoryRepo).listForUser(userId);
    const byId = new Map(rows.map((r) => [r.gameId, r]));
    // v6 is in the allowlist AND its map still builds → replayable.
    expect(byId.get('g-v6')?.replayable).toBe(true);
    // v5 predates the (narrowed) allowlist → not replayable, even though it used to be.
    expect(byId.get('g-v5')?.replayable).toBe(false);
  });

  it('allowlists only the current engine major — this fix is not provably inert for older majors', () => {
    expect(REPLAY_COMPATIBLE_ENGINE_VERSIONS).toEqual([6]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run history-replay-compat`
Expected: FAIL — `REPLAY_COMPATIBLE_ENGINE_VERSIONS` is still `[4, 5]`, so `g-v6` is marked
`replayable: false` (not in the list) and `g-v5` is marked `replayable: true` (still in the list);
the second test's `toEqual([6])` also fails.

- [ ] **Step 3: Narrow the allowlist in `history.repo.ts`**

In `apps/server/src/history/history.repo.ts:42-49`, change:

```ts
/**
 * Engine major versions whose persisted action logs the current server can still replay
 * byte-identically. v5 replays a v4 log identically: v5 only ADDS the `eventsMode`/`events`
 * genesis fields, and those are inert for a v4 game (an off/absent `eventsMode` draws zero extra
 * RNG at genesis, so the deck/tickets/digests are unchanged). Extend this list as new engine
 * versions land that preserve replay of older logs.
 */
export const REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] = [4, 5];
```

to:

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run history-replay-compat`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full server test suite**

Run: `yarn workspace @trm/server test`
Expected: PASS. Check specifically for any other spec asserting on `REPLAY_COMPATIBLE_ENGINE_VERSIONS`
or a hardcoded `engineVersion: 4`/`5` expecting `replayable: true` elsewhere — none are expected
(the grep during planning found only `history-replay-compat.spec.ts` and `spectators.spec.ts`, and
the latter only checks `hist?.engineVersion === ENGINE_VERSION`, i.e. self-consistency, unaffected
by this change), but confirm via the full run rather than assuming.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/history/history.repo.ts apps/server/test/history-replay-compat.spec.ts
git commit -m "$(cat <<'EOF'
fix(server): narrow replay-compat allowlist to engine v6 only

The v5->v6 rule-7.5 fix isn't provably inert for existing
unlimitedStationBorrow games (unlike the v4->v5 bump), so extending the
allowlist to [5, 6] could offer a replay that breaks mid-playback. Existing
v4/v5 match history now shows as not replayable.
EOF
)"
```

---

### Task 3: Frontend — notify the player when their turn opens into a forced ticket re-draw

**Files:**

- Modify: `apps/web/src/hooks/useAnimationDriver.ts`
- Modify: `apps/web/src/hooks/useAnimationDriver.test.tsx`
- Modify: `apps/web/src/i18n/index.ts:161-162,649-650`

**Interfaces:**

- Consumes: `pushNotification(cue: DistributiveOmit<NotificationCue, 'id'>)` from
  `apps/web/src/store/animations.ts` (existing); `useTranslation` from `react-i18next` (existing
  pattern elsewhere in the app).
- Produces: no new exports — this is purely additive behavior inside the existing
  `useAnimationDriver` hook.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `apps/web/src/hooks/useAnimationDriver.test.tsx`, inside the existing
`describe('useAnimationDriver', ...)` block (after the last `it`, before the closing `});`). First
add `import i18n from '../i18n';` to the top import list (alongside the existing imports):

```ts
  it('notifies me when my turn opens straight into a forced ticket re-draw', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, [])));
    const turnStarted: GameEvent = {
      event: { case: 'turnStarted', value: { playerId: 'p0', orderIndex: 0 } },
    } as GameEvent;
    const ticketsOffered: GameEvent = {
      event: { case: 'ticketsOffered', value: { playerId: 'p0', ticketIds: [T1] } },
    } as GameEvent;
    act(() => useGame.getState().applyEvents(2, [turnStarted, ticketsOffered]));
    const notifications = useAnimations.getState().notifications;
    expect(
      notifications.some((n) => n.variant === 'success' && n.text === i18n.t('forcedTicketRedraw')),
    ).toBe(true);
  });

  it('does not notify for a voluntary mid-turn ticket draw (no accompanying turnStarted)', () => {
    render(<Harness />);
    act(() => useGame.getState().applySnapshot(snap(1, [])));
    const ticketsOffered: GameEvent = {
      event: { case: 'ticketsOffered', value: { playerId: 'p0', ticketIds: [T1] } },
    } as GameEvent;
    act(() => useGame.getState().applyEvents(2, [ticketsOffered]));
    const notifications = useAnimations.getState().notifications;
    expect(notifications.some((n) => n.variant === 'success')).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run useAnimationDriver`
Expected: FAIL — the first new test fails because no notification is pushed yet (the second passes
trivially since nothing pushes a `'success'` notification at all yet, but keep it — it becomes a
real regression guard after Step 4).

- [ ] **Step 3: Add the i18n strings**

In `apps/web/src/i18n/index.ts`, in the `zh-Hant` block, change (around line 161-162):

```ts
      drawTickets: '抽任務卡',
      deckEmpty: '已抽完',
```

to:

```ts
      drawTickets: '抽任務卡',
      deckEmpty: '已抽完',
      forcedTicketRedraw: '任務全部達成，系統發給你新任務！',
```

In the `en` block, change (around line 649-650):

```ts
      drawTickets: 'Draw tickets',
      deckEmpty: 'Out of cards',
```

to:

```ts
      drawTickets: 'Draw tickets',
      deckEmpty: 'Out of cards',
      forcedTicketRedraw: 'All your tickets are complete — here are new ones!',
```

- [ ] **Step 4: Implement the detection + notification in `useAnimationDriver.ts`**

Add the import (after the existing `import { ticketById } from '../game/content';` line):

```ts
import { useTranslation } from 'react-i18next';
```

Add the `t` hook right after `const gameStore = useGameStoreApi();`:

```ts
const { t } = useTranslation();
```

In the event-batch effect, change:

```ts
  useEffect(() => {
    if (!lastBatch || lastBatch.seq === seenBatchSeq.current) return;
    seenBatchSeq.current = lastBatch.seq;
    const snap = gameStore.getState().snapshot;
    if (!snap) return;
    for (const intent of intentsFromEvents(snap, lastBatch.events)) pushIntent(intent);
```

to:

```ts
  useEffect(() => {
    if (!lastBatch || lastBatch.seq === seenBatchSeq.current) return;
    seenBatchSeq.current = lastBatch.seq;
    const snap = gameStore.getState().snapshot;
    if (!snap) return;
    const me = snap.you?.playerId;
    // Rule 7.5's forced re-draw opens straight into TICKET_SELECTION at turn start, emitting
    // TURN_STARTED + TICKETS_OFFERED together in the same batch — unlike a voluntary DRAW_TICKETS
    // click mid-turn, which only ever emits TICKETS_OFFERED alone. That pairing is the signal.
    const forcedRedraw =
      !!me &&
      lastBatch.events.some((e) => {
        const ev = e.event;
        return ev.case === 'turnStarted' && ev.value.playerId === me;
      }) &&
      lastBatch.events.some((e) => {
        const ev = e.event;
        return ev.case === 'ticketsOffered' && ev.value.playerId === me;
      });
    if (forcedRedraw) {
      pushNotification({ variant: 'success', text: t('forcedTicketRedraw') });
    }
    for (const intent of intentsFromEvents(snap, lastBatch.events)) pushIntent(intent);
```

And update the effect's dependency array from:

```ts
  }, [lastBatch, pushIntent, gameStore, showEventBanner, pushNotification]);
```

to:

```ts
  }, [lastBatch, pushIntent, gameStore, showEventBanner, pushNotification, t]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run useAnimationDriver`
Expected: PASS (9 tests — the 7 existing plus the 2 new ones).

- [ ] **Step 6: Run the full web test suite**

Run: `yarn workspace @trm/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useAnimationDriver.ts apps/web/src/hooks/useAnimationDriver.test.tsx apps/web/src/i18n/index.ts
git commit -m "$(cat <<'EOF'
feat(web): notify player when a turn opens into a forced ticket redraw

Detects the TURN_STARTED + TICKETS_OFFERED pairing that only occurs when
rule 7.5 forces a redraw at turn start, distinguishing it from a voluntary
DRAW_TICKETS click, and surfaces it via the existing notification chips.
EOF
)"
```

---

### Task 4: Full validation sweep

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole repo**

Run: `yarn typecheck`
Expected: PASS, no errors in `packages/engine`, `apps/server`, or `apps/web`.

- [ ] **Step 2: Lint the whole repo**

Run: `yarn lint`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `yarn test`
Expected: PASS across every workspace (`@trm/engine`, `@trm/server`, `@trm/web`, and any others in
the turbo graph).

- [ ] **Step 4: Fix anything the sweep surfaces**

If any step above fails, fix the issue in the relevant task's files, re-run the failing command,
and commit the fix with a message referencing which task it corrects (e.g. `fix(engine): ...`).
Do not proceed until `yarn typecheck`, `yarn lint`, and `yarn test` are all green.
