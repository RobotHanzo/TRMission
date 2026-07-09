# Taiwan map v4 (tw2.1 migration) — design

**Date:** 2026-07-10
**Package:** `@trm/map-data` (with fallout in `@trm/engine`, `apps/web`)

## Goal

Replace the bundled official Taiwan map content with the author's `tw2.1.json` editor export
(36 cities, 76 routes, 84 tickets), while **keeping the existing hand-drawn coastline** and
respecting the content-hash / version-registry rules so already-persisted games still replay.

Source: `packages/map-data/tw2.1.json` (a custom-map editor draft: cuid ids, its own projected
land-rings geography, its own coordinate frame).

## Decisions (confirmed with the author)

1. **Geography:** keep the hand-drawn coast (`taiwan-geography.ts`) — coast + central-range relief +
   island blobs + compass. Do **not** adopt tw2.1's projected land-rings geography. The bundled map
   therefore stays `geography`-less (renders via `Geography()` / `GeographyLayer` fallback).
2. **Station placement:** *group-transform all* mainland stations. Fit one affine
   `old = A·new + t` from the 24 shared mainland cities, apply to every mainland station so the
   network adopts tw2.1's relative arrangement, re-registered on the current coast. Islands + Mazu
   are placed by hand on the existing blobs.
3. **IDs & names:** readable English city ids (existing for the 30 shared; new: `shalu`, `jiji`,
   `huwei`, `guishan`, `zuoying`, `pingxi`). English names use old-codebase spellings for shared
   cities (Kaohsiung, Changhua, Chiayi, Hualien, Alishan, Matsu, Green Island, Orchid Island,
   Liuqiu), tw2.1's for new. **Everything else from tw2.1**: zh names, Chinese regions
   (北部/中部/南部/東部/離島), route/ticket topology, colors, lengths, ferry/tunnel/double flags,
   bows. Route & ticket ids kept **verbatim** from tw2.1 (opaque; only *city* endpoints remapped).
4. **Kaohsiung–Zuoying parallel:** tw2.1 has two ungrouped BLUE/1 edges. Recolour one **RED** and
   group the pair as a double (**group K**).
5. **龜山島 / 小琉球:** set `isIsland: true` (tw2.1 had them `false`).

## City set

- **Keep 30** shared: taipei, banqiao, taoyuan, hsinchu, zhunan, miaoli, taichung, changhua, nantou,
  douliu, chiayi, tainan, kaohsiung, pingtung, chaozhou, keelung, hualien, yilan, luodong, taitung,
  chishang, yuli, alishan, hengchun, matsu, kinmen, penghu, greenisland, orchidisland, liuqiu.
- **Add 6:** 沙鹿 `shalu`, 集集 `jiji`, 虎尾 `huwei`, 龜山島 `guishan`, 左營 `zuoying`, 平溪 `pingxi`.
- **Drop 9:** ruifang, tamsui, zhongli, fengyuan, sunmoonlake, dawu, zhiben, suao, toucheng.

## Coordinate transform

Affine fitted from the 24 shared mainland correspondences (mean err 3.45, max 7.1 board units):

```
old_x = 1.0574*nx - 0.0887*ny - 3.4447
old_y = 0.2071*nx + 1.3356*ny - 40.8322
```

Applied to all mainland stations (shared + the 6 new). **Hand-polish** afterward: stagger the
north cluster (taipei/banqiao/taoyuan/keelung land in a tight y≈11–12 row), and nudge any point
outside `TAIWAN_OUTLINE`. Islands + Mazu use fixed hand positions on the existing blobs:
matsu (24,7), kinmen (4,33), penghu (16,50), greenisland (65,70), orchidisland (68,85),
liuqiu (33,78). 龜山島 keeps its transformed offshore-NE position (~73.7, 28) and gets a new blob.

## Content stats (post-edit, for `content.spec.ts`)

