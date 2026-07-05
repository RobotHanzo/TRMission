# Action-log ticket completions + rainbow locomotive chip — design

**Date:** 2026-07-05
**Scope:** full-stack — `packages/engine`, `packages/proto`, `packages/codec`, `apps/server`,
`apps/web`.
**Depends on:** the existing action-log plumbing (`docs/superpowers/specs/2026-06-29-action-log-and-chat-design.md`)
and the engine's already-existing (currently-dropped) `TICKET_COMPLETED` event.

## Goal

Two independent fixes to the in-game action log (`LogPanel.tsx`):

1. **Log a line when a player completes a destination-ticket mission** (own routes join the
   ticket's two cities), for every player, in every game mode — not just under the
   `unlimitedStationBorrow` variant.
2. **Render a taken face-up locomotive card as the rainbow wash**, not its flat grey hex, matching
   the fix already applied to the card market.

## Part A — ticket-completion log line

### Problem

The engine already emits a `TICKET_COMPLETED` event (`packages/engine/src/reduce.ts`,
`lockCompletedTickets`), but it never reaches the client:

- `packages/codec/src/events.ts`'s `eventToProto` explicitly drops it (`return null`), reasoning
  that completion is "already conveyed authoritatively by the snapshot's `completed_tickets`
  list."
- `lockCompletedTickets` itself is a no-op unless `ruleParams.unlimitedStationBorrow` is on — in a
  **standard game**, no completion is ever locked into `PlayerState.completedTickets` or announced
  mid-game; `redactFor` only computes it on the fly for the snapshot's public `completedTickets`
  list (used today by the scoreboard and the ticket-completion fanfare animation, both driven by
  diffing that snapshot field).

So making this "properly" event-driven for all games — not just the borrow variant — requires
generalizing the engine's completion-locking, not just un-dropping the codec case.

### Engine (`packages/engine`)

**`packages/engine/src/reduce.ts` — generalize `lockCompletedTickets`.** Remove the
`if (!state.ruleParams.unlimitedStationBorrow) return { state, events: [] };` early return.
Instead, per player, compute the connected set using the check appropriate to the active variant:

```ts
const connected = state.ruleParams.unlimitedStationBorrow
  ? borrowConnectedTicketIds({ ownEdges, borrowEdges: stationBorrowEdges(board, next, pid), tickets })
  : ownConnectedTicketIds({ ownEdges, tickets });
```

Everything else in the function (diffing against `already`, locking `newIds` into
`completedTickets`, pushing `TICKET_COMPLETED`) is unchanged. This is safe:

- All four call sites (`applyKeepTickets`, `applyClaimRoute`, tunnel-commit, `applyBuildStation`)
  already invoke `lockCompletedTickets` after every action that can change connectivity or the
  kept-tickets set — no new call sites needed.
- End-game **scoring** (`scoring.ts` `evaluatePlayerTickets`) never reads
  `PlayerState.completedTickets` for the non-borrow branch — it re-derives completion independently
  from `state.ownership`/`state.stations` every time. So this change cannot affect final scores,
  only *when* the client learns about a completion.
- `tickets.ts`'s `allKeptTicketsCompleted` (rule 7.5) already checks
  `ownConnected.has(t.id) || completed.has(t.id)`; after this change `completed` becomes a superset
  of `ownConnected` for every variant, which is still correct (no regression), just now redundant
  in the common case — leave it as is, it's cheap and still correct.

### Versioning

Populating `completedTickets` earlier (and for games that previously left it permanently empty)
changes `GameState` at each step → changes `stateDigest`. Same class of change as the v5→v6 bump
already in this repo's history (`packages/engine/src/types/state.ts`). Bump `ENGINE_VERSION` 6 → 7
and extend the version-history comment:

```
// v7: TICKET_COMPLETED (and the completedTickets lock) now fires for own-track completion in
// EVERY game, not just unlimitedStationBorrow — closing the gap where a standard game's ticket
// completions were never locked/announced mid-game, only computed on demand for display. Off any
// variant, this only changes *when* completedTickets is populated (a game's final scoring is
// unaffected — evaluatePlayerTickets always re-derives completion independently).
export const ENGINE_VERSION = 7;
```

Per the same reasoning as the v6 bump, this is **not** provably inert for existing history (a
replayed v6 game would now diverge in mid-game state at exactly the points where a ticket
completes), so narrow `apps/server/src/history/history.repo.ts`'s
`REPLAY_COMPATIBLE_ENGINE_VERSIONS` to `[7]` only.

### Tests

- `packages/engine/test/instant-completion.spec.ts`: the existing case `'does not record
  completion in state when the variant is off'` must flip to assert the *opposite* — that
  `completedTickets` contains the ticket and `TICKET_COMPLETED` fires even with the variant off.
  Rename it to reflect the new behavior.
- `packages/engine/test/variants-determinism.spec.ts`: the existing case `'records no locked
  completion when the variant is off (default game)'` must be replaced with a monotonicity check
  mirroring the existing borrow-variant one (`'locked completion set equals a fresh end-game
  evaluation'`), but using `ownConnectedTicketIds` instead of `borrowConnectedTicketIds`. Update
  the `'is engine version N'` test to 7 with a comment describing this fix.
- `packages/engine/test/off-mode-identity.spec.ts`: regenerate `golden/off-mode.json` via the
  documented temp-script procedure already in that file's header comment (this is exactly the
  "deliberate, intentional off-mode behavior change" case it anticipates).
