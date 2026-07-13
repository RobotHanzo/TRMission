# Fork custom maps from official maps — design

**Date:** 2026-07-10
**Status:** Approved (pending spec review)

## Goal

Let a map author start a new custom map as a **fork of an official map** (today: Taiwan), so the
official map's cities, routes, tickets, rules, and cartography become an editable starting point —
instead of only being able to start from an empty draft or clone another user's shared map.

## Background

The custom-map builder already supports two ways to create a map:

- `POST /maps` — a new **empty** draft (`emptyDraft()`).
- `POST /maps/shared/:code/clone` — copy another user's **shared custom map** by its 8-char share
  code (`MapsService.cloneByCode`).

Forking an official map is the same idea as clone-by-code, sourced from the built-in
`OFFICIAL_MAPS` registry (`packages/map-data/src/index.ts`) instead of a user share code. It is
**server-authoritative**: the client asks to fork a `mapId`, and the server produces the draft from
its own copy of the official content — the client never supplies map content.

### Why the copy is nearly direct

A custom map's `MapDraft` is `GameContent` minus `meta`:

```
MapDraft   = { cities, routes, tickets, geography?, rules? }   // apps/server/src/maps/maps.types.ts
GameContent = { meta, cities, routes, tickets, geography?, rules? }   // @trm/map-data
```

Both sides use the same underlying `@trm/map-data` types (`CityDef`, `RouteDef`, `TicketDef`,
`MapGeography`, `MapRules`). So `cities` / `routes` / `tickets` / `rules` transfer as-is. Only
`geography` needs synthesis, and only for Taiwan.

### The Taiwan geography wrinkle

Taiwan (the only official map today) has **no** `geography` on its content. Its coastline is a
hand-authored silhouette in `packages/map-data/src/taiwan-geography.ts` (outline + central-range
relief + island blobs, all in the same 0–100 board space as the cities), rendered via the built-in
branch of `GeographyLayer` (`apps/web/src/components/Geography.tsx`). Its content deliberately omits
`geography` so that (a) `CONTENT_HASH` stays stable and (b) it renders through the bespoke
`Geography` component, not `CustomGeography`.

`TAIWAN_CONTENT` must **not** be modified — adding `geography` to it would change `CONTENT_HASH` and
break every persisted game/replay. The fork geography is therefore generated **separately** from the
existing silhouette data and attached only to the forked draft.

Verified facts that make generated Taiwan geography safe:

- `CustomGeography` renders each `land` ring via `smoothClosedPath` and derives its graticule from
  `baseView` (fixed step). It **never reads `crop`** at render — `crop` is provenance only (for
  re-editing / graticule in the Crop stage). So synthetic `crop` bounds cannot distort rendering.
- `CustomGeography` intentionally renders no relief layer, compass, or `<circle>` islands — only
  `land` rings. So generated Taiwan geography = the outline ring + one polygon ring per island;
  the central range is dropped (no generic equivalent).
- `validateGeography` constraints (`packages/map-data/src/validate.ts`): `baseView.w/h > 0`;
  ≤ 400 rings; each ring ≥ 3 vertices; coords finite and within `[-50, 150]`; ≤ 15000 total
  vertices; `crop.lonMin < crop.lonMax` and `crop.latMin < crop.latMax`. Generated Taiwan geography
  (~11 rings, ~188 vertices, coords ~[4, 90]) satisfies all of these comfortably.
- With geography present on the loaded draft, the editor store's `load()` opens the editor on the
  **Stops** stage (`stage: detail.draft.geography ? 'stops' : 'crop'`), so a forked Taiwan opens
  showing its silhouette.

## Design

### 1. `@trm/map-data` — fork geography

Add a deterministic builder for Taiwan's fork geography and expose it through the official-map
registry.

- **`taiwanForkGeography(): MapGeography`** (new; lives with the Taiwan silhouette, e.g.
  `taiwan-geography.ts`, or `index.ts` alongside `OFFICIAL_MAPS`):
  - `baseView` = `TAIWAN_BASE_VIEW`.
  - `land` = `[TAIWAN_OUTLINE, ...TAIWAN_ISLANDS.map(circleToRing)]`, where `circleToRing({cx,cy,r})`
    samples a fixed number of points (N = 16) around the circle deterministically
    (`angle = 2π·i/N`; no `Math.random`), producing a closed polygon that `smoothClosedPath` renders
    as a near-circle. Every coordinate is rounded to 2 decimals (matching the "rounded to 2 dp
    before hashing/storage" contract on `MapGeography.land`, so re-publishing a forked-but-untouched
    map is hash-stable).
  - `crop` = synthetic real-Taiwan lon/lat bbox: `{ lonMin: 118, lonMax: 122.1, latMin: 21.8,
latMax: 26.4 }` (approx bounds incl. outlying islands). Provenance only; must be a valid bbox.
  - Central-range relief is intentionally excluded.
- **`OfficialMap`** gains an optional field:

  ```ts
  export interface OfficialMap {
    readonly mapId: string;
    readonly content: GameContent;
    readonly hash: string;
    /** Geography to seed a fork with when the content carries none (Taiwan's built-in silhouette
     *  is not a MapGeography). Absent for world-cropped official maps — use content.geography. */
    readonly forkGeography?: MapGeography;
  }
  ```

  The Taiwan entry in `OFFICIAL_MAPS` sets `forkGeography: taiwanForkGeography()`.

