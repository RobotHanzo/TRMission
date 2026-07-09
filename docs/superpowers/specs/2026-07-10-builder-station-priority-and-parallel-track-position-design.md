# Builder: station-priority config + parallel-track control position

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Problem

Two independent asks in the custom map builder:

1. **Station priority.** The live game board has a 4-tier progressive-reveal system for city
   labels (`major`/`secondary`/`tertiary`/`minor`, tied to zoom buckets `far`/`regional`/
   `district`/`local`) — but it's **hardcoded by city id** in `apps/web/src/game/lod.ts`, scoped
   only to the bundled Taiwan map (kept out of `@trm/map-data` on purpose so editing it never
   touched `CONTENT_HASH`). Custom maps get **no tiering at all** today: every station is
   effectively `minor`, so labels only ever appear at the closest zoom. There is no way for a
   builder author to configure this.
2. **Parallel-track control position.** `RoutesStage.tsx`'s `RouteForm` renders the `[1][2][3]`
   parallel-tracks `Segmented` control in two places: inline, before the Save/Cancel row, for a
   **new** route; and a second, duplicate copy passed through an `extra` slot for an **existing**
   route, which renders *after* Save/Cancel. The edit-mode instance needs to move above Save.

## Decisions (settled with the user)

1. Station priority reuses the **existing 4-tier scheme** (major/secondary/tertiary/minor, same
   zoom cutoffs) rather than a freeform numeric priority — it's the exact mechanism the live board
   already runs, so custom maps get the same progressive-reveal behavior for free.
2. Since the tier must persist with the custom map (authored content in Mongo, unlike Taiwan's
   hardcoded lists baked into the web bundle), it becomes a new field on `CityDef` in
   `@trm/map-data`. The bundled Taiwan map is migrated too — its hardcoded tier lists retired in
   favor of the same authored field, edited in place on the current (v4) content. No archive/version
   bump: v4 is unreleased and no game has ever been played on it.

   **Revised during planning: `tier` is `optional`, not required.** Grepping the repo for literal
   `CityDef`/`CityDraft` fixtures (`isIsland: false` as the marker) turns up ~24 files across
   `packages/engine/test`, `packages/map-data/test`, `apps/server/test`, and `apps/web/src` —
   ad-hoc test content that builds a `GameContent` purely to exercise unrelated engine/validation
   behavior and has no reason to care about a rendering-only field. `@trm/map-data`'s own documented
   convention (`packages/map-data/CLAUDE.md`, "Extending `GameContent` without breaking old hashes")
   is exactly this shape: an optional field that hashes identically when absent, because the shared
   `digest()` (`packages/shared/src/digest.ts`) drops `undefined`-valued keys — a mechanism that
   already applies recursively to every object nested in `cities`, not just top-level `GameContent`
   keys, so no special-casing is needed in `hashContent`. Making `tier` optional means: **zero**
   unrelated test fixtures need touching, Taiwan's `cities.ts` still sets a real value for every
   city (unaffected), and the builder still always writes an explicit value for an authored station
   (§3) — the only practical effect is that content which predates this feature, or a test fixture
   that never mentions it, reads as `undefined` and falls back to `'minor'` at the one read site
   (§4), the same graceful-fallback shape `cityName` already uses for an unknown id.
3. Builder UI gets a **plain selector only** (no canvas indicator/preview) — a `Segmented` field in
   the Stops-stage inspector, matching the existing `isIsland` control's pattern.
4. While relocating the parallel-tracks control, remove the duplication that caused the bug: give
   `RouteForm` a controlled-mode prop instead of a second copy of the same control.

## 1. Station priority — data model (`@trm/map-data`)

### `packages/map-data/src/types.ts`

- Add `export type CityTier = 'major' | 'secondary' | 'tertiary' | 'minor';`
- Add `readonly tier?: CityTier;` to `CityDef` (optional — see the revised Decision 2).

