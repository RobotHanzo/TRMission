# Map builder: pick countries directly, as an alternative to manual cropping

**Date:** 2026-07-04
**Status:** Approved

## Goal

The `Crop` stage of the custom map builder currently has one way to define a map's geography:
drag a rectangle over the world map (`CropStage.tsx` → `cropToGeography`). That's the right tool
for "a region of the world," but clumsy for "these specific countries" — a rectangle around, say,
Japan + South Korea also drags in a slice of China and Russia that then has to be manually deleted
in the Trim stage. Add a second mode: pick one or more countries by name/click and get their
silhouette directly, with no manual rectangle and no stray neighbours.

## Decision (settled with the user)

- **Selection UX:** both map-click _and_ a searchable sidebar list (grouped by continent, A–Z
  within each) — not map-click-only. Natural Earth's admin-0 countries include tiny nations
  (Caribbean/Pacific microstates) that are impractical to hit precisely at world-map zoom; the list
  is the reliable path for those, the map click is the fast path for everything else.
- **Distant selections:** reuse the existing `cropLatWarning` mechanism (today only checks
  `latSpan > 60°`), extended to also flag a large longitude span on the union bounding box. No new
  UI concept — picking Taiwan + Brazil warns the same way an unreasonably tall manual crop does
  today.
- **Data source:** Natural Earth's `ne_110m_admin_0_countries` (public domain, same family as the
  existing `ne_110m_land`), vendored the same way `worldData.ts` already is (fetched offline,
  simplified, committed as a flat TS module — no runtime fetch, no GeoJSON parser in the bundle).
  It's the only dataset with actual borders; the existing land-only dataset can't be split into
  "just France" because contiguous landmasses (e.g. Iberia) are single undifferentiated rings.

## Data: `geo/worldCountries.ts`

A new vendored module, generated offline (script not committed, matching the precedent set by
`worldData.ts`'s own generation):

```ts
export interface CountryLand {
  readonly id: string; // ISO_A3, e.g. "TWN"
  readonly nameEn: string; // NAME_EN
  readonly nameZh: string; // NAME_ZHT (Traditional Chinese — matches this app's primary locale)
  readonly continent: string; // CONTINENT, e.g. "Asia" — used for the sidebar's grouping
  readonly rings: readonly Ring[]; // exterior ring(s) only, same Ring type as clip.ts
}
export const WORLD_COUNTRIES: readonly CountryLand[] = [
  /* 177 entries */
];
```

Generation mirrors the `worldData.ts` fix from earlier today: fetch the source GeoJSON, keep only
each polygon's **exterior ring** (interior rings are holes, e.g. a lake — not relevant to a country
outline the way we render it here either), Douglas-Peucker simplify each country's rings at the
same ~0.03° tolerance, round to 2dp. All 177 features carry non-null `NAME_ZHT`/`NAME_EN`/`CONTINENT`
in the source data, confirmed via a snapshot fetch — no fallback-name handling needed. Expected size:
same order of magnitude as `worldData.ts` (~5-8k total vertices) — this only grows the map-builder's
lazy chunk, not the main bundle (see `apps/web/CLAUDE.md`'s chunk-size note).

## UI structure

Split today's `CropStage.tsx` (277 lines, all rectangle-drag logic) into:

- **`CropStage.tsx`** (thin shell) — owns a local `mode: 'draw' | 'countries'` toggle (segmented
  control at the top, above the canvas), renders `<CropDrawStage>` or `<CountryPickStage>`
  accordingly. Switching modes unmounts the other — its in-progress (unconfirmed) selection is
  discarded, same as today's `startOver` already discards a drawn rectangle. Nothing commits to
  `draft.geography` until that mode's own Confirm button is clicked.
- **`CropDrawStage.tsx`** — today's `CropStage.tsx` body, moved verbatim (rectangle drag, handles,
  preview pane, Confirm/Redo). No behavior change.
