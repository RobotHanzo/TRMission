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

## The critical gotcha: CONTENT_HASH

`CONTENT_HASH` pins a game/replay to exact content (ADR A6/A13). **Any** change to a city, route,
ticket, or `MAP_META.version` produces a new hash, which means previously-persisted games will refuse
to replay against the new content (`engineVersion`/`contentHash` mismatch on recovery). So:

- Editing content is a breaking change for any in-flight or archived game. Treat published content as
  immutable; bump `MAP_META.version` for a genuinely new map rather than mutating in place.
- Coordinates are `x` 0 (west)…100 (east), `y` 0 (north)…100 (south) for direct SVG placement in the
  web board — keep them in that normalized space.
- Route flags carry mechanics: `doubleGroup` (A–J pairs), `ferryLocos > 0` (gray ferry, N locomotives
  required), `isTunnel`. The engine reads these directly, so they must match the intended rule.
