# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`@trm/map-data` is the **single authored source of truth** for the game's content (ADR A13): the
46-city Taiwan graph, 90 route segments, and 46 destination tickets. Everything else (engine board,
client catalog, Mongo seed) is derived from it. Commands: `yarn workspace @trm/map-data test` /
`… typecheck` / `… lint`.

## Structure & invariants

- `cities.ts` / `routes.ts` / `tickets.ts` — the authored tables. `index.ts` assembles them into
  `TAIWAN_CONTENT` and derives `CONTENT_HASH` (the shared digest of the content).
- `validate.ts` — `validate()` enforces the structural invariants the engine relies on: connected
  graph, no unreachable node, ferry/locomotive/length rules, ticket endpoints exist, no length-5/7
  routes. **Run the tests after any content edit** — they assert these.

## The critical gotcha: CONTENT_HASH and the version registry

`CONTENT_HASH` pins a game/replay to exact content (ADR A6/A13). **Any** change to a city, route,
ticket, or `MAP_META.version` produces a new hash. A persisted game stores the hash it was created
against, and recovery rebuilds its board from the **content registry** keyed by that hash — so an
in-flight game always replays against its original map, even after the current content has moved on.

To change the map **without breaking already-persisted games**:

1. Edit the live tables (`cities.ts` / `routes.ts` / `tickets.ts`) and **bump `MAP_META.version`** —
   content is immutable once published, so a change ships a *new* version, never a mutation in place.
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