- **`CountryPickStage.tsx`** (new) — same `WORLD_VIEWBOX`/pan-zoom canvas scaffold as
  `CropDrawStage`, but instead of a draggable rectangle:
  - Renders one `<path>` per `WORLD_COUNTRIES` entry (not `worldLand()` — the country dataset is
    the whole basemap in this mode, so every visible landmass is individually clickable).
    Click toggles that country's id in a local `Set<string>`, following the exact
    select/highlight/toggle pattern `TrimStage.tsx` already uses for its land rings (`selected`
    state, `land-ring--selected`-style CSS class, click-to-toggle, click-on-background-to-clear is
    _not_ wanted here since empty ocean clicks should just do nothing — countries only toggle via
    their own path or the list).
  - A sidebar list (new `CountryList.tsx`, kept separate so `CountryPickStage.tsx` doesn't balloon):
    a text search input filtering by `nameZh`/`nameEn`/`id`, grouped under continent headings,
    checkbox per country, two-way synced with the map's selected-id `Set` (clicking either the map
    or the checkbox toggles the same state).
  - The existing aside preview pattern carries over: live-rendered combined silhouette (via
    `countriesToGeography`, below) + dropped-ring notice + Confirm button that calls
    `setGeography(result.geography)` / `setStage('trim')`, identical wiring to `CropDrawStage`'s
    `confirm()`.
  - The longitude/latitude-span warning (see Decision) renders the same way
    `cropLatWarning` does today, computed off the union bbox.

## Turning a selection into geography: `countriesToGeography`

New function in `geo/world.ts`, parallel to the existing `cropToGeography(bbox)`:

```ts
export function countriesToGeography(ids: readonly string[]): CropResult | null;
```

1. Look up each id in `WORLD_COUNTRIES`; empty/all-unmatched selection returns `null` (mirrors
   `cropToGeography`'s `isValidCrop` early-out).
2. Compute the union bounding box of just the selected countries' own rings (not a clip against
   `WORLD_LAND`) — this is the critical difference from crop mode: a selection of France + Germany
   must not pull in Belgium just because it falls inside the union rectangle. Reuse the same
   margin/target-span math `buildProjection` already encapsulates by feeding it the computed bbox
   as a normal `CropBBox`.
3. Run the selected countries' combined rings through the existing `simplifyToFit` (same
   `maxVertices`/`maxRings` engine caps as `cropToGeography`, same `startToleranceFor`-style scaling
   off the bbox span, same `droppedRings` surfaced to the UI) — countries are pre-simplified at
   generation time, but a multi-country selection can still exceed the engine's caps (e.g. several
   archipelago nations at once), so this pass stays.
4. Project via `buildProjection`, producing the same `{ baseView, land, crop }` shape
   `cropToGeography` does — `crop` is the computed union bbox, so `MapGeography`'s existing schema
   (`packages/map-data/src/types.ts`) needs no changes, and downstream stages (Trim, validation,
   hashing) are unaffected.

## i18n

New keys alongside the existing `builder.crop*` block in `apps/web/src/i18n/index.ts` (zh-Hant
~line 311, en ~line 737): `cropModeDraw` ("框選區域" / "Draw a region"), `cropModeCountries`
("選擇國家" / "Pick countries"), `countrySearchPlaceholder` ("搜尋國家…" / "Search countries…"),
`countrySelectedCount` ("已選取 {{n}} 個國家" / "{{n}} countries selected"), `countryLonWarning`
("經度範圍過大，投影會失真" / "Longitude range too wide, projection will distort" — paired with the
existing `cropLatWarning` for the latitude case), `countryPickEmptyHint` ("點擊地圖或從列表中選擇國家"
/ "Click the map or pick from the list").

## Testing

- **`geo/world.test.ts`** (extends the existing file): `countriesToGeography` with a single
  country, multiple disjoint countries (verifying no unselected country's rings leak in), an
  unmatched/empty id list (`null`), and a combined selection large enough to exercise
  `droppedRings`.
- **New `editor/stages/CountryPickStage.test.tsx`**, following `TrimStage.tsx`'s existing
  interaction-test style: clicking a country path toggles selection and the preview updates;
  the search box filters the list; a checkbox click and a map click on the same country are
  equivalent (both toggle the same underlying state); Confirm calls `setGeography`/`setStage`.
- **New `editor/stages/CropStage.test.tsx`** (none exists today): the mode toggle switches which
  child renders, and switching away from a mode with an unconfirmed in-progress selection discards
  it (remounting the previous mode shows it empty again).

## Out of scope

- Grouping a sovereign state's overseas territories with its mainland (e.g. France + French
  Guiana) — Natural Earth's admin-0 dataset already treats these as it does today; we select
  whatever it lists as an individual feature, no custom grouping logic.
- Any change to `CropDrawStage`'s own rectangle-crop behavior, `WORLD_LAND`/`worldData.ts`, or the
  Trim/Stops/etc. stages downstream — this feature only adds a second on-ramp into the same
  `draft.geography` shape they already consume.
- Antimeridian-spanning countries (Russia, Fiji) rendering oddly at the ±180° seam — pre-existing
  limitation of the equirectangular projection shared with crop mode, not addressed here.
