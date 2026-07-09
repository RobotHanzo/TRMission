# Triple rails + fix the "4 rails" map-builder bug

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Problem

Two reported symptoms, one root cause:

1. **Bug — "4 rails built."** In the map builder, building a double (or converting a route to a
   double) on a city pair that **already has a double** creates a *second* `doubleGroup` on the same
   pair. Confirmed by reproduction: a pair that already had group `A` (`r1`,`r2`) plus a new "make
   double" produced group `B` (two more routes). `computeRouteOffsetsFor` offsets each group
   independently and centered on the chord, so both pairs land on the **same** offsets
   (`-1.35 / +1.35`) — four route objects stacked into two visually-overlapping tracks. Broken.

2. **Feature — triple rails.** Authors want three parallel tracks between a city pair. Today the
   model is hardcoded to *exactly two*: `validateContent` rejects any `doubleGroup` whose member
   count ≠ 2, and the engine's `doubleSibling` map is built **only** for 2-member groups, so a
   3-member group would get no double-route rules at all.

Both come from the same hardcoded assumption: **a parallel group is exactly a pair.** The fix
generalizes it to **a parallel group of 2 *or* 3 routes, one group per city pair, capped at 3.**

Evidence this is live: the in-progress (uncommitted) Taiwan **v4** map already contains a
half-formed triple — `taipei–banqiao` has `R1` (ORANGE, len 1, ungrouped) + `R2`/`R70` (GREEN/GRAY,
len 1, group `H`), i.e. an author trying to make a triple and getting a double plus a stray single.

## Decisions (settled with the user)

1. **Max parallelism = 3.** A city pair may have 1 (ungrouped), 2 (double), or 3 (triple) parallel
   tracks. Never 4+.
2. **Usable-track scaling rule.** Reuse the **existing** `doubleRouteSingleFor23` setting (kept by
   name — it is wired through lobby/admin/proto/persistence and must not be renamed). Number of
   claimable tracks in a group:

   ```
   openTracks(groupSize, playerCount, singleFor23) =
     singleFor23 ? min(groupSize, max(1, playerCount - 2)) : groupSize
   ```

   | group  | 2p | 3p | 4p | 5p | setting off |
   |--------|----|----|----|----|-------------|
   | double | 1  | 1  | 2  | 2  | 2           |
   | triple | 1  | 1  | 2  | 3  | 3           |

   This is **exactly backward-compatible** for doubles (the double column matches today's
   `SINGLE_ONLY`/`BOTH` behavior), so existing golden replays are unchanged. Triples get the
   author-requested behavior: full 3 only at 5p, 2 at 4p, 1 at 2–3p (all by default; the setting off
   opens every track).
3. **Builder UX = a "Parallel tracks [1] [2] [3]" segmented control** on the route inspector (and
   the new-route form), replacing the "Convert to double" button and the "make double" switch. It
   operates on *the pair's single group*, so a second overlapping group can never be authored.
4. **v4 content: mechanism only.** Do **not** edit the uncommitted v4 authored content
   (`routes.ts`) or its pinned hash (`versions.spec.ts`) — those belong to the parallel v4-migration
   session. Validation stays backward-compatible so `content.spec` remains green (see §6); the author
   can later regroup `taipei-banqiao`'s `R1` into a proper triple with the new control.

## Model (no wire/hash-format churn)

The `RouteDef.doubleGroup` field (`'A'`–`'J'`) is **unchanged in name and type**; it now identifies
a group of **2 or 3** routes between one city pair. Because the field and its JSON shape are
identical, `hashContent`, the proto/codec wire types, persisted games, and the content registry are
all untouched. The conceptual rename ("double pair" → "parallel group") is documentation-only.

**Invariant enforced by builder + validation:** for any city pair there is at most **one**
`doubleGroup` and at most **3** routes total.

## 1. Rendering — no change

`computeRouteOffsetsFor` (`packages/map-data/src/geometry.ts:121`) already sorts a group's members
and spreads them `(i − (n−1)/2) · 2 · DOUBLE_GAP`, so a 3-member group renders as three evenly
spaced parallel tracks (`-1.35, 0, +1.35`) with **zero** code change. The overlapping-stack bug
disappears once the one-group-per-pair invariant holds. No test change beyond a new assertion (§7).

## 2. Engine

### 2a. `board.ts` — group membership (generalize `doubleSibling`)

