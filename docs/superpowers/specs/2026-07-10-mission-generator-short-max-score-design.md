# Mission generator: max score for short-range tickets

**Date:** 2026-07-10
**Status:** Approved (design) — pending spec review before planning

## Problem

The map builder's Missions stage has an "Auto Generate" modal
([`MissionsStage.tsx`](../../../apps/web/src/features/builder/editor/stages/MissionsStage.tsx),
`GenerateModal`) backed by `generateTickets()` in
[`packages/map-data/src/generate.ts`](../../../packages/map-data/src/generate.ts). It already exposes
`seed`, `longCount`, and `shortCount`, but a SHORT ticket's score is whatever the seeded weighted
sample happens to land on within the band between `shortMinDistance` (fixed at the function default,
not exposed in the UI) and `minLongDistance` (the smallest distance among the LONG picks). An author
tuning a custom map has no way to force SHORT tickets to stay low-value — e.g. to keep a clear point
gap between the two decks — without hand-editing every generated ticket after the fact.

## Scope

- **In:** `@trm/map-data`'s `generateTickets()` + `GenerateTicketsOptions`, and the builder's
  `GenerateModal` UI + i18n strings.
- **Out:** no `GameContent`/`hashContent` change — `GenerateTicketsOptions` is a builder-tool-only
  input to a one-shot generation function; its output is plain `TicketDef[]` (unchanged shape), so
  nothing new is authored onto content or crosses the wire. No engine/proto change.

## Design

### 1. `GenerateTicketsOptions` (`generate.ts:5-11`)

Add one new optional field:

```ts
export interface GenerateTicketsOptions {
  readonly seed: number;
  readonly longCount?: number;
  readonly shortCount?: number;
  readonly shortMinDistance?: number;
  readonly shortMaxValue?: number;   // NEW — undefined = unbounded (today's behavior)
}
```

`shortMaxValue` caps the ticket's **final score** (`value`, the same field shown in the UI's Value
column and used for scoring), not the raw graph distance. `value` is already computed as
`Math.max(2, distance + islandBonus)` (`valueOf`, `generate.ts:44-45`) — capping the raw distance
instead could let an island-adjacent ticket land one point over the cap, which would be confusing
since "max score" is what the field is named and displayed as.

### 2. Candidate filtering (`generate.ts:87-89`)

The SHORT candidate pool filter gains one more condition, reusing the existing `valueOf`:

```ts
const remaining = candidates.filter(
  (c) =>
    !usedPairs.has(pairKey(c.a, c.b)) &&
    c.d >= shortMinDistance &&
    c.d < minLongDistance &&
    (shortMaxValue === undefined || valueOf(c.d, c.a, c.b) <= shortMaxValue),
);
```

No other part of the algorithm changes: LONG selection, the weighted sampling loop, and ticket
construction are untouched. When `shortMaxValue` is `undefined` the filter is a no-op, so existing
callers (including any fixed-seed test asserting exact output) are unaffected — **unset reproduces
today's output byte-for-byte.**

### 3. Shortfall behavior

Same as today's `shortMinDistance`: if the (now smaller) candidate pool can't fill `shortCount`
picks, the sampling loop's `remaining.length > 0` guard (`generate.ts:95`) just stops early and
`generateTickets` returns fewer SHORT tickets than requested. It does not throw and does not need to
know *why* the pool ran dry — that distinction is surfaced in the UI (below).

### 4. UI (`MissionsStage.tsx`, `GenerateModal`)

- New state: `const [shortMaxValue, setShortMaxValue] = useState('');` (blank string = unbounded).
- A new number input (`min={2}`, placeholder = "no limit") next to the existing `shortCount` field.
  No need for `RulesStage`'s deferred-commit `RuleInput` pattern — this modal only reads its fields
  when the user clicks "Preview"/"Reroll" (`run()`), not on every keystroke, so a plain controlled
  string input is sufficient.
- In `run()`, parse the field: blank → `undefined`; otherwise `Math.max(2, Math.round(Number(...)))`,
  falling back to `undefined` if not finite. Pass as `shortMaxValue` to `generateTickets`.
- **Shortfall message**, derived at render (no extra state): when a cap was set for the last run and
  `preview`'s SHORT-deck count is below the requested `shortCount`, show a message reusing the
  existing `.error` paragraph style already used for the connectivity-failure message. It does not
  disable "Apply" — generation still succeeded, just with fewer SHORT tickets than asked for.

```
short generated = preview.filter(tk => tk.deck === 'SHORT').length
show warning when: shortMaxValue is set AND preview !== null AND short generated < shortCount
```

### 5. i18n (`apps/web/src/i18n/index.ts`, zh-Hant + en)

New keys: `builder.shortMaxValue` (label), `builder.noLimit` (placeholder), and
`builder.shortMaxValueShortfall` (warning, interpolating generated count `n` and requested count
`count`).

## Testing

- **map-data** (`packages/map-data`, extending the existing generator test file): a cap excludes
  over-value candidates from the SHORT deck; leaving the field unset reproduces a fixed seed's
  existing output unchanged; a cap tight enough to starve the candidate pool yields fewer than
  `shortCount` SHORT tickets without throwing.
- **web**: none planned beyond the existing typecheck/lint coverage — `GenerateModal` has no existing
  test file and this change doesn't warrant introducing one on its own (consistent with the rest of
  the modal's untested numeric fields).

## Build order (for the plan)

1. `@trm/map-data`: add `shortMaxValue` to the type, filter, and tests.
2. `apps/web`: `GenerateModal` field + parsing + shortfall message; i18n strings.
3. `yarn typecheck` / `lint` / `test` / `format:check` green.

## Non-goals / rejected alternatives

- **Post-filtering in the UI only** (leave `generateTickets` untouched, drop over-cap tickets from
  the preview client-side) — rejected: breaks the "same seed ⇒ identical output" determinism contract
  documented on `generateTickets`, and the constraint wouldn't be reusable by any other caller of
  `@trm/map-data`.
- **Post-filter-and-resample inside the generator** (keep today's sampling, discard/retry over-cap
  picks) — rejected: same end result as filtering the candidate pool upfront, but needs an added
  retry loop for no benefit.
- **Also exposing `shortMinDistance` in the UI** — out of scope; the user asked specifically for a
  max-score field. `shortMinDistance` stays at its function default, unchanged from today.
