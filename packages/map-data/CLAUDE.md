# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@trm/map-data` is the **single authored source of truth** for official content (ADR A13) — three
bundled maps: Taiwan (36 cities / 77 routes / 84 tickets), Greater Taipei (38 / 72 / 56), and the
community-authored 大臺北軌道交通 (46 / 91 / 63, credited to 嶼翼 via `meta.author`) — and is
also the shared library backing **user-authored custom maps** (validation, mission auto-generation).
All of them draw on the same `GameContent` shape, `hashContent`, and `validate()`. Everything else
(engine board, client catalog, Mongo seed) is derived from it. Commands:
`yarn workspace @trm/map-data test` / `… typecheck` / `… lint`.

## Structure & invariants

- `cities.ts` / `routes.ts` / `tickets.ts` — the authored tables for the bundled Taiwan map.
  `index.ts` assembles them into `TAIWAN_CONTENT`, derives `CONTENT_HASH`, and exports
  `OFFICIAL_MAPS` / `officialMapById()` — the registry of maps that ship with the game.
- `taipei/` — the second official map (Greater Taipei, `mapId: 'taipei'`), with the same table
  layout plus its own `geography.ts`. It carries `geography` and `rules` **as content**, so it has
  no `forkGeography` (a fork seeds straight from `content.geography`) and it renders through the
  generic `CustomGeography` path on every client rather than Taiwan's hand-drawn silhouette. Its
  ids are prefixed (`tp_*`, `TPR*`, `TPL*`/`TPS*`) so a route/city id in a log or a replay names
  exactly one map.
  **Its geography is generated, not drawn**: `geography.ts`'s land + three city-border rings are
  the baked output of the map builder's own pipeline —
  `apps/web/src/features/builder/geo/world.ts`'s `citiesToGeography(['TW-TPE','TW-TPQ','TW-KEE'],