- Run the full engine suite (golden replays, property/invariant tests) to confirm nothing else
  assumes `completedTickets` stays empty off-variant.

### Wire protocol (`packages/proto`)

Add to `packages/proto/proto/trmission/v1/server.proto`:

```proto
message TicketCompleted {
  string player_id = 1;
  string ticket_id = 2;
}
```

and a new oneof case in `GameEvent`:

```proto
    TicketCompleted ticket_completed = 25;
```

(next field number after the existing 24). Regenerate (`yarn workspace @trm/proto generate`).

Bump `PROTOCOL_VERSION` 3 → 4 in `packages/proto/src/index.ts`, extending the version comment —
matching the precedent set when the four random-event oneof cases were added (that also warranted
a bump, per the existing v3 comment).

### Codec (`packages/codec/src/events.ts`)

Replace the drop:

```ts
case 'TICKET_COMPLETED':
  return wrap({
    case: 'ticketCompleted',
    value: { playerId: ev.player as string, ticketId: ev.ticket as string },
  });
```

The engine event is already `visibility: 'PUBLIC'` (finished tickets are public by design — see
`CompletedTicket`'s doc comment in `common.proto`), so no owner-gating is needed, consistent with
`ROUTE_CLAIMED`/`STATION_BUILT`.

No server (`apps/server`) code changes are otherwise needed: `GameSession.history()` re-derives the
full event stream by replaying `appliedActions` through the *current* engine on every call, so both
the live event broadcast and the `HistoryReplay` reconnect backfill pick up `TICKET_COMPLETED`
automatically once the engine emits it and the codec stops dropping it.

### Web (`apps/web`)

- **`game/logModel.ts`**: add `'ticketCompleted'` to `LogKind`, and a case in `entriesFromEvents`:

  ```ts
  case 'ticketCompleted':
    out.push({
      kind: 'ticketCompleted',
      playerId: ev.value.playerId,
      data: { ticketId: ev.value.ticketId },
      importance: 'highlight',
    });
    break;
  ```

- **`components/LogPanel.tsx`**: add a case to the `lineText` switch, resolving the ticket's
  cities/value via the existing `ticketLabel(id, locale)` helper (`game/content.ts`):

  ```ts
  case 'ticketCompleted': {
    const label = ticketLabel(String(e.data.ticketId), locale);
    return label
      ? t('log.ticketCompleted', { name, from: label.a, to: label.b, points: label.value })
      : '';
  }
  ```

  `importance: 'highlight'` puts it in the same visual tier as `routeClaimed`/`stationBuilt`.

- **i18n** (`apps/web/src/i18n/index.ts`), both locale blocks, near the other `log.*` keys:
  - zh-Hant: `ticketCompleted: '{{name}} 完成任務 {{from}}–{{to}}（+{{points}}）'`
  - en: `ticketCompleted: '{{name}} completed the {{from}}–{{to}} mission (+{{points}})'`

- **Tests**: extend `logModel.test.ts` (proto event → `LogDatum`) and `LogPanel.test.tsx` (renders
  the translated line) with a `ticketCompleted` case, following the existing `routeClaimed`
  pattern in each file.

This is purely additive to the log — the existing snapshot-diff-driven ticket-completion
**animation/fanfare** (`useAnimationDriver.ts`, `game/tickets.ts`) is untouched; it keeps working
exactly as it does today, independent of this new wire event.

## Part B — rainbow locomotive chip in the log

### Problem

`LogPanel.tsx`'s `tookFaceup` chip renders `CARD_COLOR_TOKENS[color].hex` directly. For every
colour this is correct, but for `LOCOMOTIVE` that hex is a flat grey (`#9AA0A6`,
`ROUTE_COLOR_HEX.LOCOMOTIVE` in `@trm/map-data`) — the wild card should read as "any colour," which
is exactly why `theme/colors.ts` already exports `LOCOMOTIVE_GRADIENT` (a 6-livery rainbow wash) and
`CardMarket.tsx` already uses it for the identical case (a face-up loco in the market).

### Fix

In `LogPanel.tsx`, mirror `CardMarket.tsx`'s pattern:

```ts
import { SEAT_COLORS, CARD_COLOR_TOKENS, LOCOMOTIVE_GRADIENT } from '../theme/colors';
...
{e.kind === 'tookFaceup' && color && (
  <span
    className="log-chip"
    style={{ background: color === 'LOCOMOTIVE' ? LOCOMOTIVE_GRADIENT : CARD_COLOR_TOKENS[color].hex }}
    title={CARD_COLOR_TOKENS[color].nameZh}
    aria-hidden
  />
)}
```

### Tests

Extend `LogPanel.test.tsx` with a case asserting a `tookFaceup` entry with `color: 'LOCOMOTIVE'`
renders the gradient background, not the flat hex.

## Out of scope

- The ticket-completion **animation/fanfare** and score-float — already implemented via snapshot
  diffing, unrelated to this log-line addition.
- Any change to how `snapshot.completedTickets` is computed or redacted — untouched.
- Simplifying `redactFor`'s dual-path `completedTickets` computation in `selectors.ts` now that the
  engine tracks it universally — both paths remain correct and independently derived; consolidating
  them is a follow-up cleanup, not required for this fix.
- Locomotive rendering anywhere other than the log chip (market, hand, etc. already use the
  gradient or are otherwise out of scope).