The generic fork rule (applied on the server) is: `geography = content.geography ?? forkGeography`.
Future official maps authored through the world-crop pipeline carry their own `content.geography`
and need no `forkGeography`.

### 2. `apps/server` — endpoints & service

Both new routes live on the existing `MapsController`
(`@UseGuards(AccessTokenGuard, FeatureGuard)` + `@RequireFeature('mapBuilder')`); the mutating one
adds `RegisteredUserGuard`, matching create/clone.

- **`GET /api/v1/maps/official`** → `OfficialMapSummary[]`.
  - `OfficialMapSummary = { mapId: string; nameZh: string; nameEn: string; cities: number;
routes: number }` — counts drive the picker card (mirrors the clone `peek` summary line).
  - `MapsService.listOfficial()` maps `OFFICIAL_MAPS` to summaries.
  - **Must be declared before `@Get(':id')`** in the controller so `official` is not captured as an
    `:id` path param.
- **`POST /api/v1/maps/fork/:mapId`** → `MapDetail`.
  - `MapsService.forkOfficial(mapId, ownerId)`:
    1. `const official = officialMapById(mapId)`; `NotFoundException` if absent.
    2. `const doc = await this.maps.create(randomUUID(), ownerId, `${nameZh} (副本)`,
       `${nameEn} (Copy)`)` — same naming convention as `cloneByCode`.
    3. Build the draft (spread-if-defined for optionals so `exactOptionalPropertyTypes` holds):
       ```ts
       const draft: MapDraft = {
         cities: [...official.content.cities],
         routes: [...official.content.routes],
         tickets: [...official.content.tickets],
         ...(geo !== undefined ? { geography: geo } : {}), // geo = content.geography ?? official.forkGeography
         ...(official.content.rules !== undefined ? { rules: official.content.rules } : {}),
       };
       ```
    4. `const updated = await this.maps.update(doc._id, ownerId, { draft })`; return
       `toDetail(updated ?? doc)`.
  - No `mapContents` write — publication still happens only at game start (`resolveForStart`),
    unchanged.
- **Schemas** (`maps.schemas.ts`): add `OfficialMapSummarySchema`
  (`{ mapId, nameZh, nameEn, cities, routes }`). The fork response reuses `MapDetailSchema`.

The forked draft is written straight through `MapsService` (not the request-body DTO pipe), but
Taiwan's authored content already conforms to `MapDraftSchema` by construction (region ≤ 60 chars,
`tier` in the enum, colors in `TRAIN_COLORS ∪ {GRAY}`, lengths in `ROUTE_LENGTHS`, ticket values
1–50, double-group letters ≤ 4 chars) and the generated geography conforms to
`MapGeographyDraftSchema`, so read-back through `MapDetailSchema` is safe.

### 3. `apps/web` — Maps-screen picker

- **`net/rest.ts`**:
  - `export interface OfficialMapSummary { mapId: string; nameZh: string; nameEn: string;
cities: number; routes: number }`.
  - `listOfficialMaps: () => req<OfficialMapSummary[]>('GET', '/maps/official')`.
  - `forkOfficialMap: (mapId: string) => req<MapDetail>('POST',
`/maps/fork/${encodeURIComponent(mapId)}`)`.
- **`features/builder/MapsScreen.tsx`**: a new `card` section **"Start from an official map"**,
  placed **side-by-side with the existing "Clone by code" card** in a two-column row below the
  "My maps" card:

  ```
  [ My maps  +  create new ]
  [ official map clone ][ clone by code ]
  ```

  The two cards share a flex/grid row (each `flex: 1`, wrapping to stacked on narrow viewports).
  The fork card loads `listOfficialMaps()` on mount; for each official map it renders name + a
  summary line ("N cities · M routes") and a **Fork** button that calls `forkOfficialMap(mapId)`
  then `enterMapEditor(detail.id)` — same success path as clone. The editor opens on the Stops
  stage with the Taiwan silhouette visible.

- **i18n** (`apps/web/src/i18n/index.ts`, zh-Hant primary + en): `builder.forkOfficialTitle`,
  `builder.forkMap`, `builder.forkSummary` (interpolates city/route counts).

### 4. Bundle note

The official-map picker uses the `GET /maps/official` endpoint rather than importing `OFFICIAL_MAPS`
into the web, keeping the Taiwan content tables out of the builder chunk and mirroring the existing
REST list/peek patterns. (The whole builder is already a single lazy route chunk; this keeps it
lean.)

## Testing

- **`@trm/map-data`**: `taiwanForkGeography()` passes `validateGeography`; and Taiwan content
  assembled with this geography (cities/routes/tickets + geography) passes
  `validateContent` / `validateForPlay`. Assert ring/vertex counts and 2-dp rounding for hash
  stability.
- **`apps/server`** (e2e): `GET /maps/official` returns the Taiwan summary with correct counts;
  `POST /maps/fork/:mapId` — 403 without `mapBuilder`, 404 on unknown `mapId`, and a successful fork
  yields an owned draft with 39 cities / 68 routes / 42 tickets + geography.
- **`apps/web`**: MapsScreen test that Fork calls `forkOfficialMap` and enters the editor.

## Out of scope

- No changes to `TAIWAN_CONTENT`, `CONTENT_HASH`, or the content registry.
- No changes to game start / `mapContents` publication.
- No new official maps (the mechanism is built to accept them, but none are added here).
- Re-cropping a forked map in the Crop stage may replace the generated silhouette with a real-world
  crop (a deliberate user action, with the usual city-alignment caveat); no special handling.