true)` over Natural Earth admin-1 polygons — and every stop's coordinate is its real lon/lat
  pushed through the same `geo/projection.ts` + crop. That coupling is what `test/taipei.spec.ts`
  guards (each stop inside its own city, ferries over water, no route crossing another): change a
  stop by hand and it will drift out of its city. To refresh either side, re-run that call and
  re-project the stops — don't nudge one without the other. The values are baked as literals so
  this package keeps no dependency on the builder or its dataset.
- `taipei-transit/` — the third official map (大臺北軌道交通, `mapId: 'taipei-transit'`), **adopted
  from a community builder draft by 嶼翼** (credited via the optional `meta.author`, shown wherever
  official maps are listed). Content is the author's design verbatim; adoption renamed ids to
  `tt_*`/`TTR*`/`TTL*`/`TTS*`, normalised regions, clipped the excess Taoyuan/Yilan county area out
  of the rings (the cut lines sit one unit outside `baseView`, so the land runs off-frame), and
  added `geography.relief` — the optional mountain-relief rings (陽明山, 雪山山脈) that every
  custom-geography renderer draws the way Taiwan draws its Central Range. Unlike `taipei/`, its
  stop coordinates are hand-placed (not projected), so `test/taipei-transit.spec.ts` pins looser
  properties (no crossings, stops on land, relief walls the tunnels cross) plus the v1 hash.
  Its `OFFICIAL_MAPS` entry also carries `recommendedTeamMode: true` — a presentation-only flag on
  the **registry entry, never `meta`** (which `hashContent` folds in), surfaced by
  `@trm/client-core`'s `officialMapOptions` so every picker tags it.
  Adding another official map means: a directory here, a `CONTENT_REGISTRY` entry (recovery
  resolves a persisted game's board through it), and an `OFFICIAL_MAPS` entry — the room settings
  selectors, the fork flow, and both clients' bundled content caches all iterate that list, so
  nothing else needs touching. Keep Taiwan at `OFFICIAL_MAPS[0]`: the dev seed, the health
  endpoint, and the room-settings default all fall back to it. A new entry ships **on offer**:
  which of these maps players may actually pick is a maintainer switch stored server-side
  (`apps/server/src/maps/CLAUDE.md`), and it holds the disabled ids, never an allowlist.
- `validate.ts` — `validate()` enforces the structural invariants the engine relies on: connected
  graph, no unreachable node, ferry/locomotive/length rules, ticket endpoints exist, no length-5/7
  routes. The test suite asserts them all. `validateGeography()` and
  `validateForPlay()` (below) additionally cover custom-map content that never goes through this file.
- `graph.ts` — `shortestDistances()`: all-pairs Dijkstra over the route graph (min length per city
  pair), used by mission auto-generation.
- `generate.ts` — `generateTickets()`: deterministic mission auto-generation (seeded via
  `@trm/shared`'s counter PRNG — same seed always produces the same ticket list) plus `RULE_BOUNDS`,
  the min/max clamp for every tunable in `MapRules`.
- `geometry.ts` — the pure route/coastline math every renderer draws through, including BOTH
  closed-ring smoothings: `smoothClosedPath` (uniform Catmull–Rom, for the dense hand-authored
  Taiwan silhouette) and `smoothCoastPath` (centripetal, for a cropped-world map's sparse land and
  border rings — the two are not interchangeable, and its own doc comment says why). Web, the Skia
  board, both mission-card previews and the server's OG card all resolve here, so no surface can
  render a different coastline from another.
- `render-tokens.ts` — the shared cartography render tokens: `MAP_PALETTE_LIGHT/DARK`, `MAP_INKS`,
  `ROUTE_COLOR_HEX`/`LIVERY_COLORS`, `MAP_DIMS`, and `mapCssVars()` (the `--m-*` custom-property
  map the web board CSS resolves). Consumed by the web's `MapScene`/`game.css`/`theme/colors.ts`
  and the server's OG map card so none can drift. Pure data — **never** part of `hashContent`, so
  editing a token never bumps `CONTENT_HASH`.

## The critical gotcha: CONTENT_HASH and the version registry

`CONTENT_HASH` pins a game/replay to exact content (ADR A6/A13). **Any** change to a city, route,
ticket, or `MAP_META.version` produces a new hash. A persisted game stores the hash it was created
against, and recovery rebuilds its board from the **content registry** keyed by that hash — so an
in-flight game always replays against its original map, even after the current content has moved on.

This applies per official map: `TAIPEI_CONTENT_HASH` pins Greater Taipei exactly the way
`CONTENT_HASH` pins Taiwan, and `test/taipei.spec.ts` pins its v1 hash the same way
`test/versions.spec.ts` pins Taiwan's.

To change a map **without breaking already-persisted games**:

1. Edit the live tables (`cities.ts` / `routes.ts` / `tickets.ts`, or `taipei/*`) and **bump that
   map's `meta.version`** — content is immutable once published, so a change ships a _new_ version,
   never a mutation in place.
2. Freeze the prior version as an immutable snapshot under `src/archive/` (see `archive/v2.ts`) and
   register it in `CONTENT_REGISTRY` (`index.ts`). The snapshot must capture every table that diverged
   as a full literal; tables that are byte-identical to the live ones may be referenced, **but** pin
   that version's hash in `test/versions.spec.ts` — that assertion is the tripwire that fails if a
   later edit makes a referenced table drift, forcing you to freeze it too.
3. `resolveContentByHash` (consumed by the engine's `boardForContentHash`, which the server's default
   board resolver calls on recovery) does the rest. An unregistered hash throws — recovery fails loudly
   rather than replaying against the wrong board.

Finished games in `matchHistory` store a denormalized scoreboard and are **never** replayed, so they
are unaffected by content edits regardless of the registry.

- Coordinates are `x` 0 (west)…100 (east), `y` 0 (north)…100 (south) for direct SVG placement in the
  web board — keep them in that normalized space.
- Route flags carry mechanics: `doubleGroup` (A–J pairs), `ferryLocos > 0` (gray ferry, N locomotives
  required), `isTunnel`. The engine reads these directly, so they must match the intended rule.
  `doubleGroup` may combine with either `ferryLocos > 0` ("double ferry" pair — one or both members
  require locomotives) or `isTunnel` ("double tunnel" parallel pair) on custom maps — even though
  the bundled Taiwan map's own authoring convention (`routes.ts`) keeps every route at most one of
  double/tunnel/ferry.

## Extending `GameContent` without breaking old hashes

`GameContent` carries two **optional** fields beyond the core cities/routes/tickets/meta used by
custom maps: `geography?: MapGeography` (the cropped world backdrop — projected land rings +
`baseView` + source crop bounds) and `rules?: MapRules` (a curated, bounded subset of `RuleParams`;
keys and bounds live in `RULE_BOUNDS`). `hashContent` folds both in **spread-if-defined** — a content
object with `geography`/`rules` omitted hashes byte-identically to one that never had those fields at
all, because the shared digest (`packages/shared/src/digest.ts`) is a key-sorted `JSON.stringify`
that drops `undefined` keys. This is why adding these fields didn't require a new archived version:
the pinned Taiwan hash in `test/versions.spec.ts` held. `test/hash-extension.spec.ts` is the
regression gate — it re-hashes content with/without these fields and asserts equality when absent.

**Rule when adding another optional field to `GameContent`:** spread it in conditionally
(`...(x !== undefined ? { x } : {})`), never assign it as an explicit key that can be `undefined`
(`exactOptionalPropertyTypes` also rejects that at the type level), and add a case to
`hash-extension.spec.ts` proving old content still hashes unchanged. Only bump `MAP_META.version` /
freeze an archive when a **required** field changes or an authored table's content changes.
