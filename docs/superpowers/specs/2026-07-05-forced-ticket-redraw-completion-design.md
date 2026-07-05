# Forced ticket re-draw: fix completion check + explain it in the UI

## Problem

The engine already has a "rule 7.5" forced ticket re-draw: when a player's turn begins and every
kept destination ticket is already complete, their turn opens straight into `TICKET_SELECTION`
instead of `AWAIT_ACTION`, forcing them to draw a fresh offer. This lives in
`packages/engine/src/tickets.ts` (`allKeptTicketsOwnConnected`) and is invoked from
`packages/engine/src/turn.ts` (`endTurn`).

Two gaps:

1. **Engine.** The completion check only looks at live own-track connectivity
   (`ownConnectedTicketIds`). It ignores `PlayerState.completedTickets` — the locked completion
   list populated under the `unlimitedStationBorrow` room variant, where a ticket can complete via
   a borrowed opponent edge without ever being own-connected. A player who finishes every kept
   ticket that way is never forced to redraw.
2. **Frontend.** `apps/web` is entirely server-state-driven (see `apps/web/CLAUDE.md`) — the
   existing `TicketChooser` already renders automatically whenever phase flips to
   `TICKET_SELECTION`, so the forced draw already "works" mechanically once (1) is fixed. But
   nothing distinguishes this from a voluntary `DRAW_TICKETS` click, so a player whose turn opens
   unprompted into the ticket chooser has no idea why.

## Engine fix

`packages/engine/src/tickets.ts`: rename `allKeptTicketsOwnConnected` →
`allKeptTicketsCompleted`. A kept ticket counts as done if it is *either* own-connected right now
*or* already present in `player.completedTickets`:

```ts
export function allKeptTicketsCompleted(
  board: Board,
  state: GameState,
  player: PlayerId,
): boolean {
  const p = state.players[player as string];
  if (!p || p.keptTickets.length === 0) return false;

  // ... existing ownEdges / tickets construction (unchanged) ...

  const ownConnected = new Set(ownConnectedTicketIds({ ownEdges, tickets }));
  const completed = new Set(p.completedTickets as readonly string[]);
  return tickets.every((t) => ownConnected.has(t.id) || completed.has(t.id));
}
```

No branch on `ruleParams.unlimitedStationBorrow` is needed: when the variant is off,
`completedTickets` is permanently empty (per its own doc comment in `types/state.ts`), so the
check degrades exactly to today's behavior. When the variant is on, `completedTickets` is already
a superset of own-connected tickets (borrow-locking unions own edges into the same union-find), so
consulting it is strictly more correct — never a regression for the own-connected case.

`packages/engine/src/turn.ts:90`: update the call site to `allKeptTicketsCompleted` and adjust the
rule-7.5 comment to describe both completion paths, not just "own track."

### Versioning

This changes what state a replay produces for existing seeds — a game that previously played a
normal turn (all tickets borrow-completed, not own-connected, under the variant) will now force a
re-draw instead. That's a `stateDigest`-affecting behavior change, the same class of change as the
v4 bump already recorded in `packages/engine/src/types/state.ts`. Bump `ENGINE_VERSION` 5 → 6 and
extend the version-history comment to describe this fix. Existing golden fixtures are expected to
be unaffected (none currently exercise a borrow-only-complete-all-tickets scenario at a turn
boundary) but must still be re-run to confirm.

### Tests

`packages/engine/test/forcedTicketDraw.spec.ts` (or a new sibling file): add a case with
`unlimitedStationBorrow: true` where a player's only kept ticket is completed solely via a
station-borrowed opponent edge (not own track), asserting their next turn opens in
`TICKET_SELECTION`. Keep all existing own-connected-only cases as regression coverage that the
variant-off path is byte-identical to before.

## Frontend fix: explain the forced redraw

No change is needed for the ticket chooser to *appear* — `GameStage.tsx`'s `needKeep` already
derives from `phase === TICKET_SELECTION && pendingOfferTicketIds.length > 0`, which becomes true
automatically once the engine fix lands. The gap is purely explanatory: nothing currently tells the
player *why* their turn suddenly opened into the chooser instead of their normal options.

### Distinguishing signal

A forced redraw's turn-end sequencer (`endTurn` in `turn.ts`) emits `TURN_STARTED` for the
newly-active player and then, inline in the same call, `TICKETS_OFFERED` for that same player —
both land in the **same event batch**. A voluntary `DRAW_TICKETS` click mid-turn only ever produces
`TICKETS_OFFERED` alone (no accompanying `TURN_STARTED`, since the turn was already theirs). This
needs no wire/protocol change — both event cases already exist and are already delivered to the
owning client (`ticketsOffered` is private-to-owner, `turnStarted` is public).

### Implementation

`apps/web/src/hooks/useAnimationDriver.ts` already has a per-batch loop over `lastBatch.events`
that pushes notifications for other event cases (random-event banners, etc.). Extend it: if the
current batch contains both a `turnStarted` and a `ticketsOffered` event with `playerId === me`,
call:

```ts
pushNotification({ variant: 'success', text: t('forcedTicketRedraw') });
```

New i18n key in `apps/web/src/i18n/index.ts`, both locale blocks, near the existing
`completedTickets`/`drawTickets` strings:

- zh-Hant: `forcedTicketRedraw: '任務全部達成，系統發給你新任務！'`
- en: `forcedTicketRedraw: 'All your tickets are complete — here are new ones!'`

### Tests

Extend `useAnimationDriver`'s existing test file: feed a batch with `[turnStarted(me),
ticketsOffered(me)]` and assert the notification fires with the new text; feed a batch with only
`ticketsOffered(me)` (the voluntary-draw shape) and assert it does *not* fire.

## Out of scope

- Mid-turn forcing (completing your last ticket via `CLAIM_ROUTE` doesn't force anything until your
  *next* turn starts) — this matches the existing rule 7.5 design (`endTurn`-only) and is not part
  of this fix.
- Any new "all tickets done" game-end condition — completing tickets still only ever triggers a
  re-draw, never ends the game. Unrelated to this fix.
- Bot behavior — bots already handle `TICKET_SELECTION` via the same `KEEP_TICKETS` action
  regardless of how the offer was triggered; no bot-specific changes are needed.