cityCount 36 · routeCount 75 · distinctPairCount 64 · doublePairCount **11** · tunnelCount 9 ·
ferryCount 14 · ferryLocoSymbols 26 · totalTrackLength 221 · ticketCount 84 · longTicketCount 9.
colorBalance: ORANGE 6, GREEN 5, YELLOW 7, PURPLE 6, **RED 7**, GRAY 26, **BLUE 6**, BLACK 5,
WHITE 7. Fully connected; no length-5/7 routes; all ferries GRAY; no ferry/tunnel/double overlaps.
Passes `validateContent()` (verified against raw tw2.1 with a mirror pre-check).

> **Follow-up (post-v4):** the lone ORANGE 臺北–板橋 single (old `R1`) that ran beside the group-H
> double was dropped; its former gray partner (old `R70`) took `R1`, and `R71`–`R76` shifted forward
> to `R70`–`R75`. This is an in-place correction to v4 (never deployed, no persisted games), so the
> v4 hash was simply re-pinned rather than a v5 archived — routeCount 76→75, ORANGE 7→6,
> totalTrackLength 222→221 (reflected above).

## Version / registry (load-bearing — ADR A6/A13)

- Bump live `MAP_META.version` 3 → 4; rewrite `cities.ts` / `routes.ts` / `tickets.ts`.
- **Freeze v3** as `archive/v3.ts` — full literal cities/routes/tickets (v4 diverges in all three).
- **Freeze v2's cities/tickets as literals** by repointing `archive/v2.ts` to the frozen v3 tables
  (`CITIES_V3` / `TICKETS_V3`); v2's routes are already a literal. Today `archive/v2.ts` *references*
  the live tables, which are changing — leaving it would drift the pinned v2 hash.
- `CONTENT_REGISTRY` = `[CONTENT_V2, CONTENT_V3, TAIWAN_CONTENT]`.
- `versions.spec.ts`: pin the v3 hash (new tripwire), keep the v2 pin, update the "current is
  version N" / R77 assertions to describe v3 vs v4 instead of v2 vs v3.

## Fallout to update

- **map-data:** `content.spec.ts` (counts/colorBalance above), `versions.spec.ts`.
- **geometry.ts:** prune `BOW_OVERRIDE` (references dead old route ids R81/R17/R14/R70/R85/R18/
  R91/R92); v4 carries its own authored `bow` values.
- **taiwan-geography.ts:** add a small 龜山島 blob (~73.7, 28); everything else unchanged.
- **engine:** `board-registry.spec.ts` (rewrite to resolve v2/v3/v4 by hash instead of hardcoding
  R77); regenerate `test/golden/off-mode.json` (its frozen action log is on the old map) via the
  procedure documented in `off-mode-identity.spec.ts`.
- **web:** `game/lod.ts` + `lod.test.ts` (tier sets reference dropped ids), `EventsPanel.test.tsx`,
  `game/routeGeometry.test.ts` (old-id fixtures).

Everything else (engine board build, web catalog, server) derives from `TAIWAN_CONTENT`, so no code
changes beyond content + the hardcoded-id spots above.

## Implementation order

1. Spec (this doc) → commit.
2. Generator script (scratchpad): tw2.1 → final `cities.ts`/`routes.ts`/`tickets.ts` with transform,
   id remap, name/region/isIsland overrides, Zuoying RED+group K, coordinate polish overrides.
3. Freeze `archive/v3.ts`; repoint `archive/v2.ts`.
4. Write the three v4 tables; update `index.ts` (version 4, register v3).
5. `geometry.ts` prune; `taiwan-geography.ts` blob.
6. Update map-data tests → `yarn workspace @trm/map-data test`.
7. Engine: rewrite `board-registry.spec.ts`; regenerate golden → engine test.
8. Web test updates → web test.
9. Full `typecheck` / `lint` / `test`; run the app / OG card to eyeball the coast fit; commit.

## Risks

- Transform residuals mean the north metro needs hand-polish; verify every dot sits inside
  `TAIWAN_OUTLINE` and labels don't collide at the home zoom (visual check via the app / OG card).
- `off-mode.json` regen changes the fixture's digest — expected (it pins engine determinism, not the
  map). Keep it a valid game on the new map.