### `packages/map-data/src/cities.ts`

- Extend the `c(...)` helper with a `tier: CityTier = 'minor'` parameter (mirrors the existing
  `isIsland = false` default), threaded into the returned `CityDef`. Taiwan sets this explicitly for
  every city (the field being optional on the type doesn't mean Taiwan's own table leaves it unset).
- Set explicit tiers matching the current hardcoded sets in `apps/web/src/game/lod.ts`
  (`MAJOR_CITIES` → 10 cities, `SECONDARY_CITIES` → 10, `TERTIARY_CITIES` → 6); every other city
  keeps the `'minor'` default. This is a straight id-for-id migration — behavior-preserving for the
  live map.

### `packages/map-data/src/index.ts`

- No change. `hashContent` already folds `cities` in wholesale; an optional per-city key that's
  present hashes as part of the object same as any other field, and one that's absent is dropped by
  `stableStringify` same as today — no special-casing needed (see the revised Decision 2).

### Validation (`packages/map-data/src/validate.ts`)

- No new runtime check. `tier` is TS-union constrained and the builder only ever offers the 4 valid
  options via a `Segmented` control — the same precedent as `color`/`isTunnel`, which aren't
  separately validated in `validateContent` either.

## 2. Station priority — wire/server

### `apps/server/src/maps/maps.schemas.ts`

- Add `tier: z.enum(['major', 'secondary', 'tertiary', 'minor']).optional()` to `CityDraftSchema`.
- `draftFromDto`'s city mapping already spreads `c` — `tier` passes through unchanged (no line
  change needed there; only the schema gains the field).

### `apps/server/src/maps/maps.types.ts`

- No change. `MapDraft.cities: CityDef[]` imports `CityDef` from `@trm/map-data` directly, so it
  picks up the new optional field automatically.

### `apps/web/src/net/rest.ts`

- Add `tier?: string;` to the `CityDraft` interface — optional and loosely typed, matching the
  existing `color: string` convention on `RouteDraft` (the editor only ever writes one of the 4
  valid literals through its own `<Segmented>`, so no branded/union type is needed client-side).

### `apps/web/src/features/builder/editor/contentAdapter.ts`

- No change. `cities: draft.cities.map((c) => ({ ...c, id: asCityId(c.id) }))` already spreads
  `tier` through into `GameContent`.

## 3. Station priority — builder UI (`StopsStage.tsx`)

- Add a `Segmented<CityTier>` field labelled `t('builder.stationPriority')`, options `major` /
  `secondary` / `tertiary` / `minor` (high → low), placed directly below the existing `isIsland`
  row. `value` reads `selected.tier ?? 'minor'` (the field is optional on the type, and this is the
  same fallback `cityTier()` uses at render time, §4). `onChange` calls
  `updateCity(selected.id, { tier: v })`.
- `placeCity(...)`'s default payload for a newly-dropped station is **unchanged** — a station with
  no `tier` set already reads as `'minor'` everywhere (the Segmented above, `cityTier()` in §4), so
  there's nothing to default explicitly.

## 4. Station priority — making it actually render

- **`apps/web/src/game/content.ts`**: add
  `export const cityTier = (id: string): CityTier => cityById.get(id)?.tier ?? 'minor';` alongside
  the existing `cityName`/`ticketLabel`, reading from the same swappable `cityById` map — so it's
  automatically correct for whichever content is active (Taiwan or a custom map, live game or
  replay), with zero extra wiring in `game/catalog.ts`. The `?? 'minor'` fallback mirrors
  `cityName`'s existing graceful handling of an id that isn't in the active map.
- **`apps/web/src/game/lod.ts`**: remove `MAJOR_CITIES`/`SECONDARY_CITIES`/`TERTIARY_CITIES` and
  the id-lookup `cityTier`. Keep `zoomBucket`/`ZoomBucket` — that part is a genuine web-only
  live-pan-zoom-scale concern, unrelated to content.
