# Builder: station-priority config + parallel-track control position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let map-builder authors set a per-station priority (major/secondary/tertiary/minor) that
drives the live board's existing zoom-based label reveal, and fix the parallel-tracks `[1][2][3]`
control so it always sits directly above Save/Cancel instead of below it in the edit-route form.

**Architecture:** Add an optional `tier` field to `CityDef`/`CityDraft` that flows the existing
builder draft → REST → Mongo → `GameContent` pipeline unchanged (spread-through, no new wiring).
Replace the live board's hardcoded-by-id LOD lookup (`apps/web/src/game/lod.ts`) with a
content-driven one in `apps/web/src/game/content.ts`. Deduplicate the parallel-tracks control in
`RoutesStage.tsx` into one controlled component instead of two copies in different DOM positions.

**Tech Stack:** TypeScript, React, Zustand (web), NestJS + Zod (server), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-10-builder-station-priority-and-parallel-track-position-design.md`

## Global Constraints

- UI strings ship in **Traditional Chinese (primary) + English** — every new i18n key needs both
  blocks in `apps/web/src/i18n/index.ts`.
- `tier` is **optional**, not required, on `CityDef`/`CityDraft` (see spec Decision 2) — this means
  no existing test fixture anywhere in the repo needs to change to keep compiling.
- Editing Taiwan's `packages/map-data/src/cities.ts` in place (no archive, no `MAP_META.version`
  bump) is intentional per the spec — the current v4 content is unreleased.
- Multiple agents may share this worktree: before any commit, run `git status`/`git diff` and stage
  only the files this task actually touched — never `git add -A`/`git add .`.
- Commit once each task's own tests (and any test suite it touches) pass — don't batch commits
  across tasks.
- Stay on `main`; do not create branches.

---

### Task 1: Station-tier data model (`@trm/map-data`)

**Files:**
- Modify: `packages/map-data/src/types.ts:3-12`
- Modify: `packages/map-data/src/cities.ts` (whole file)
- Modify: `packages/map-data/test/content.spec.ts`
- Modify: `packages/map-data/test/versions.spec.ts:88-93`
- Test: `packages/map-data/test/content.spec.ts` (same file — see above)

**Interfaces:**
- Produces: `export type CityTier = 'major' | 'secondary' | 'tertiary' | 'minor';` and
  `readonly tier?: CityTier;` on `CityDef`, both from `packages/map-data/src/types.ts`, re-exported
  from `@trm/map-data`'s package root via the existing `export * from './types';` in `index.ts` (no
  change needed there). Every later task that reads a city's tier does
  `city.tier ?? 'minor'`.

- [ ] **Step 1: Add the `CityTier` type and optional `tier` field to `CityDef`**

Edit `packages/map-data/src/types.ts`. The current `CityDef` (lines 3-12) is:

```typescript
export interface CityDef {
  readonly id: CityId;
  readonly nameZh: string;
  readonly nameEn: string;
  /** Relative map position: x 0 (west) … 100 (east), y 0 (north) … 100 (south). */
  readonly x: number;
  readonly y: number;
  readonly region: string;
  readonly isIsland: boolean;
}
```

Replace it with:

```typescript
export type CityTier = 'major' | 'secondary' | 'tertiary' | 'minor';

