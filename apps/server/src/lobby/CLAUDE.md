# CLAUDE.md

`src/lobby/` is the rooms lifecycle with **atomic seat CAS** (`room.repo.ts`).

`RoomSettings.map` selects `{source:'official', mapId}` or `{source:'custom', customMapId}` (default:
official Taiwan).

`start` resolves the selector via `MapsService.resolveForStart` (validates a custom draft, hashes it,
and publishes it to `mapContents` **before the game exists**), builds the `GameConfig` — including
`ruleParams: {...mapRules, ...roomVariantFlags}`, a disjoint merge, since the map's curated
`RULE_BOUNDS` keys never overlap the variant-flag booleans — calls `hub.createMatch`, and hands back a
**ws-game ticket**. It also fires the **game-started** push (`src/push/CLAUDE.md`).

Bot add/remove are **host-only**.

Selecting a `{source:'custom'}` map (settings PATCH) _and_ resolving it at `start` both require the
**host** to hold the `mapBuilder` feature — the start-time check is authoritative, so a revoke between
select and start still blocks. Feature mechanics: `src/maps/CLAUDE.md`.

Ban enforcement covers this module's three ws-ticket paths (`src/dashboard/CLAUDE.md`).
