# Map builder: "Convert to double" button on the Routes stage

**Date:** 2026-07-05
**Status:** Approved

## Goal

Today a custom-map author can only make a route a double-track pair **at creation time**, via the
"make this a double route" switch shown when connecting two stops for the first time
(`RoutesStage.tsx`'s `draftPair` branch). To turn an already-existing single route into a double
pair, the only path is delete it and re-draw it from scratch with the switch on. Add a button to
the edit-existing-route panel that converts a selected single route into a double pair in place.

## Decisions (settled with the user)

1. **Eligibility — plain routes only.** The button is shown only when the selected route has no
   `doubleGroup` yet, `isTunnel` is false, and `ferryLocos` is 0. This matches the bundled Taiwan
   map's authored convention (`packages/map-data/src/routes.ts`'s `D-` flag parsing forces
   `ferryLocos: 0, isTunnel: false`) — doubles are never tunnels or ferries. `validateContent`
   doesn't structurally forbid the combination, but the builder shouldn't offer it.
2. **Sibling color — auto-alternate.** The new twin route's color is picked with the same
   heuristic the create-flow already uses (`color === 'RED' ? 'BLUE' : 'RED'`), so the pair reads
   as visually distinct immediately. The user can still edit either route's color afterward.
3. **Single click, no extra Save step.** Clicking the button performs the conversion immediately,
   consistent with the existing Delete button in the same panel.

## 1. Store — new atomic `convertToDouble` action (`editor/store.ts`)

- New method on `EditorState`: `convertToDouble(id: string): void`.
- Behavior, in one `mutate()` call (one undo step):
  1. Look up the target route; no-op if missing or already ineligible (defensive — the UI already
     gates this, but the store shouldn't trust the caller).
  2. Pick the next free double-group letter via a shared helper (see below).
  3. Build the sibling: fresh `id` (reuse `RoutesStage`'s `newRouteId()` — see note below), same
     `a`/`b`/`length`/`isTunnel`/`ferryLocos`, `doubleGroup` = the picked letter, `color` =
     alternate of the target's color.
  4. Produce the new `routes` array: the target patched with `doubleGroup`, plus the sibling
     appended.
- **Why one store method instead of `updateRoute` + `addRoute`:** those are two separate `mutate()`
  calls → two undo-stack entries. A user who hits undo after converting would only see the sibling
  disappear, leaving the original still flagged as double with a dangling group — an inconsistent
  state that also fails `validateContent`'s `doubleGroupWrongCount`. A single atomic mutation keeps
  undo correct, matching how `setRouteBow` and `removeRoute`'s cascade already treat double-pair
  edits as one operation.

### Shared "next free letter" helper

`RouteForm` (inside `RoutesStage.tsx`) currently computes the next free `A`–`J` double-group letter
inline, scanning `existingDoubleGroups` passed down as a prop. `convertToDouble` needs the same
logic but computed against the live store draft, not a prop. Move the scan into a small exported
helper in `editor/store.ts` (e.g. `nextDoubleGroupLetter(routes: RouteDraft[]): string`) and use it
from both `convertToDouble` and `RouteForm`'s submit handler, so the "pick next free letter" rule
has one implementation instead of two.

### Route id generation

`newRouteId()` is currently a module-local counter in `RoutesStage.tsx`, not exported. Export it (or
move it next to the new store logic) so `store.ts` can mint the sibling's id without duplicating the
id-generation scheme.

## 2. UI — `RoutesStage.tsx`

- In the `selectedRoute` branch of the inspector (the edit-existing-route form), extend the existing
  `extra` node already passed to `RouteForm` (today it only holds the Delete button) to conditionally
  include the new button first, gated on:
  ```
  !selectedRoute.doubleGroup && !selectedRoute.isTunnel && selectedRoute.ferryLocos === 0
  ```
  No new prop on `RouteForm` — `extra` already exists exactly for panel-level actions like this.
- Button label: new i18n key `builder.convertToDouble`. Clicking calls
  `convertToDouble(selectedRoute.id)`. Selection stays on the same route id; since it now carries a
  `doubleGroup`, the button disappears on re-render (already-double routes aren't offered the
  button again) and the form reflects its new paired state the same way any other double route
  does today.
- Rendered above the Delete button (both are immediate, no-confirmation actions in this panel
  already).

## 3. i18n

Add alongside the existing `makeDouble`/`deleteRoute` keys:

- zh-Hant: `convertToDouble: '轉換為雙軌路線'`
- en: `convertToDouble: 'Convert to double route'`

## 4. No changes needed elsewhere

- `@trm/map-data` validation (`validateContent`'s `doubleGroupWrongCount` /
  `doubleGroupDifferentPairs` / `doubleGroupLengthMismatch`) already covers any two routes sharing a
  `doubleGroup`, regardless of how they were authored — the converted pair passes the same checks a
  pair created via the existing switch would.
- `geometry.ts`'s `computeRouteOffsetsFor` already renders any two same-`doubleGroup` routes as a
  parallel pair (equal-and-opposite gap) — no rendering changes needed.
- No server/wire/schema changes — `convertToDouble` only produces `RouteDraft`s shaped exactly like
  ones the existing create-flow already produces and round-trips today.

## 5. Testing

- **`store.test.ts`:** new case(s) for `convertToDouble` — target route gains the picked
  `doubleGroup`; a sibling is appended with matching `a`/`b`/`length`/`isTunnel`/`ferryLocos`, the
  alternate color, and the same `doubleGroup`; the picked letter is the first free one when other
  groups already exist; a single `undo()` call fully reverts both routes to the prior single-route
  state (one undo entry, not two).
- **`RoutesStage.test.tsx`** (new file, following `StopsStage.test.tsx`'s pattern of mocking
  `EditorCanvas` with plain buttons so `onRouteClick`/`onCityClick` fire without SVG/jsdom
  limitations): selecting a plain route shows the button; selecting a tunnel, a ferry, or an
  already-double route does not; clicking the button calls `convertToDouble` with the selected
  route's id and the form reflects the resulting double state.

## Out of scope

- Converting a double pair back down to a single route (deleting one half already frees the other's
  `doubleGroup` today — that existing behavior is untouched).
- Any change to which colors are chosen beyond the existing RED/BLUE alternation heuristic.
- Tunnel/ferry double routes — explicitly excluded per the eligibility decision above.