export interface CityDef {
  readonly id: CityId;
  readonly nameZh: string;
  readonly nameEn: string;
  /** Relative map position: x 0 (west) … 100 (east), y 0 (north) … 100 (south). */
  readonly x: number;
  readonly y: number;
  readonly region: string;
  readonly isIsland: boolean;
  /** Cartographic label tier driving the live board's progressive zoom reveal (see the web
   *  layer's game/content.ts `cityTier` + game/lod.ts `zoomBucket`). Optional so pre-existing
   *  authored content and test fixtures that predate this field keep hashing identically
   *  (`stableStringify` drops absent keys) — absent reads as `'minor'` everywhere it's consumed. */
  readonly tier?: CityTier;
}
```

- [ ] **Step 2: Write the failing test for the Taiwan tier migration**

Edit `packages/map-data/test/content.spec.ts`. Insert a new `it` block right after the "produces a
stable content hash" test (after line 45, before `it('catches a broken graph...`):

```typescript
  it('assigns tier matching the retired lod.ts major/secondary/tertiary lists', () => {
    const major = new Set([
      'taipei',
      'hsinchu',
      'taichung',
      'chiayi',
      'tainan',
      'kaohsiung',
      'hualien',
      'taitung',
      'yilan',
      'hengchun',
    ]);
    const secondary = new Set([
      'keelung',
      'taoyuan',
      'miaoli',
      'changhua',
      'douliu',
      'pingtung',
      'nantou',
      'alishan',
      'yuli',
      'luodong',
    ]);
    const tertiary = new Set(['zhunan', 'banqiao', 'shalu', 'huwei', 'zuoying', 'chaozhou']);
    for (const city of TAIWAN_CONTENT.cities) {
      const id = city.id as string;
      const expected = major.has(id)
        ? 'major'
        : secondary.has(id)
          ? 'secondary'
          : tertiary.has(id)
            ? 'tertiary'
            : 'minor';
      expect(city.tier ?? 'minor').toBe(expected);
    }
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn workspace @trm/map-data test --run content.spec`
Expected: FAIL — every city in the `major`/`secondary`/`tertiary` sets currently has `tier`
`undefined` (→ falls back to `'minor'`), so the assertion mismatches for those 26 cities.

- [ ] **Step 4: Migrate `cities.ts` to set explicit tiers**

Replace the full contents of `packages/map-data/src/cities.ts` with:

```typescript
import type { CityId } from '@trm/shared';
import { asCityId } from '@trm/shared';
import type { CityDef, CityTier } from './types';

const c = (
  id: string,
  nameZh: string,
  nameEn: string,
  x: number,
  y: number,
  region: string,
  isIsland = false,
  tier: CityTier = 'minor',
): CityDef => ({ id: asCityId(id), nameZh, nameEn, x, y, region, isIsland, tier });

/** 36 cities — Taiwan map v4 (the tw2.1 network). The station graph is authored in the map
 *  editor and imported here; each mainland stop's editor position is mapped onto the bundled
 *  hand-drawn coast by a single affine fit (see docs/superpowers/specs/2026-07-10-taiwan-map-v4),
 *  the outlying islands + Matsu are pinned by hand onto their existing coastline blobs. Regions and
 *  zh names come from the editor; the 30 stations shared with the previous map keep their canonical
 *  English spellings. Coordinates are x 0 (west)…100 (east), y 0 (north)…100 (south). `tier`
 *  drives the live board's progressive label reveal (game/content.ts's cityTier +
 *  game/lod.ts's zoomBucket) — matches the id sets that were previously hardcoded there. */
export const CITIES: readonly CityDef[] = [
  c('matsu', '馬祖', 'Matsu', 24, 7, '離島', true),
  c('kinmen', '金門', 'Kinmen', 4, 33, '離島', true),
  c('penghu', '澎湖', 'Penghu', 16, 50, '離島', true),
  c('greenisland', '綠島', 'Green Island', 65, 70, '東部', true),
  c('orchidisland', '蘭嶼', 'Orchid Island', 68, 85, '東部', true),
  c('taipei', '臺北', 'Taipei', 61.8, 12.8, '北部', false, 'major'),
  c('banqiao', '板橋', 'Banqiao', 59.3, 14.6, '北部', false, 'tertiary'),
  c('taoyuan', '桃園', 'Taoyuan', 55.2, 14, '北部', false, 'secondary'),
  c('hsinchu', '新竹', 'Hsinchu', 50.8, 17.6, '北部', false, 'major'),
  c('zhunan', '竹南', 'Zhunan', 47.8, 19.5, '中部', false, 'tertiary'),
  c('miaoli', '苗栗', 'Miaoli', 49.2, 27.1, '中部', false, 'secondary'),
  c('shalu', '沙鹿', 'Shalu', 41.4, 29, '中部', false, 'tertiary'),
  c('taichung', '臺中', 'Taichung', 43.4, 35.7, '中部', false, 'major'),
  c('changhua', '彰化', 'Changhua', 35.6, 38.3, '中部', false, 'secondary'),
  c('nantou', '南投', 'Nantou', 48.4, 39.4, '中部', false, 'secondary'),
  c('douliu', '斗六', 'Douliu', 41, 45.8, '中部', false, 'secondary'),
  c('chiayi', '嘉義', 'Chiayi', 36.9, 53.8, '南部', false, 'major'),
  c('tainan', '臺南', 'Tainan', 31.8, 58.2, '南部', false, 'major'),
  c('kaohsiung', '高雄', 'Kaohsiung', 33.9, 68.8, '南部', false, 'major'),
  c('pingtung', '屏東', 'Pingtung', 39.7, 73.7, '南部', false, 'secondary'),
  c('chaozhou', '潮州', 'Chaozhou', 40.2, 78.1, '南部', false, 'tertiary'),
  c('keelung', '基隆', 'Keelung', 66.5, 10.5, '北部', false, 'secondary'),
  c('hualien', '花蓮', 'Hualien', 61.6, 39.7, '東部', false, 'major'),
  c('yilan', '宜蘭', 'Yilan', 65, 22, '北部', false, 'major'),
  c('luodong', '羅東', 'Luodong', 66.3, 28, '北部', false, 'secondary'),
  c('taitung', '臺東', 'Taitung', 53.5, 65.8, '東部', false, 'major'),
  c('chishang', '池上', 'Chishang', 57.1, 56, '東部'),
  c('yuli', '玉里', 'Yuli', 59, 47.7, '東部', false, 'secondary'),
  c('alishan', '阿里山', 'Alishan', 45.5, 53.9, '南部', false, 'secondary'),
  c('jiji', '集集', 'JiJi', 46, 45.3, '中部'),
  c('huwei', '虎尾', 'Huwei', 35.7, 46, '中部', false, 'tertiary'),
  c('guishan', '龜山島', 'Guishan Island', 73.7, 28, '北部', true),
  c('hengchun', '恆春', 'Hengchun', 43, 85.2, '南部', false, 'major'),
  c('liuqiu', '小琉球', 'Liuqiu', 33, 78, '南部', true),
  c('zuoying', '左營', 'Zuoying', 31.5, 63.6, '南部', false, 'tertiary'),
  c('pingxi', '平溪', 'Pingxi', 64.8, 16.8, '北部'),
];

export const CITY_IDS: readonly CityId[] = CITIES.map((x) => x.id);
```

(Note: `c(...)` now always sets `tier` — even the default-`'minor'` calls get it explicitly via the
default parameter, so `Object.keys` on every returned city includes `tier`; this is fine and
expected, matching Decision 2's "Taiwan sets this explicitly for every city.")

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/map-data test --run content.spec`
Expected: PASS

- [ ] **Step 6: Update the pinned v4 content hash**

Run: `yarn workspace @trm/map-data test --run versions.spec`
Expected: FAIL on `'pins the v4 (current) content hash'` — the assertion's expected string
(`'45581204915bfa0d947bdacf54ec81ab07c19a7941dba82fbbe1074bef7ac581'` at
`packages/map-data/test/versions.spec.ts:91`) no longer matches, because every Taiwan city now
carries a `tier` key. The failure output prints the actual received hash (vitest's diff for
`toBe`). Copy that actual value and replace the expected string at line 91.

Then re-run: `yarn workspace @trm/map-data test --run versions.spec`
Expected: PASS (all tests in the file, including the "every archived version is itself a
structurally valid map" and "resolves each archived version" tests, which are unaffected since
`CONTENT_V2`/`CONTENT_V3` are untouched literal archives).

- [ ] **Step 7: Run the full map-data suite and typecheck**

Run: `yarn workspace @trm/map-data test`
Expected: PASS (all files)

Run: `yarn workspace @trm/map-data typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/map-data/src/types.ts packages/map-data/src/cities.ts packages/map-data/test/content.spec.ts packages/map-data/test/versions.spec.ts
git commit -m "feat(map-data): add optional station tier, migrate Taiwan off hardcoded lod.ts lists"
```

---

### Task 2: Server accepts and persists station tier

**Files:**
- Modify: `apps/server/src/maps/maps.schemas.ts:21-29`
- Test: `apps/server/test/maps.e2e.spec.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the `@trm/map-data` package already resolving.
- Produces: `CityDraftSchema` now accepts an optional `tier` field that round-trips through
  `PUT /api/v1/maps/:id` → Mongo → `GET /api/v1/maps/:id`. `draftFromDto` needs **no code change**
  — it already spreads `c` for every city field.

- [ ] **Step 1: Write the failing e2e test**

Edit `apps/server/test/maps.e2e.spec.ts`. Insert a new `it` block inside the existing
`describe('maps: CRUD', ...)`, right after the first test (after line 73, before the "404s..."
test):

```typescript
  it('round-trips an authored station tier through update and read', async () => {
    const a = await registered('mapowner-tier@example.com', 'OwnerTier');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: 'X', nameEn: 'X' })
      .expect(201);
    const id: string = created.body.id;

    const draftWithTier = {
      ...tinyDraft,
      cities: [{ ...tinyDraft.cities[0], tier: 'major' }, tinyDraft.cities[1]],
    };
    const updated = await request(server())
      .put(`/api/v1/maps/${id}`)
      .set(auth(a.token))
      .send({ draft: draftWithTier })
      .expect(200);
    const updatedCity = updated.body.draft.cities.find((c: { id: string }) => c.id === 'm1');
    expect(updatedCity.tier).toBe('major');

    const got = await request(server()).get(`/api/v1/maps/${id}`).set(auth(a.token)).expect(200);
    const gotCity = got.body.draft.cities.find((c: { id: string }) => c.id === 'm1');
    expect(gotCity.tier).toBe('major');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run maps.e2e`
Expected: FAIL — `updatedCity.tier` is `undefined` (zod's default `z.object` behavior strips any
key not declared in the schema), not `'major'`.

- [ ] **Step 3: Add `tier` to `CityDraftSchema`**

Edit `apps/server/src/maps/maps.schemas.ts`. The current schema (lines 21-29) is:

```typescript
export const CityDraftSchema = z.object({
  id: idString,
  nameZh: name60,
  nameEn: name60,
  x: z.number().finite(),
  y: z.number().finite(),
  region: z.string().max(60),
  isIsland: z.boolean(),
});
```

Replace it with:

```typescript
export const CityDraftSchema = z.object({
  id: idString,
  nameZh: name60,
  nameEn: name60,
  x: z.number().finite(),
  y: z.number().finite(),
  region: z.string().max(60),
  isIsland: z.boolean(),
  tier: z.enum(['major', 'secondary', 'tertiary', 'minor']).optional(),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run maps.e2e`
Expected: PASS

- [ ] **Step 5: Run the full server test suite and typecheck**

Run: `yarn workspace @trm/server test`
Expected: PASS

Run: `yarn workspace @trm/server typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/maps/maps.schemas.ts apps/server/test/maps.e2e.spec.ts
git commit -m "feat(server): accept and persist an optional station tier on custom-map cities"
```

---

### Task 3: Builder UI — station priority selector

**Files:**
- Modify: `apps/web/src/net/rest.ts:151-159`
- Modify: `apps/web/src/i18n/index.ts:437` and `:995` (insertion points; exact line numbers shift
  slightly once earlier keys are inserted — insert immediately after the `isIsland` line in each
  locale block)
- Modify: `apps/web/src/features/builder/editor/stages/StopsStage.tsx`
- Test: `apps/web/src/features/builder/editor/stages/StopsStage.test.tsx`
- Test: `apps/web/src/features/builder/editor/contentAdapter.test.ts`

**Interfaces:**
- Consumes: nothing new from Tasks 1-2 (this task only touches the web client's own draft type,
  which is independently declared, not imported from `@trm/map-data`).
- Produces: `CityDraft.tier?: string` on `apps/web/src/net/rest.ts`'s `CityDraft`, consumed by
  `StopsStage.tsx`'s new selector and (unmodified) by `contentAdapter.ts`'s existing spread.

- [ ] **Step 1: Add `tier` to the web `CityDraft` type**

Edit `apps/web/src/net/rest.ts`. The current `CityDraft` (lines 151-159) is:

```typescript
export interface CityDraft {
  id: string;
  nameZh: string;
  nameEn: string;
  x: number;
  y: number;
  region: string;
  isIsland: boolean;
}
```

Replace it with:

```typescript
export interface CityDraft {
  id: string;
  nameZh: string;
  nameEn: string;
  x: number;
  y: number;
  region: string;
  isIsland: boolean;
  tier?: string;
}
```

- [ ] **Step 2: Add the i18n keys**

Edit `apps/web/src/i18n/index.ts`. In the zh-Hant block, find this line (currently at line 437):

```typescript
        isIsland: '離島',
```

Insert immediately after it:

```typescript
        stationPriority: '車站優先度',
        tierMajor: '主要',
        tierSecondary: '次要',
        tierTertiary: '一般',
        tierMinor: '小站',
```

In the English block, find this line (currently at line 995):

```typescript
        isIsland: 'Island',
```

Insert immediately after it:

```typescript
        stationPriority: 'Station priority',
        tierMajor: 'Major',
        tierSecondary: 'Secondary',
        tierTertiary: 'Tertiary',
        tierMinor: 'Minor',
```

- [ ] **Step 3: Write the failing StopsStage tests**

Edit `apps/web/src/features/builder/editor/stages/StopsStage.test.tsx`. Add two new `it` blocks
inside the `describe('StopsStage', ...)` block (anywhere after the existing tests, before the
closing `});`):

```typescript
  it('shows minor selected by default for a station with no tier set', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));

    const group = screen.getByRole('radiogroup', { name: '車站優先度' });
    expect(within(group).getByRole('radio', { name: '小站' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('selecting a priority updates the station tier', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));

    const group = screen.getByRole('radiogroup', { name: '車站優先度' });
    fireEvent.click(within(group).getByRole('radio', { name: '主要' }));

    const city = useEditorStore.getState().draft.cities.find((c) => c.id === 'c1');
    expect(city?.tier).toBe('major');
  });
```

These use `within`, which is not yet imported in this file. Update the top import line from:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
```

to:

```typescript
import { render, screen, fireEvent, within } from '@testing-library/react';
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run StopsStage`
Expected: FAIL — no element with role `radiogroup` named `車站優先度` exists yet.

- [ ] **Step 5: Add the Segmented control to `StopsStage.tsx`**

Edit `apps/web/src/features/builder/editor/stages/StopsStage.tsx`. Add the import (after the
existing `Switch` import, so the top of the file reads):

```typescript
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Move, Trash2 } from 'lucide-react';
import { Segmented } from '../../../../components/ui/Segmented';
import { Switch } from '../../../../components/ui/Switch';
import { EditorCanvas } from '../EditorCanvas';
import { useEditorStore } from '../store';
```

Then, in the inspector JSX, the current `isIsland` block is:

```typescript
            <div className="row between setting-row">
              <span className="field-label">{t('builder.isIsland')}</span>
              <Switch
                checked={selected.isIsland}
                onChange={(v) => updateCity(selected.id, { isIsland: v })}
                label={t('builder.isIsland')}
              />
            </div>
```

Insert this new block immediately after it (before the `<button type="button" onClick={() =>
setIsMoving...` line):

```typescript
            <div className="field">
              <span className="field-label">{t('builder.stationPriority')}</span>
              <Segmented<string>
                options={[
                  { value: 'major', label: t('builder.tierMajor') },
                  { value: 'secondary', label: t('builder.tierSecondary') },
                  { value: 'tertiary', label: t('builder.tierTertiary') },
                  { value: 'minor', label: t('builder.tierMinor') },
                ]}
                value={selected.tier ?? 'minor'}
                onChange={(v) => updateCity(selected.id, { tier: v })}
                ariaLabel={t('builder.stationPriority')}
              />
            </div>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run StopsStage`
Expected: PASS

- [ ] **Step 7: Add a confidence test that tier survives `draftToContent`**

Edit `apps/web/src/features/builder/editor/contentAdapter.test.ts`. Add a new `describe` block
after the existing `draftToContent` one (or a new `it` inside it — either is fine; add as a new
`it` inside the existing `describe('draftToContent', ...)` block):

```typescript
  it('carries an authored city tier into content', () => {
    const draftWithCity: MapDraft = {
      cities: [
        { id: 'a', nameZh: '甲', nameEn: 'A', x: 0, y: 0, region: 'r', isIsland: false, tier: 'major' },
      ],
      routes: [],
      tickets: [],
    };
    const content = draftToContent(draftWithCity, { nameZh: 'x', nameEn: 'x' });
    expect(content.cities[0]!.tier).toBe('major');
  });
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run contentAdapter`
Expected: PASS (no code change was needed for this one — `contentAdapter.ts`'s existing
`{ ...c, id: asCityId(c.id) }` spread already carries `tier` through; this test locks in that
behavior).

- [ ] **Step 9: Run the full web test suite and typecheck**

Run: `yarn workspace @trm/web test`
Expected: PASS

Run: `yarn workspace @trm/web typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/i18n/index.ts apps/web/src/features/builder/editor/stages/StopsStage.tsx apps/web/src/features/builder/editor/stages/StopsStage.test.tsx apps/web/src/features/builder/editor/contentAdapter.test.ts
git commit -m "feat(web): station priority selector in the map builder's Stops stage"
```

---

### Task 4: Render tier from content instead of hardcoded id lists

**Files:**
- Modify: `apps/web/src/game/content.ts:1-32`
- Create: `apps/web/src/game/content.test.ts`
- Modify: `apps/web/src/game/lod.ts` (whole file)
- Modify: `apps/web/src/game/lod.test.ts` (whole file)
- Modify: `apps/web/src/components/Board.tsx:20,29`

**Interfaces:**
- Consumes: `CityDef.tier?: CityTier` from Task 1 (already live in `@trm/map-data`).
- Produces: `export const cityTier = (id: string): CityTier => ...` from
  `apps/web/src/game/content.ts`, replacing the same-named export that used to live in
  `apps/web/src/game/lod.ts`. `Board.tsx` is the only other consumer in the codebase (confirmed via
  repo-wide search during planning).

- [ ] **Step 1: Write the failing `content.test.ts`**

Create `apps/web/src/game/content.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cityTier } from './content';

describe('cityTier', () => {
  it('classifies hub + landmark cities as major', () => {
    expect(cityTier('taipei')).toBe('major');
    expect(cityTier('kaohsiung')).toBe('major');
    expect(cityTier('hengchun')).toBe('major');
  });

  it('classifies prominent metros / county seats as secondary', () => {
    expect(cityTier('taoyuan')).toBe('secondary');
    expect(cityTier('changhua')).toBe('secondary');
    expect(cityTier('pingtung')).toBe('secondary');
  });

  it('classifies district towns / junctions as tertiary', () => {
    expect(cityTier('zhunan')).toBe('tertiary');
    expect(cityTier('chaozhou')).toBe('tertiary');
  });

  it('defaults the smallest stations to minor', () => {
    expect(cityTier('jiji')).toBe('minor');
    expect(cityTier('chishang')).toBe('minor');
  });

  it('falls back to minor for an id outside the active content', () => {
    expect(cityTier('not-a-real-city')).toBe('minor');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run game/content`
Expected: FAIL — `cityTier` is not exported from `./content` yet (import error).

- [ ] **Step 3: Add `cityTier` to `game/content.ts`**

Edit `apps/web/src/game/content.ts`. Change the import line (currently line 2):

```typescript
import type { CityDef, GameContent, RouteDef, TicketDef } from '@trm/map-data';
```

to:

```typescript
import type { CityDef, CityTier, GameContent, RouteDef, TicketDef } from '@trm/map-data';
```

Then, immediately after the existing `cityName` export (currently lines 29-32):

```typescript
export const cityName = (id: string, locale: Locale): string => {
  const c = cityById.get(id);
  return c ? (locale === 'en' ? c.nameEn : c.nameZh) : id;
};
```

add:

```typescript

/** Cartographic label tier for the live board's progressive zoom reveal (see game/lod.ts's
 *  zoomBucket + the [data-zoom] CSS rules). Reads the active content's authored tier, falling
 *  back to 'minor' for content authored before this field existed, or an id outside the active
 *  map — the same graceful-fallback shape cityName already uses. */
export const cityTier = (id: string): CityTier => cityById.get(id)?.tier ?? 'minor';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run game/content`
Expected: PASS

- [ ] **Step 5: Strip the hardcoded id lists from `lod.ts`**

Replace the full contents of `apps/web/src/game/lod.ts` with:

```typescript
// Cartographic level-of-detail: live zoom scale → level-of-detail bucket, used to gate which
// city labels are visible at the current zoom (see game/content.ts's cityTier for the per-city
// tier itself — authored content, not hardcoded here).

export type ZoomBucket = 'far' | 'regional' | 'district' | 'local';

/**
 * Live zoom → level-of-detail bucket. Boundaries thin out the dense corridors when zoomed out:
 * `far` keeps only majors, `regional` adds secondary, `district` adds tertiary, and `local`
 * (the framed home view's zoom and tighter) reveals every minor station.
 */
export const zoomBucket = (scale: number): ZoomBucket =>
  scale < 1.25 ? 'far' : scale < 1.7 ? 'regional' : scale < 2.4 ? 'district' : 'local';
```

- [ ] **Step 6: Trim `lod.test.ts` to only the `zoomBucket` tests**

Replace the full contents of `apps/web/src/game/lod.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { zoomBucket } from './lod';

describe('zoomBucket', () => {
  it('maps scale to four ascending level-of-detail buckets', () => {
    expect(zoomBucket(0.8)).toBe('far');
    expect(zoomBucket(1.24)).toBe('far');
    expect(zoomBucket(1.25)).toBe('regional');
    expect(zoomBucket(1.69)).toBe('regional');
    expect(zoomBucket(1.7)).toBe('district');
    expect(zoomBucket(2.39)).toBe('district');
    expect(zoomBucket(2.4)).toBe('local');
    expect(zoomBucket(8)).toBe('local');
  });

  it('keeps the home view (initialScale 1.9) at district, not full detail', () => {
    expect(zoomBucket(1.9)).toBe('district');
  });
});
```

- [ ] **Step 7: Point `Board.tsx` at the new `cityTier`**

Edit `apps/web/src/components/Board.tsx`. Change line 20 from:

```typescript
import { CITIES, ROUTES, cityById, routeById, cityName } from '../game/content';
```

to:

```typescript
import { CITIES, ROUTES, cityById, routeById, cityName, cityTier } from '../game/content';
```

Change line 29 from:

```typescript
import { zoomBucket, cityTier } from '../game/lod';
```

to:

```typescript
import { zoomBucket } from '../game/lod';
```

No other line changes — `cityTier={cityTier}` (line 680) already refers to the same identifier
name, now sourced from `game/content` instead of `game/lod`.

- [ ] **Step 8: Run the affected test files**

Run: `yarn workspace @trm/web test --run game/lod`
Expected: PASS

Run: `yarn workspace @trm/web test --run game/content`
Expected: PASS

Run: `yarn workspace @trm/web test --run Board`
Expected: PASS

Run: `yarn workspace @trm/web test --run MapScene`
Expected: PASS

- [ ] **Step 9: Run the full web test suite and typecheck**

Run: `yarn workspace @trm/web test`
Expected: PASS

Run: `yarn workspace @trm/web typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/game/content.ts apps/web/src/game/content.test.ts apps/web/src/game/lod.ts apps/web/src/game/lod.test.ts apps/web/src/components/Board.tsx
git commit -m "refactor(web): drive city label tier from authored content, not hardcoded lod.ts lists"
```

---

### Task 5: Move the parallel-tracks control above Save/Cancel

**Files:**
- Modify: `apps/web/src/features/builder/editor/stages/RoutesStage.tsx` (whole file)
- Test: `apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx`

**Interfaces:**
- No cross-task dependency — fully independent of Tasks 1-4.
- Produces: `RouteForm`'s `parallelTracks?: { value: 1 | 2 | 3; onChange(v: 1 | 2 | 3): void }`
  prop, replacing the removed `hideDouble?: boolean` prop. No other file references
  `hideDouble` (confirmed during planning — it's only used within this file).

- [ ] **Step 1: Write the failing DOM-order tests**

Edit `apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx`. Add two new `it` blocks
inside the `describe('RoutesStage', ...)` block:

```typescript
  it('places the parallel-tracks control before the Save/Cancel row in the new-route form', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c3')); // c1-c3 is a brand-new pair
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    const saveButton = screen.getByText('儲存');
    expect(
      group.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('places the parallel-tracks control before the Save/Cancel row in the edit-route form', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    const group = screen.getByRole('radiogroup', { name: '平行軌道' });
    const saveButton = screen.getByText('儲存');
    expect(
      group.compareDocumentPosition(saveButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tests to verify the edit-route one fails**

Run: `yarn workspace @trm/web test --run RoutesStage`
Expected: the new-route test PASSES (already correctly positioned today); the edit-route test
FAILS (`compareDocumentPosition` shows the control currently renders *after* Save, so the
`DOCUMENT_POSITION_FOLLOWING` bit is not set on `saveButton` relative to `group` — the expression
evaluates falsy).

- [ ] **Step 3: Replace `hideDouble` with a controlled `parallelTracks` prop**

Replace the full contents of `apps/web/src/features/builder/editor/stages/RoutesStage.tsx` with:

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { TRAIN_COLORS, ROUTE_LENGTHS } from '@trm/shared';
import type { RouteColor, RouteLength } from '@trm/shared';
import { CARD_COLOR_TOKENS, GRAY_TOKEN } from '../../../../theme/colors';
import { Dropdown, type DropdownOption } from '../../../../components/ui/Dropdown';
import { Segmented } from '../../../../components/ui/Segmented';
import { Switch } from '../../../../components/ui/Switch';
import { EditorCanvas } from '../EditorCanvas';
import { useEditorStore, newRouteId } from '../store';
import type { RouteDraft } from '../../../../net/rest';

const ROUTE_COLORS: readonly RouteColor[] = [...TRAIN_COLORS, 'GRAY'];

export function RoutesStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const addRoute = useEditorStore((s) => s.addRoute);
  const updateRoute = useEditorStore((s) => s.updateRoute);
  const removeRoute = useEditorStore((s) => s.removeRoute);
  const setPairTrackCount = useEditorStore((s) => s.setPairTrackCount);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [draftPair, setDraftPair] = useState<{ a: string; b: string } | null>(null);

  const selectedRoute =
    selection?.kind === 'route' ? draft.routes.find((r) => r.id === selection.id) : undefined;

  const highlight = new Set<string>();
  if (pendingFrom) highlight.add(pendingFrom);
  if (draftPair) {
    highlight.add(draftPair.a);
    highlight.add(draftPair.b);
  }

  const cityName = (id: string): string => draft.cities.find((c) => c.id === id)?.nameZh ?? id;

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <EditorCanvas
          highlightCities={highlight}
          onCityClick={(id) => {
            select(null);
            if (!pendingFrom) {
              setPendingFrom(id);
              return;
            }
            if (id === pendingFrom) {
              setPendingFrom(null);
              return;
            }
            const existing = draft.routes.find(
              (r) => (r.a === pendingFrom && r.b === id) || (r.a === id && r.b === pendingFrom),
            );
            setPendingFrom(null);
            if (existing) {
              select({ kind: 'route', id: existing.id });
              return;
            }
            setDraftPair({ a: pendingFrom, b: id });
          }}
          onRouteClick={(id) => {
            setPendingFrom(null);
            setDraftPair(null);
            select({ kind: 'route', id });
          }}
          onBackgroundClick={() => {
            setPendingFrom(null);
            setDraftPair(null);
            select(null);
          }}
        />
        <p className="muted editor-hint">
          {pendingFrom ? t('builder.routesHintSecond') : t('builder.routesHintFirst')}
        </p>
      </div>
      <aside className="card stack editor-inspector">
        {draftPair ? (
          <RouteForm
            title={t('builder.newRoute', { a: cityName(draftPair.a), b: cityName(draftPair.b) })}
            initial={{
              id: newRouteId(),
              a: draftPair.a,
              b: draftPair.b,
              color: 'RED',
              length: 2,
              ferryLocos: 0,
              isTunnel: false,
            }}
            onCancel={() => setDraftPair(null)}
            onSubmit={(newRoute, trackCount) => {
              addRoute(newRoute);
              if (trackCount > 1) setPairTrackCount(newRoute.id, trackCount as 2 | 3);
              setDraftPair(null);
            }}
          />
        ) : selectedRoute ? (
          <RouteForm
            title={t('builder.editRoute', {
              a: cityName(selectedRoute.a),
              b: cityName(selectedRoute.b),
            })}
            initial={selectedRoute}
            parallelTracks={{
              value: Math.min(
                3,
                draft.routes.filter(
                  (r) =>
                    (r.a === selectedRoute.a && r.b === selectedRoute.b) ||
                    (r.a === selectedRoute.b && r.b === selectedRoute.a),
                ).length,
              ) as 1 | 2 | 3,
              onChange: (v) => setPairTrackCount(selectedRoute.id, v),
            }}
            onCancel={() => select(null)}
            onSubmit={(route) => updateRoute(selectedRoute.id, route)}
            extra={
              <button className="danger" onClick={() => removeRoute(selectedRoute.id)}>
                <Trash2 size={14} aria-hidden /> {t('builder.deleteRoute')}
              </button>
            }
          />
        ) : (
          <p className="muted">{t('builder.routesEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}

function RouteForm({
  title,
  initial,
  parallelTracks,
  onCancel,
  onSubmit,
  extra,
}: {
  title: string;
  initial: RouteDraft;
  parallelTracks?: { value: 1 | 2 | 3; onChange(v: 1 | 2 | 3): void };
  onCancel(): void;
  onSubmit(route: RouteDraft, trackCount: number): void;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  // Builder-authored data always conforms to these unions by construction (the <select>s below
  // only ever offer valid options) — the wire/store type is a plain string for JSON round-tripping.
  const [color, setColor] = useState<RouteColor>(initial.color as RouteColor);
  const [length, setLength] = useState<RouteLength>(initial.length as RouteLength);
  const [isTunnel, setIsTunnel] = useState(initial.isTunnel);
  const [ferryLocos, setFerryLocos] = useState(initial.ferryLocos);
  const [trackCount, setTrackCount] = useState(1);
  const isFerry = ferryLocos > 0;

  const colorOptions: DropdownOption<RouteColor>[] = ROUTE_COLORS.map((c) => {
    const token = c === 'GRAY' ? GRAY_TOKEN : CARD_COLOR_TOKENS[c];
    return {
      value: c,
      label: token.nameZh,
      render: (
        <span className="row color-option">
          <span className="color-swatch" style={{ background: token.hex }} aria-hidden />
          {token.nameZh}
        </span>
      ),
    };
  });

  return (
    <>
      <h3>{title}</h3>
      <label className="field">
        <span className="field-label">{t('builder.routeLength')}</span>
        <Segmented<string>
          options={ROUTE_LENGTHS.map((n) => ({ value: String(n), label: String(n) }))}
          value={String(length)}
          onChange={(v) => setLength(Number(v) as RouteLength)}
          ariaLabel={t('builder.routeLength')}
        />
      </label>
      <label className="field">
        <span className="field-label">{t('builder.routeColor')}</span>
        <Dropdown<RouteColor>
          options={colorOptions}
          value={color}
          onChange={setColor}
          ariaLabel={t('builder.routeColor')}
          disabled={isFerry}
        />
      </label>
      <div className="row between setting-row">
        <span className="field-label">{t('builder.isTunnel')}</span>
        <Switch
          checked={isTunnel}
          disabled={isFerry}
          onChange={setIsTunnel}
          label={t('builder.isTunnel')}
        />
      </div>
      <label className="field">
        <span className="field-label">{t('builder.ferryLocos')}</span>
        <input
          type="number"
          min={0}
          max={length}
          value={ferryLocos}
          onChange={(e) => {
            const n = Math.max(0, Math.min(length, Number(e.target.value) || 0));
            setFerryLocos(n);
            if (n > 0) {
              setColor('GRAY');
              setIsTunnel(false);
            }
          }}
        />
      </label>
      <div className="field">
        <span className="field-label">{t('builder.parallelTracks')}</span>
        <Segmented<string>
          options={[
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
          ]}
          value={parallelTracks ? String(parallelTracks.value) : String(trackCount)}
          onChange={(v) =>
            parallelTracks
              ? parallelTracks.onChange(Number(v) as 1 | 2 | 3)
              : setTrackCount(Number(v))
          }
          ariaLabel={t('builder.parallelTracks')}
        />
      </div>
      <div className="row">
        <button
          className="primary"
          onClick={() => onSubmit({ ...initial, color, length, isTunnel, ferryLocos }, trackCount)}
        >
          {t('save')}
        </button>
        <button onClick={onCancel}>{t('cancel')}</button>
      </div>
      {extra}
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they all pass**

Run: `yarn workspace @trm/web test --run RoutesStage`
Expected: PASS — all 7 tests (5 existing + 2 new).

- [ ] **Step 5: Run the full web test suite and typecheck**

Run: `yarn workspace @trm/web test`
Expected: PASS

Run: `yarn workspace @trm/web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/editor/stages/RoutesStage.tsx apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx
git commit -m "fix(builder): move the parallel-tracks control above Save/Cancel in the edit-route form"
```

---

## Final verification

- [ ] Run `yarn build` from the repo root — expected: PASS (proto codegen + all package builds).
- [ ] Run `yarn typecheck` from the repo root — expected: PASS.
- [ ] Run `yarn lint` from the repo root — expected: PASS.
- [ ] Run `yarn test` from the repo root — expected: PASS (every workspace, including the ~24
      unrelated fixture files across `packages/engine/test`, `packages/map-data/test`,
      `apps/server/test`, `apps/web/src` that were confirmed during planning to need **no** change
      because `tier` is optional).