- Replace the pairwise `doubleSibling: Map<routeId, routeId>` with
  `parallelGroup: Map<routeId, readonly RouteId[]>` mapping a route id → the ids of the **other**
  members of its group, built for groups of size **2 or 3** (was: only size 2).
- `siblingOf(board, id): RouteId | undefined` is retained as a thin helper returning the first other
  member (used by two event-effect tests that operate on doubles); add
  `groupMembersOf(board, id): readonly RouteId[]` returning all other members, and
  `groupSizeOf(board, id): number`. Export the new helpers from `index.ts` alongside `siblingOf`.

### 2b. `config.ts` — the scaling helper

- Replace `DoubleRouteVariant` / `variantForPlayerCount` with
  `openTrackCount(groupSize: number, playerCount: number, singleFor23: boolean): number`
  implementing the §Decision-2 formula. These symbols are engine-internal (only `reduce.ts` + engine
  tests import them), so no other package is affected. Keep `variantForPlayerCount` as a deprecated
  re-export only if a test still needs it; otherwise delete and update the tests.

### 2c. `reduce.ts` — claim guard + lock

- **Claim guard** (`validateClaim`, ~line 383): reject the claim if the player already owns **any**
  other member of the route's group (was: the single sibling). Violation code stays
  `DOUBLE_ROUTE_OWN_BOTH` (wire-visible; keep the name; message reworded to "cannot own two tracks of
  a parallel route").
- **Lock on claim** (`applyClaimEffects`, ~line 408): after setting ownership, compute
  `K = openTrackCount(groupSize, state.turnOrder.length, state.ruleParams.doubleRouteSingleFor23)`.
  Count the group's now-owned members; if that count `>= K`, lock **every** still-unowned member
  (`setOwnership(..., { locked: true })` + one `DOUBLE_ROUTE_LOCKED` event per newly-locked route).
  For a double this reduces exactly to today's "lock the one sibling at K=1."
- **`legalActions` availability scan** (~line 875): a route is unclaimable if the player owns any
  other group member (else the lock already covers it). Generalize the existing sibling check.

### 2d. `invariants.ts` — ownership exclusivity

- Generalize "no player owns both edges of a double pair" (~line 58) to "no player owns two members
  of a parallel group," iterating `parallelGroup` members.

### 2e. Event effects (`events/effects.ts`, typhoon/charter)

- `takeReopenBonus` and the double-route-aware event tests operate on "the sibling." For doubles this
  is unchanged. Triples + those events are an untested corner; keep the pairwise `siblingOf` behavior
  there (correct for doubles, and no bundled/triple content exercises typhoon-on-a-triple). Note in
  the plan as explicitly out of scope for new tests.

## 3. Builder store (`apps/web/src/features/builder/editor/store.ts`)

- **Remove** `convertToDouble`. **Add** `setPairTrackCount(routeId: string, count: 1 | 2 | 3): void`:
  1. Resolve the pair = the target route's `{a,b}`. Collect **all** routes on that pair
     (`pairRoutes`), preserving order, with the target first.
  2. Clamp `count` to `1..3`.
  3. **Normalize into one group.** Choose the group letter: reuse the pair's existing letter if any,
     else `nextDoubleGroupLetter(existing groups in draft)`.
  4. Produce the target `count` routes on the pair: keep the first `min(count, pairRoutes.length)`
     existing ones (so ids/colors/bows are preserved), mint new siblings for any shortfall (fresh
     `newRouteId()`, same `a`/`b`/`length`, `isTunnel`/`ferryLocos` mirrored from the target,
     alternating color via the existing RED↔BLUE heuristic / GRAY-preserving for ferries). Drop any
     surplus existing routes beyond `count`.
  5. If `count === 1`: strip `doubleGroup` from the survivor and remove the rest. If `count >= 2`:
     stamp the chosen letter on all `count` routes and force equal `length` (= target's length).
  6. One `mutate()` call → one undo step. This **normalizes** any pre-existing messy pair (two
     groups, or group+ungrouped) into a single clean group of `count`.
- **New-route flow.** `addRoute` on a pair that already has route(s) must not create an overlapping
  ungrouped route. The `RoutesStage` submit handler routes a new connection through the group logic:
  if the pair is new, create `count` fresh routes as one group (count from the form's selector);
  if the pair already exists, call `setPairTrackCount(existingRouteId, min(3, desiredCount))`.
- `nextDoubleGroupLetter` / `newRouteId` stay exported (still used).

## 4. Builder UI (`apps/web/src/features/builder/editor/stages/RoutesStage.tsx`)

- **Inspector (edit-existing-route).** Replace the `convertToDouble` button in `extra` with a
  `Segmented` **Parallel tracks** control, options `1 / 2 / 3`, value = current pair track count
  (`pairRoutes.length`, clamped 1–3), `onChange = (n) => setPairTrackCount(selectedRoute.id, n)`.
  Keep the Delete button below it. (Delete of one member still frees the rest via `removeRoute`'s
  existing cascade; for a triple, deleting one member leaves a 2-member group — still valid.)
- **New-route form (`draftPair`).** Replace the "make double" `Switch` with the same
  `Parallel tracks [1][2][3]` `Segmented`; default `1`. On submit, create that many tracks as one
  group (via the store per §3).
- The convert/ make-double i18n keys are replaced by a `builder.parallelTracks` label (+ the three
  numeric options are just numbers). Remove `builder.convertToDouble` / `builder.makeDouble` usage
  (keep or drop the keys per lint).

## 5. Validation (`packages/map-data/src/validate.ts`)

- **Group size.** Change the `doubleGroupWrongCount` check (member count ≠ 2) to: member count must
  be **2 or 3**; reject size 1 or ≥ 4. New/renamed issue code `doubleGroupInvalidSize`
  (params `{group, count}`; keep a clear English rendering). Keep `doubleGroupDifferentPairs` and
  `doubleGroupLengthMismatch` unchanged (they already iterate all members via `m0`/rest — extend the
  pair/length comparison to all members of the group, not just the first two).
- **Per-pair cap (new).** For each city pair: at most **3** routes (`tooManyParallelRoutes`,
  params `{pair, count}`) and at most **1** distinct `doubleGroup` (`multipleGroupsOnPair`,
  params `{pair, groups}`). This is the direct guard against the reported 4-rail bug (two groups on a
  pair) and against 4+ tracks. It is deliberately **not** "≥2 routes must all be grouped," so the
  existing v4 `taipei-banqiao` (one group `H` + one ungrouped, 3 total) still validates and
  `content.spec` stays green.
- `formatIssue` gains English strings for the new/renamed codes. **Keep** `ContentStats.doublePairCount`
  as-is — it already counts *distinct groups* regardless of size, so no math or name change is needed
  (avoids churn in any stats consumer).

## 6. i18n

- Add `builder.parallelTracks` (zh-Hant: `平行軌道` / en: `Parallel tracks`). Retire
  `builder.convertToDouble` and `builder.makeDouble` references.

## 7. Testing

- **`store.test.ts`:** `setPairTrackCount` — 1→2 mints a sibling as one group; 2→3 mints a third,
  all sharing one letter + equal length + alternating colors; 3→2 and 2→1 drop members and 1 strips
  the group; picks the next free letter; single undo reverts; **normalizing a messy pair**
  (pre-seed two groups on one pair, or group+ungrouped) collapses to one clean group. Ferry/tunnel
  mirroring preserved.
- **`RoutesStage.test.tsx`:** the segmented control shows the pair's current count; changing it calls
  `setPairTrackCount`; the new-route form's selector creates N grouped tracks; building on a pair
  that already has a group extends (never stacks a second group).
- **`validate` tests (`map-data`):** a 3-member group is valid; a 4-member group and two groups on
  one pair are rejected with the new codes; a size-1 group rejected; equal-length across 3 enforced.
- **Engine `rules.spec` / new `triple.spec`:** `openTrackCount` table (2p/3p/4p/5p × double/triple ×
  setting on/off); claiming triples locks the correct remaining members at each player count; a
  player cannot own two tracks of a triple; **golden replays unchanged** (assert existing double
  goldens still pass — same digests).
- **Rendering:** `geometry.spec` / `routeGeometry.test` — a 3-member group yields three offsets
  `-1.35, 0, +1.35` (evenly spaced, distinct).

## Out of scope

- Editing v4 authored content or its pinned hash (per Decision 4).
- Groups larger than 3.
- Typhoon/charter/event interactions *specifically with triples* (pairwise behavior retained; no new
  tests) — see §2e.
- Renaming the `doubleGroup` field or the `doubleRouteSingleFor23` setting.
- Converting two ungrouped overlapping routes on a pair (a milder, separate pre-existing case) — the
  builder prevents creating it going forward, but validation does not hard-fail it.
