# Map builder: move a station without delete/re-add ("Stops" stage)

**Date:** 2026-07-04
**Status:** Approved

## Goal

In the `Stops` stage of the custom map builder, the only way to relocate a station today is to
delete it and place a new one — which also cascades-deletes any incident routes/tickets
(`removeCity` in `editor/store.ts`). Add a "Move Station" control to the inspector so an author can
reposition an existing station's `x`/`y` in place, keeping its id, name, region, and every route and
ticket that references it.

The store-side primitive already exists and is unused: `moveCity(id, x, y)` in
`apps/web/src/features/builder/editor/store.ts` (lines ~65, ~166-172) already patches
`draft.cities` immutably through the standard `mutate()` path (undo/autosave included). This
feature is UI wiring only — no store or data-model changes.

## Decision (settled with the user)

**Interaction — "move mode" toggle button + click-to-relocate on the canvas**, mirroring the
existing click-to-place-new-station flow exactly (same coordinate rounding, same
`onBackgroundClick` wiring), rather than a drag handle (rejected — no precedent in this stage, and
would need new pointer-capture + panning-exclusion code) or numeric X/Y input fields (rejected —
disconnected from the visual map that this builder is built around).

## Flow

1. When a station is selected, the inspector (`StopsStage.tsx`) shows a **"Move Station"** button
   (lucide `Move` icon) placed after the existing fields (name/region/island) and before the
   delete button.
2. Clicking it enters **move mode**:
   - The button's own label swaps to **"Cancel Move"**.
   - The hint text under the canvas (normally `builder.stopsHint`) swaps to
     `builder.moveStopHint`, interpolating the station's `nameZh` (e.g. *"點擊地圖以將「{{name}}」移動到新位置"* / *"Click the map to move '{{name}}' to a new location"*).
3. The next click on empty canvas, instead of creating a new station, calls
   `moveCity(id, x, y)` with the same `Math.round(pt.x * 10) / 10` rounding the add-flow already
   uses. Move mode then exits automatically and the station stays selected (so its inspector stays
   open for further edits).
4. Move mode cancels **without** moving the station if the user:
   - clicks the button again (now labeled "Cancel Move"),
   - presses **Esc**,
   - selects a different station (clicking an existing station always just selects it — city
     clicks already call `e.stopPropagation()` in `EditorCanvas`, so they never reach
     `onBackgroundClick` and never trigger a move),
   - deletes the currently-selected station.

## Implementation footprint

- **`apps/web/src/features/builder/editor/stages/StopsStage.tsx`**
  - New `isMoving` boolean state, reset to `false` whenever `selected?.id` changes (covers the
    "select a different station" and "delete" cancel cases) and on Esc (`keydown` effect while
    `isMoving` is true).
  - `onBackgroundClick`: branch on `isMoving` — if true and a station is selected, call
    `moveCity(selected.id, roundedX, roundedY)` and clear `isMoving`; else keep today's
    `placeCity` behavior.
  - New button + conditional hint text as described above.
- **`apps/web/src/i18n/index.ts`**: two new keys next to the existing `stopsHint`/`deleteStop`
  entries (~line 325 zh-Hant, ~line 747 en): `builder.moveStop` ("移動車站" / "Move Station"),
  `builder.cancelMove` ("取消移動" / "Cancel Move"), `builder.moveStopHint` (with `{{name}}`
  interpolation, both locales).
- **No changes** to `EditorCanvas.tsx`, `editor/store.ts`, `net/rest.ts`, or `@trm/map-data` types —
  `moveCity` and the `CityDraft`/`CityDef` shapes are already exactly what's needed.

## Testing

New `apps/web/src/features/builder/editor/stages/StopsStage.test.tsx` (none exists today),
following the `CurvesStage.test.tsx` pattern (seed `useEditorStore` state directly, render, fire
DOM events):

- "Move Station" button only renders when a station is selected.
- Clicking it swaps the button label and the canvas hint text.
- Clicking the canvas background while in move mode calls `moveCity` (verified via
  `useEditorStore.getState().draft.cities`), not `placeCity` (city count unchanged).
- Esc cancels move mode and restores the normal hint/button label without changing any city's
  `x`/`y`.
- Selecting a different station while in move mode cancels it for the original station.

## Out of scope

- Drag-to-move directly on the map pin (rejected interaction option — see Decision above).
- Any change to how routes/tickets reference a moved station — they key by `id`, which never
  changes, so nothing downstream needs updating.
- Any server/wire/schema change — `x`/`y` bounds and validation are already enforced identically
  for add and edit today (`CityDraft`/`CityDef`, `@trm/map-data` `validate`).
