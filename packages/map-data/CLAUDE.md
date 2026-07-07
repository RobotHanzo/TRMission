# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@trm/map-data` is the **single authored source of truth** for official content (ADR A13) — the
bundled Taiwan map is a 39-city graph, 68 route segments, and 42 destination tickets — and is also
the shared library backing **user-authored custom maps** (validation, mission auto-generation). Both
draw on the same `GameContent` shape, `hashContent`, and `validate()`. Everything else (engine board,
client catalog, Mongo seed) is derived from it. Commands: `yarn workspace @trm/map-data test` /
`… typecheck` / `… lint`.

## Structure & invariants

- `cities.ts` / `routes.ts` / `tickets.ts` — the authored tables for the bundled Taiwan map.
  `index.ts` assembles them into `TAIWAN_CONTENT`, derives `CONTENT_HASH`, and exports
  `OFFICIAL_MAPS` / `officialMapById()` — the registry of maps that ship with the game (Taiwan is
  `OFFICIAL_MAPS[0]`; add future official maps here, each with its own authored tables and hash).
- `validate.ts` — `validate()` enforces the structural invariants the engine relies on: connected
  graph, no unreachable node, ferry/locomotive/length rules, ticket endpoints exist, no length-5/7
  routes. **Run the tests after any content edit** — they assert these. `validateGeography()` and
  `validateForPlay()` (below) additionally cover custom-map content that never goes through this file.
- `graph.ts` — `shortestDistances()`: all-pairs Dijkstra over the route graph (min length per city
  pair), used by mission auto-generation.
- `generate.ts` — `generateTickets()`: deterministic mission auto-generation (seeded via
  `@trm/shared`'s counter PRNG — same seed always produces the same ticket list) plus `RULE_BOUNDS`,
  the min/max clamp for every tunable in `MapRules`.
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

To change the map **without breaking already-persisted games**:

1. Edit the live tables (`cities.ts` / `routes.ts` / `tickets.ts`) and **bump `MAP_META.version`** —
   content is immutable once published, so a change ships a _new_ version, never a mutation in place.
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
  `doubleGroup` and `ferryLocos` may combine on custom maps — a "double ferry" pair where one or both
  members require locomotives — even though the bundled Taiwan map's own authoring convention
  (`routes.ts`) keeps every route at most one of double/tunnel/ferry.

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
