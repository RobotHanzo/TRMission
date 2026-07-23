# Custom Map System — Implementation Plan

## Context

TRMission currently ships exactly one map: Taiwan, statically bundled everywhere. Users want to
**author their own maps** — crop a region of the world as the board base, place custom stops, draw
railway routes of the three types (standard / tunnel / ferry), author missions (destination
tickets) with an **auto-generate** button — and the platform must also be revised so **new official
maps** can ship. The builder UI is a significant new surface.

**Product decisions (confirmed with user):**
- World base = **bundled public-domain world vector** (Natural Earth), cropped client-side, rendered in the existing cartographic style.
- Sharing = **by link/code**: maps are private; a share code lets another user peek + **clone** into their own list.
- Authoring = **registered accounts only** (guests play but don't author; guest users are TTL-expired in Mongo).
- **Per-map rule params**: builder exposes a curated subset of `RuleParams`, applied at start via `GameConfig.ruleParams`.

**Why the design below fits the codebase:** the only runtime content dimension is `contentHash`
(`GameConfig.contentHash` → persisted → recovery/replay via `resolveContentByHash`); the wire
carries only ids + `content_hash` (already field 3 of `GameSnapshot`); engine/bots/codec are fully
content-generic. So custom maps = a DB-backed extension of the existing content-addressed registry,
plus a web refactor away from the bundled-Taiwan singleton.

## Architecture decisions

1. **`GameContent` gains optional `geography?: MapGeography` and `rules?: MapRules`** (map-data
   `types.ts`). Engine ignores both (`buildBoard` reads meta/cities/routes/tickets only — no
   determinism impact). `hashContent` folds them in **spread-if-defined**, so existing Taiwan/V2
   hashes stay byte-identical (`digest` is key-sorted `JSON.stringify`, which drops undefined keys —
   verified `packages/shared/src/digest.ts:8-21`). The pinned v2 hash in
   `packages/map-data/test/versions.spec.ts` is the tripwire; add a v3 pin for the current Taiwan
   hash as part of this change. Hashing geography/rules means any edit ⇒ new hash ⇒ `mapContents`
   insert-if-absent is always safe (identical hash ⇒ identical doc).

   ```ts
   interface MapGeography {
     baseView: { x: number; y: number; w: number; h: number };
     land: readonly (readonly (readonly [number, number])[])[]; // rings, 0-100 space, 2-dp rounded
     crop: { lonMin: number; lonMax: number; latMin: number; latMax: number };
   }
   const MAP_RULE_KEYS = ['trainCarsStart','stationsPerPlayer','longestPathBonus','stationBonus',
     'initialLongOffer','initialShortOffer','ticketDrawCount'] as const;
   type MapRules = Partial<Pick<RuleParams, (typeof MAP_RULE_KEYS)[number]>>;
   ```

2. **Two new Mongo collections** (repo pattern copied from `RoomRepo`):
   - `mapContents` — `{ _id: contentHash, content: GameContent, sourceMapId, ownerId, publishedAt }`.
     Immutable, insert-if-absent (swallow E11000), **never GC'd** (replays outlive owner/guest-TTL deletion).
     Written only at game start.
   - `customMaps` — `{ _id: uuid, ownerId, nameZh, nameEn, revision, draft: MapDraft, shareCode?, createdAt, updatedAt }`.
     Mutable, may be invalid mid-edit. Indexes `{ownerId:1, updatedAt:-1}`, unique sparse `{shareCode:1}`.
     `revision` increments per PUT → becomes `meta.version` at publish; `meta.mapId = 'custom:' + draftId`.

3. **Resolver chain** (static registry → DB):
   - Server: `GameHubOptions.boardResolver` widens to `(config) => Board | Promise<Board>`; `recoverMatch`
     awaits it (`hub.ts:124`; the method is already async). `game.module.ts` factory injects:
     `boardForContentHash` first, else `MapContentRepo.find(hash)` → `buildBoard`, else throw (loud).
   - History: `history.repo.ts` `isReplayable` becomes a batch check (`mapContents.find({_id: {$in: unknownHashes}})`).
   - Web: hash-keyed cache — bundled `resolveContentByHash` sync path, else `GET /api/v1/maps/content/:hash`.

4. **Official maps**: map-data exports `OFFICIAL_MAPS: { mapId, content, hash }[]` (Taiwan first) +
   `officialMapById()`. `RoomSettings` gains `map: MapSelector = {source:'official', mapId} | {source:'custom', customMapId}`
   (default Taiwan; legacy rooms covered by the existing `{...DEFAULT_ROOM_SETTINGS, ...room.settings}` merge —
   audit merge sites at `lobby.service.ts:160,186` + repo patch + `toView`). `LobbyService.start`
   (`lobby.service.ts:146-181`) resolves selector → `(board, contentHash, mapRules)`, publishes custom
   content to `mapContents`, then `ruleParams: { ...mapRules, ...roomVariantFlags }` (disjoint keys —
   the curated subset excludes the 4 variant booleans).

5. **Web content refactor** (Taiwan keeps working at every step): `game/content.ts` module constants →
   `ContentCatalog` (`buildCatalog(content)` = content + id maps + geometry + names) + React
   `CatalogContext` defaulting to `TAIWAN_CATALOG`; `routeGeometry.ts` module-scope `ROUTE_GEOMETRY` →
   WeakMap-memoized `computeRouteGeometry(content)` (`BOW_OVERRIDE` stays keyed by Taiwan ids — inert
   for other maps); `Geography.tsx` splits into `TaiwanGeography` / `CustomGeography` (stored land rings
   through the existing Catmull-Rom smoothing) behind a `GeographyLayer({content})` switch;
   `baseView = content.geography?.baseView ?? BASE_VIEW`. Loading gate in `GameScreen`/`ReplayScreen`
   until `useCatalog(contentHash)` resolves (`ReplayScreen` drops `boardForContentHash`, fixing
   'unknownMap' for custom hashes).

6. **Builder** = lazy chunk (`features/builder/`), new views `maps` (`/maps`) + `mapEditor`
   (`/maps/:id/edit`) in `store/ui.ts` View union, auth-gated like `/history`. One persistent SVG
   canvas (react-zoom-pan-pinch + `boardView.ts` getCTM pixel→board projection — the only existing
   pointer primitive), staged workflow: Crop → Stops → Routes → Missions → Rules → Share/Publish,
   with an always-visible live validation panel (`validateContent` + `validateForPlay` run client-side;
   map-data is TS source, importable).

7. **Mission auto-generation** = pure deterministic util **in map-data** (`generate.ts` + `graph.ts`
   all-pairs Dijkstra; no server endpoint; seeded via `@trm/shared` `makeRng` — engine untouched).

8. **World crop**: Natural Earth land polygons as static JSON in `apps/web/public/world/`
   (`ne_110m_land.json`, `ne_50m_land.json` for crops < 30° lon-span; fetched at runtime — zero
   bundle impact under the Vite 5 pin; add attribution NOTICE — public domain). Projection:
   **equirectangular scaled by cos(midLat)** (locally aspect-true, invertible; clamp |lat| ≤ 80°,
   warn when lat-span > 60°). Pipeline: bbox clip (Sutherland–Hodgman) → Douglas–Peucker simplify
   (vertex caps) → project to 0-100 → round to 2 dp → `MapGeography`.

9. **Auth on new endpoints**: content-by-hash = plain `AccessTokenGuard` (players/spectators/guests
   all hold tokens; hash is an unguessable capability; `Cache-Control: private, immutable`).
   Authoring/share/clone = additional `RegisteredUserGuard` (403 when `req.user.isGuest` — claim
   already populated at `access-token.guard.ts:23`, no DB hit).

## Phases (each independently shippable; commit per phase after validation)

### Phase 1 — map-data foundations (no consumer changes)
- `packages/map-data/src/types.ts` — `MapGeography`, `MAP_RULE_KEYS`, `MapRules`, optional fields on `GameContent`.
- `packages/map-data/src/index.ts` — hash spread-if-defined; `OFFICIAL_MAPS` + `officialMapById`.
- `packages/map-data/src/validate.ts` — `validateGeography(geo): string[]` (finite coords in [-50,150],
  ≤400 rings, ≤15k vertices, ≥3/ring, sane baseView); `validateForPlay(content, rules, maxPlayers=5)`
  → `{errors, warnings}` (LONG ≥ 5×initialLongOffer; SHORT ≥ 5×initialShortOffer + ticketDrawCount;
  warnings for degenerate train counts).
- `packages/map-data/src/graph.ts` — `shortestDistances(cities, routes)` (all-pairs Dijkstra, min length per pair).
- `packages/map-data/src/generate.ts` — `generateTickets(...)` (spec below) + `RULE_BOUNDS`
  (trainCarsStart 15–90, stationsPerPlayer 0–5, longestPathBonus 0–30, stationBonus 0–10,
  initialLongOffer 0–2, initialShortOffer 1–4 with long+short ≥ minKeepInitial(2), ticketDrawCount 1–5).
- Tests: new v3 hash pin in `versions.spec.ts`; `hash-extension.spec.ts` (no-new-fields hashes byte-identical
  to pre-change literal; geography/rules change the hash); `validate-geography` / `validate-for-play` /
  `generate.spec.ts` (same seed ⇒ identical; sufficiency; endpoint coverage).

### Phase 2 — server: map selector + async board resolver (official-only; gameplay identical)
- `room.repo.ts` — `MapSelector`, `RoomSettings.map`, default `{source:'official', mapId:'taiwan'}`.
- `lobby.schemas.ts` — `MapSelectorSchema` (zod discriminated union) into `GameSettingsSchema`/`RoomView` (+ resolved `mapName {zh,en}` for display).
- `lobby.service.ts` — `start` resolves official selector via `officialMapById` (custom branch → 400 until Phase 3); replaces hardcoded `CONTENT_HASH`/`taiwanBoard()` (`:164,:179`).
- `ws/hub.ts` — resolver type widens; `await this.boardResolver(...)` at `:124`.
- `dev-seed.ts` / `health.controller.ts` — point at `OFFICIAL_MAPS[0]` (no-op).
- Tests: settings PATCH round-trip + invalid mapId 400; start still pins Taiwan hash; recovery specs green.

### Phase 3 — server: maps module (REST + custom start + async replayability)
New `apps/server/src/maps/` following lobby/auth patterns (zod → `createZodDto`, `@ApiTags` etc.):
- `maps.schemas.ts` — `MapDraftSchema` with hard caps (cities ≤120, routes ≤300, tickets ≤200, names ≤60,
  finite numbers, `MapRulesSchema` bounded by `RULE_BOUNDS`, geography caps mirroring `validateGeography`).
- `custom-map.repo.ts` / `map-content.repo.ts` — incl. `insertIfAbsent` (swallow E11000) and
  `existingHashes(hashes): Set<string>` for batch replayability.
- `maps.service.ts` — CRUD w/ ownership; `mintShareCode` (roomCode alphabet, len 8, unique-retry);
  `peekByCode` (never leaks ownerId); `cloneByCode` (deep copy, strip shareCode, name + ' (副本)');
  `resolveForStart(selector, hostUserId)` — assemble draft → `assertValidContent` + `validateGeography`
  + `validateForPlay` (errors ⇒ 400) → `hashContent` → `mapContents.insertIfAbsent` → `{board, contentHash, mapRules}`.
- `maps.controller.ts` — `GET/POST /api/v1/maps`, `GET/PUT/DELETE /:id`, `POST/DELETE /:id/share`,
  `GET /shared/:code`, `POST /shared/:code/clone`, `GET /content/:hash`. All `AccessTokenGuard`;
  authoring routes + new `auth/registered-user.guard.ts`.
- `history/history.repo.ts` — batch async `isReplayable`.
- Wire-up: `maps.module.ts` in `app.module.ts`; `GameModule` installs the DB-fallback `boardResolver`;
  `LobbyModule` uses `MapsService.resolveForStart` + PATCH-time ownership check for custom selectors.
- Tests (`mongodb-memory-server`, `createTestApp` pattern): `maps.e2e.spec.ts` (CRUD, guest 403,
  ownership, share/peek/clone redaction, content-by-hash with guest token, oversized 400);
  `lobby-custom-map.e2e.spec.ts` (draft → room → start publishes `mapContents`, bots play a tiny custom
  map to completion, replay loads, **draft deleted → replay still works**); hub recovery via `mapContents`.

### Phase 4 — web: catalog refactor (zero visible change)
- New `game/catalog.ts` (`ContentCatalog`, `buildCatalog`, `TAIWAN_CATALOG`), `game/contentCache.ts`
  (hash-keyed `resolveContent` — bundled sync path, REST fallback; per-hash status store),
  `components/CatalogContext.tsx` (defaults Taiwan; composes with `SandboxProvider`).
- `routeGeometry.ts` → memoized `computeRouteGeometry(content)`.
- Migrate consumers (`Board.tsx` module-scope iteration → component `useMemo`, `logModel`, `payments`,
  `tickets.ts`, `TicketPanel`/`TicketCard`, `GameScreen`, `ReplayScreen`), then delete `game/content.ts`.
- `Geography.tsx` → `TaiwanGeography` + `CustomGeography` + `GeographyLayer` switch.
- Tests: existing suites wrapped in `CatalogProvider`; `contentCache` race test (late fetch for hash A
  after switching to B is harmless — cache is hash-keyed, no singleton).

### Phase 5 — web: map picker + custom play/replay
- `net/rest.ts` (`RoomSettings.map`, `MapsApi`), `RoomScreen.tsx` picker in the game-settings fieldset
  (Segmented 官方/自訂 + host's map list; non-hosts see resolved map name), `GameScreen` loading veil
  until `useCatalog(snapshot.contentHash)` ready, i18n keys (zh-Hant + en) in `src/i18n/index.ts`.

### Phase 6 — web: builder (sub-phases; **invoke the frontend-design skill before building the UI**)
- 6a: `/maps` list + editor shell + Stops/Routes stages on blank canvas — `features/builder/`:
  `MapsScreen`, `editor/EditorScreen`, `editor/store.ts` (zustand: draft, stage, selection, undo ≤50,
  debounced 2s autosave PUT), `editor/EditorCanvas.tsx` (TransformWrapper + boardView CTM projection;
  panning disabled during entity drags), `stages/StopsStage` (click-place, drag-move, delete cascades
  routes/tickets with confirm), `stages/RoutesStage` (click A→B popover: length segmented 1/2/3/4/6/8
  with distance-suggested default, color swatches from `CARD_COLOR_TOKENS` + GRAY, tunnel toggle,
  ferry-loco stepper forcing GRAY, "make double" spawning the pair), `editor/ValidationPanel.tsx`
  (live errors/warnings; click chip → select/zoom offender).
- 6b: world crop — `geo/world.ts` (lazy fetch from `public/world/`), `geo/projection.ts`, `geo/clip.ts`
  (Sutherland–Hodgman), `geo/simplify.ts` (Douglas–Peucker + caps), `stages/CropStage.tsx` (drag crop
  rect, resize handles, live board-preview inset, lat-span warning; re-edit restores stored bbox).
- 6c: `stages/MissionsStage.tsx` (LONG/SHORT tables, add-row with distance-suggested value,
  auto-generate modal: counts + visible seed + reroll + replace-all warning + preview) and
  `stages/RulesStage.tsx` (steppers bounded by `RULE_BOUNDS`, default badges).
- 6d: `stages/ShareStage.tsx` (readiness checklist mirroring `resolveForStart`, share-code mint/copy/
  revoke, "create room with this map" shortcut); MapsScreen clone-by-code with peek preview.
- Tests: `geo/*` units (projection round-trip, clip/simplify fixtures + caps), editor store reducers
  (cascade deletes, double-pair invariants), ValidationPanel rendering, missions determinism.

### Phase 7 — hardening
Root `yarn turbo run typecheck lint test build`; verify main web chunk unchanged (builder is its own
chunk); update `packages/map-data/CLAUDE.md` (hash-extension rule; stale 46/90/46 counts → 39/68/42)
and server/web CLAUDE.md sections.

## Mission auto-generation spec (deterministic)

`generateTickets(cities, routes, { seed, longCount=6, shortCount=36, shortMinDistance=4 }): TicketDef[]`
1. Graph: undirected, weight = min route length per city pair; all-pairs Dijkstra (V ≤ 120).
2. Candidates: all pairs with finite distance `d`, sorted `(d desc, pairKey asc)` — total order.
3. Value = `d` (+1 if either endpoint `isIsland`), clamped ≥ 2.
4. LONG: greedy walk with per-endpoint usage limit starting at 1, relaxing +1 and re-walking until filled.
5. SHORT: band `shortMinDistance ≤ d < min(LONG distances)`; seeded weighted sampling (`makeRng(seed)`,
   integer weights `1000/(1+uses[a]+uses[b])`, cumulative-sum draw via `nextInt`) for endpoint spread.
6. Ids `TG${seed}_${i}`; apply replaces the whole ticket list (UI warns). Modal enforces minimum counts
   so `validateForPlay` passes for 5 players.

## Risks
- **Pinned hashes**: v2 hex `6eab6c6d…` must survive the `hashContent` change (spread-if-defined
  guarantees it; `hash-extension.spec.ts` + new v3 pin are the CI gates). Never rename/reorder digest keys.
- **Hidden info**: board content is public to all seats/spectators — no `redactFor`/wire change; keep
  `wire-game.e2e.spec.ts` green. The private surface is **drafts** (peek/clone responses shaped, no
  ownerId/shareCode leaks, no listing others' maps).
- **Untrusted drafts**: zod caps at PUT + full validation at start; engine perf bounded by caps +
  longestTrail's deterministic instruction budget; 16MB doc limit unreachable under vertex caps.
- **Async races (web)**: snapshot may arrive before content — render gate; hash-keyed cache means stale
  fetches can't clobber (never a "current content" singleton).
- **Recovery**: resolver failure must throw loudly, never silently fall back to Taiwan.
- **Guest TTL / deletion vs replay**: `mapContents` append-only; regression test deletes the draft and replays.
- **Bundle size**: world GeoJSON in `public/` (runtime fetch); builder lazy chunk; Vite stays ^5.
- **Geometry determinism**: round coords to 2 dp **before** hashing (re-publish of untouched draft ⇒ same hash).

## Verification
- Per phase: `yarn workspace @trm/map-data|@trm/server|@trm/web test / typecheck / lint`
  (server tests use mongodb-memory-server — no Docker needed); `yarn workspace @trm/server test --run wire-game`
  after server phases (leak gate); `yarn workspace @trm/web build` for chunk inspection; Phase 7 root turbo run.
- Manual dev loop: `docker compose up -d mongo` → server dev (+`TRM_BOT_DELAY_MS=0`) → web dev → Scalar
  `/docs` lists maps endpoints.
- End-to-end demo: account A → `/maps` → crop a region (e.g. Kyushu) → ~10 stops → routes incl. tunnel,
  ferry, double pair → auto-generate missions (same seed ⇒ identical reroll) → rules (trainCarsStart 30)
  → validation green → mint share code → account B clones → B hosts room with the map + 2 bots → play to
  completion → kill/restart server mid-game (recovery resolves via `mapContents`) → History → replay
  renders the custom map → delete draft → replay still works.
