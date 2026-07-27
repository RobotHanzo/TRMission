# CLAUDE.md

`src/maps/` is CRUD + sharing for user-authored maps, gated on the per-account **`mapBuilder` feature**
(`FeatureGuard` → 403 `FEATURE_DISABLED`; the strict gate covers list/author/share/peek/clone, and
`RegisteredUserGuard` still excludes guests from mutations). Features live on `UserDoc.features`
(taxonomy in `@trm/shared/features`), are granted from the dashboard, and are read **per request** —
never token claims.

## Two collections, deliberately different

- **`customMaps`** — a mutable per-owner draft; may be invalid mid-edit.
- **`mapContents`** — an **immutable, append-only** `{contentHash → GameContent}` store,
  insert-if-absent, written only at game start and **never garbage-collected**. A draft can be edited
  or deleted after a game starts, but that game (and its replay) keeps resolving against the exact
  content it was published with.

## Sharing

Share/clone go through an 8-char share code (`mintShareCode` / `peekByCode` / `cloneByCode`);
peek/clone responses are shaped to never leak `ownerId` or another user's map list.

## Official-map availability (a third collection)

- **`officialMapConfig`** — one singleton doc holding the **disabled** official `mapId`s, edited from
  the dashboard's Features panel (`GET/PUT /dashboard/config/official-maps`, permission
  `config.features`). Storing the negative is deliberate: a map added to `OFFICIAL_MAPS` in a later
  release ships on offer instead of going missing from a saved allowlist. Read fresh on every use,
  never cached; the set can never be emptied (`setOfficialMapAvailability` 400s).

Switching a map off takes it out of `listOfficial()` (the fork picker), `forkOfficial` (404, same as
a map that never existed), and the clients' room-settings picker — but the gate is the lobby: it
re-checks on the settings PATCH **and** again at start (`src/lobby/CLAUDE.md`). Nothing retroactive:
a running game and its replay resolve their board from the `contentHash` they were created with, so a
switch-off never touches them.

## The ungated routes

`GET /content/:hash` lives on `MapsContentController` **OUTSIDE** the feature gate — a plain
`AccessTokenGuard` route, so any authenticated viewer (guests included) may fetch content by its hash;
**the hash itself is the unguessable capability**. Gating it would break live custom-map games and
replays for other players.

`GET /official/enabled` sits on the same controller for the same reason: every host picks a map from
that list, and map authoring has nothing to do with it.

Reporting a map by share code is likewise outside the gate — see `src/moderation/CLAUDE.md`.
