# Deadlock end-sequence + Pass button — design

- **Date:** 2026-07-12
- **Status:** Approved-pending-spec-review
- **Areas:** `@trm/engine`, `@trm/proto`, `@trm/codec`, `apps/server` (codec), `apps/web`

## Problem

The game can reach a state that never resolves cleanly:

- **The train-card pool is dead** — the draw deck and discard are both empty and the face-up market
  holds no takeable card (every card is hoarded in players' hands), so no draw can ever change a
  hand again.
- **No player can make board progress** — nobody can afford any open route, and nobody can build a
  station.

In that state:

1. The normal endgame trigger (`trainCars <= endgameTrainThreshold`, [turn.ts](../../../packages/engine/src/turn.ts))
   never fires, because no one can spend trains.
2. The all-PASS termination is **blocked**: `hasAnyLegalMove` returns `true` whenever the short
   ticket deck is non-empty ([reduce.ts](../../../packages/engine/src/reduce.ts) — the
   `state.ticketDeckShort.length > 0` clause). So `PASS` stays illegal (A15 only permits `PASS` when
   no other move exists) and every stuck player is **forced to draw destination tickets they can
   never complete**, one per turn, until the ticket deck drains. This drags the game out and tanks
   final scores with unfinished-ticket penalties.
3. The web has **no Pass control** at all ([GameStage.tsx](../../../apps/web/src/screens/GameStage.tsx)),
   so even once `PASS` is a legal move, a stuck **human** cannot end their turn — the game freezes
   for them.

## Goals

1. When the pool is dead and no player can build a railway, **begin the end sequence** (final round)
   with a distinct notification, and let each stuck player's turn resolve as a skip/pass with a
   "no possible moves" notice, so the game concludes promptly with correct scores.
2. Add a **Pass / Skip button** to the web, visible **only** when the current player has no legal
   moves, so a stuck human can end their turn.

## Non-goals

- Changing normal play in any way when a productive move (claim / build / draw / event action) still
  exists. Off-path games must stay byte-identical.
- Eliminating the (essentially unreachable) transient "pool dead but another player can still claim a
  route" window — claiming spends cards into the discard, which revives the pool, so this state does
  not persist. Only the true terminal deadlock is addressed.
- A separate `PLAYER_SKIPPED` wire event (decided against — see below).

## Decisions (confirmed with the requester)

- **End behavior:** _Final round + skips._ Begin the normal end-sequence (endgame countdown) on
  deadlock; stuck players' turns resolve as passes; a player who can still build a station gets a
  real final turn.
- **Stuck human's turn:** _Always the button._ A stuck human always clicks the Pass/Skip button to
  end their turn (even during the end sequence). Bots pass automatically (the driver picks the sole
  legal move). No engine-level auto-skip of humans.
- **Skip notification:** _Reuse `PLAYER_PASSED`._ A `PASS` is only ever legal when the player has no
  other move, so `PLAYER_PASSED` already means "was stuck"; the web renders it as
  "skipped — no possible moves". No new wire event.
- **End-sequence banner:** _Distinct deadlock banner._ Add `reason` to `ENDGAME_TRIGGERED`
  (`FINAL_TRAINS` | `DEADLOCK`) so the final-round banner can read "no more routes can be built".

## Design

### 1. Engine (`packages/engine`) — a rule change (ENGINE_VERSION 8 → 9)

**Stop forcing futile ticket draws.** Introduce a small predicate layer used consistently by the
reducer, the legal-move check, and the turn sequencer:

- `poolDead(state)` — no drawable card anywhere: `deck` empty, `discard` empty, and no market slot
  holds a card takeable as a draw (mirrors the existing `hasSecondDrawAvailable` / market-loco
  rules).
- Rework `hasAnyLegalMove` so the standalone "draw tickets" clause no longer, by itself, keeps it
  `true`. Concretely: `hasAnyLegalMove` becomes "has any **productive** move" — claim a route, build
  a station, draw a card, or take an event action (repair / night-market swap / hive / pending
  resolutions). When none of those exist (which implies `poolDead`, since "draw a card" is one of
  them), it returns `false` and `PASS` becomes legal.
- Mirror this in `applyDrawTickets`: reject a `DRAW_TICKETS` action when the player has no productive
  move (so `legalActions` — which filters candidates through `reduce` — stops offering it), leaving
  `legalActions == [PASS]`. **A15 stays exactly intact**: `PASS` is the _sole_ legal move, not one of
  two. This preserves the highest-risk engine invariant — `events-property.spec`'s
  `hasPass ⟺ !hasAnyLegalMove` biconditional — because `hasAnyLegalMove` (false when stuck) and
  candidate generation (offers only `PASS`) move together.
- Guard the **rule-7.5 forced ticket re-draw** in `endTurn`: only force the re-draw when the player
  still has a productive move; otherwise fall through to the stuck (`PASS`-only) turn.

**Begin the end sequence.** In `endTurn`, extend the endgame-trigger condition: also set
`endgame.triggered` (with `finalTurnsRemaining = n`) when `poolDead(state)` **and no player can claim
any route** (a full players×routes affordability scan, run only while `poolDead`, i.e. rarely). Emit
`ENDGAME_TRIGGERED` with `reason: 'DEADLOCK'` (the existing trains-threshold path keeps
`reason: 'FINAL_TRAINS'`). The existing all-PASS / final-round machinery then ends the game after a
full round of passes.

**Consequences that fall out for free:**

- A stuck **bot** now has `legalActions == [PASS]`, so `chooseBotAction` returns `PASS` (its
  `legal.length === 1` fast path) — bots "auto-skip" through the normal driver, no special-casing.
- A player who can still build a **station** is _not_ stuck (station build is a productive move), so
  they take a real final turn; only players with no productive move pass.

**Versioning.** Bump `ENGINE_VERSION` 8 → 9 with a comment. Off-path identity holds: nothing changes
until a dead pool with no productive move (previously forced a ticket draw, now resolves as `PASS`);
no RNG is consumed by the new checks, so card/train conservation and `stateDigest(replay)` invariants
are unaffected. Golden fixtures that happen to reach a dead-pool deadlock are updated.

Touchpoints: `reduce.ts` (predicates, `hasAnyLegalMove`, `applyDrawTickets`), `turn.ts` (endgame
trigger + rule-7.5 guard), `types/events.ts` (`ENDGAME_TRIGGERED.reason`), `types/state.ts`
(`ENGINE_VERSION` + comment).

### 2. Projection + wire

- Add **`youMustPass`** to `RedactedView` (`types/view.ts`), computed in `redactFor`
  (`selectors.ts`): `phase === 'AWAIT_ACTION' && viewer !== null && viewer === currentPlayer &&
!hasAnyLegalMove(board, state, viewer)`. The client cannot compute this from a redacted snapshot,
  so the server surfaces it. It is inherently per-viewer, so it rides the **`SelfView`** block (a new
  `bool you_must_pass` in `common.proto`), which is already absent for spectators.
- Add `reason` to the `EndgameTriggered` proto message (`server.proto`) — a small enum
  (`FINAL_TRAINS` = 0 default, `DEADLOCK` = 1) so existing games decode unchanged.
- Regenerate `@trm/proto`. Map both in `@trm/codec`: `snapshot.ts` (`youMustPass` → `SelfView`) and
  `events.ts` (`reason` on the endgame event). Keep the engine-event / proto / codec mapping 1:1.

### 3. Web (`apps/web`)

- **Pass / Skip button** in `GameStage`, rendered **only** when `snapshot.you?.youMustPass` is true
  (my turn, `AWAIT_ACTION`, no legal moves); it calls `commands.pass()`. It sits with the other
  turn actions and is hidden in every other state (including for spectators, who have no `you`).
- **Notifications** (the log model already handles both event kinds —
  [logModel.ts](../../../apps/web/src/game/logModel.ts)):
  - `passed` (from `PLAYER_PASSED`): update copy to "{player} — skipped (no possible moves)".
  - `endgame` (from `ENDGAME_TRIGGERED`): thread the new `reason` into `data`; render a distinct
    "Final round — no more routes can be built" line/banner when `reason === 'DEADLOCK'`, else the
    existing wording.
- i18n: add/adjust the zh-Hant (primary) + en strings for the two messages above.

## Testing

- **Engine (new spec):** construct a dead-pool, no-productive-move state and assert:
  the deadlock trigger fires `ENDGAME_TRIGGERED { reason: 'DEADLOCK' }`; each stuck player's only
  legal action is `PASS`; a full round of passes ends the game (`GAME_OVER`) with scores computed;
  a player who can still build a station gets a real turn (not forced to pass); `DRAW_TICKETS` is
  rejected while stuck; the rule-7.5 forced re-draw does not fire while stuck.
- **Determinism/off-path:** an off-path game's digest/behavior is unchanged; a game replays
  byte-identically across the new action sequence; `ENGINE_VERSION` bumped; existing golden fixtures
  updated where they reach the deadlock.
- **Codec:** round-trip `youMustPass` (on `SelfView`) and `EndgameTriggered.reason`.
- **Web:** the Pass button shows only when `youMustPass`, is hidden otherwise, and dispatches
  `pass()`; the log renders the "skipped" and deadlock-endgame notices.

## Edge cases

- **Pool dead but another player can still claim a route:** the end-sequence trigger waits (no
  route claimable by anyone is required). A locally-stuck player still resolves via `PASS`
  (button/bot). In practice this window barely exists: claiming spends cards into the discard, which
  makes the pool non-dead again.
- **Events mode:** an event action (repair with a permit, a pending relocation, etc.) counts as a
  productive move, so a player with one available is not treated as stuck.
- **Endgame already triggered by trains ≤ threshold:** the deadlock trigger is a no-op (already
  triggered); stuck players simply pass through the remaining final round.

## Out of scope

- A distinct `PLAYER_SKIPPED` wire event (reusing `PLAYER_PASSED` per decision).
- Any change to bot heuristics beyond the `legalActions == [PASS]` fast path already in place.