- **`apps/web/src/components/Board.tsx`**: change the `cityTier` import from `../game/lod` to
  `../game/content`.
- **Builder canvas (`EditorCanvas.tsx`)**: intentionally left unwired (no `cityTier` prop passed to
  `MapScene`), per Decision 3. This is a no-op either way: the builder canvas never sets
  `data-zoom`, so the CSS LOD-gating rules never applied there before this change and still won't.

## 5. Station priority — i18n

- `builder.stationPriority`: zh-Hant `車站優先度` / en `Station priority`.
- `builder.tierMajor` / `builder.tierSecondary` / `builder.tierTertiary` / `builder.tierMinor`:
  zh-Hant `主要` / `次要` / `一般` / `小站`; en `Major` / `Secondary` / `Tertiary` / `Minor`.

## 6. Station priority — testing

- **`packages/map-data`**: extend `test/content.spec.ts` that every `CITIES` entry's tier (falling
  back to `'minor'` when absent) matches the prior `lod.ts` lists (count + membership). Update the
  pinned v4 hash literal in `test/versions.spec.ts` once the new hash is computed
  (`hashContent(TAIWAN_CONTENT)` changes because Taiwan's cities now carry an explicit `tier`).
- **`apps/web`**: move `game/lod.test.ts`'s `cityTier` describe block to `game/content.test.ts`
  (new), asserting against the real `TAIWAN_CONTENT`-backed `cityById` instead of hardcoded sets,
  plus a case for an id absent from `cityById` falling back to `'minor'`; `lod.test.ts` keeps only
  the `zoomBucket` tests. Add a `StopsStage.test.tsx` case for the new field (selecting a tier calls
  `updateCity` with it; a station with no `tier` set shows `minor` selected).
- **No unrelated fixtures need touching.** Because `tier` is optional, none of the ~24 files
  elsewhere in the repo that build literal `CityDef`/`CityDraft` test content (engine specs,
  map-data's own non-Taiwan fixtures, server e2e specs, other web component tests) need any change
  — confirmed by the optional-field decision above.

## 7. Parallel-track control — position + dedup

### `apps/web/src/features/builder/editor/stages/RoutesStage.tsx`

- `RouteForm` gains an optional prop `parallelTracks?: { value: 1 | 2 | 3; onChange(v: 1 | 2 | 3):
  void }`, replacing `hideDouble?: boolean`.
  - When `parallelTracks` is supplied (edit-existing-route case), the form's single inline
    `[1][2][3]` `Segmented` — rendered in its existing position, directly before the Save/Cancel row
    — reads/writes through it (`value`/`onChange`) instead of local `trackCount` state.
  - When absent (new-route case), behavior is unchanged: local `trackCount` state, submitted via
    `onSubmit`'s second argument.
- In `RoutesStage`'s edit-existing-route branch, drop the duplicate `Segmented` currently built
  inline inside `extra` (RoutesStage.tsx:110-133) and instead pass
  `parallelTracks={{ value: <current pair count, clamped 1-3>, onChange: (v) =>
  setPairTrackCount(selectedRoute.id, v) }}`. `extra` now carries only the Delete button, which
  stays below Save/Cancel (unchanged).
- Net effect: exactly one parallel-tracks control definition, always positioned identically
  (immediately before Save/Cancel) in both new-route and edit-route forms; no visual or behavioral
  change to the new-route form.

### Testing

- **`RoutesStage.test.tsx`**: assert the parallel-tracks control renders before the Save/Cancel row
  in both the new-route and edit-existing-route forms (DOM order), and that changing it in edit mode
  calls `setPairTrackCount` (not local-only state).

## Out of scope

- Any change to the builder canvas's own LOD/zoom preview (Decision 3).
- Archiving the pre-tier v4 content as a separate registry entry (Decision 2 — no one has played on
  it).
- Typhoon/event or other unrelated RoutesStage behavior.
