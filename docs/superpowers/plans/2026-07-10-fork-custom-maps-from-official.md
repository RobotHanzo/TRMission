# Fork Custom Maps From Official Maps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a map author create a new custom map as a fork of an official map (Taiwan today), copying its cities/routes/tickets/rules and a Taiwan-silhouette `MapGeography` into a new editable draft.

**Architecture:** Server-authoritative, mirroring the existing clone-by-code flow but sourced from the built-in `OFFICIAL_MAPS` registry. `@trm/map-data` generates a `MapGeography` from Taiwan's hand-authored silhouette and exposes it on the official-map registry entry. The server adds `GET /maps/official` (picker list) and `POST /maps/fork/:mapId` (create-from-fork). The web adds a fork card beside "Clone by code".

**Tech Stack:** TypeScript, NestJS + nestjs-zod (server), React + Vite + zustand + react-i18next (web), Vitest + supertest (tests), Yarn 4 workspaces / Turborepo.

## Global Constraints

- **Never modify `TAIWAN_CONTENT`, `MAP_META`, `CONTENT_HASH`, or the content registry.** The fork geography is generated separately and only ever attached to a forked draft. Adding `geography` to `TAIWAN_CONTENT` would change `CONTENT_HASH` and break every persisted game/replay.
- **Determinism:** the geography generator must use no `Math.random`/`Date` — same output every call (a forked-but-untouched draft must re-publish to the same `contentHash`). Round every generated land coordinate to 2 decimals.
- **Optional fields are spread-if-defined** (`...(x !== undefined ? { x } : {})`), never assigned as an explicit `undefined` key — `exactOptionalPropertyTypes` is on.
- **Fork naming:** `` `${nameZh} (副本)` `` / `` `${nameEn} (Copy)` `` — identical to `cloneByCode`.
- **Feature gate:** both new endpoints live on `MapsController` (already `AccessTokenGuard` + `FeatureGuard` + `@RequireFeature('mapBuilder')`); the mutating `fork` route also adds `RegisteredUserGuard` (no guests), matching create/clone.
- **Route ordering:** `@Get('official')` MUST be declared before `@Get(':id')` in the controller, or `official` is captured as an `:id`.
- **Bundle:** the picker reads the `GET /maps/official` endpoint. Do NOT `import { OFFICIAL_MAPS } from '@trm/map-data'` into `apps/web` — it would pull the Taiwan content tables into the builder chunk.
- **Package build order:** `map-data` before `server`/`web`. Run map-data tests first; server/web import its TS source directly.

---

### Task 1: `@trm/map-data` — Taiwan fork geography

**Files:**

- Modify: `packages/map-data/src/taiwan-geography.ts` (add `taiwanForkGeography()`)
- Modify: `packages/map-data/src/index.ts` (add `forkGeography?` to `OfficialMap`; set it on the Taiwan entry)
- Test: `packages/map-data/test/fork-geography.spec.ts` (create)

**Interfaces:**

- Consumes: existing `TAIWAN_BASE_VIEW`, `TAIWAN_OUTLINE`, `TAIWAN_ISLANDS` (from `taiwan-geography.ts`); `MapGeography` type; `validateGeography`, `validateContent`, `validateForPlay`, `officialMapById`, `OFFICIAL_MAPS` (from `index.ts`).
- Produces:
  - `taiwanForkGeography(): MapGeography` (exported from `taiwan-geography.ts`, re-exported via `index.ts`'s `export * from './taiwan-geography'`).
  - `OfficialMap.forkGeography?: MapGeography` — set to `taiwanForkGeography()` on `OFFICIAL_MAPS[0]` (Taiwan). Consumed by Task 2's `MapsService.forkOfficial`.

- [ ] **Step 1: Write the failing test**

Create `packages/map-data/test/fork-geography.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  taiwanForkGeography,
  validateGeography,
  validateContent,
  validateForPlay,
  OFFICIAL_MAPS,
  officialMapById,
  TAIWAN_OUTLINE,
  TAIWAN_ISLANDS,
} from '../src/index';
import type { GameContent } from '../src/index';

describe('taiwanForkGeography', () => {
  it('passes validateGeography', () => {
    expect(validateGeography(taiwanForkGeography())).toEqual([]);
  });

  it('has the main-island outline plus one ring per island blob, each a valid ring', () => {
    const geo = taiwanForkGeography();
    expect(geo.land).toHaveLength(1 + TAIWAN_ISLANDS.length);
    expect(geo.land[0]).toHaveLength(TAIWAN_OUTLINE.length);
    for (const ring of geo.land) expect(ring.length).toBeGreaterThanOrEqual(3);
  });

  it('rounds every land coordinate to 2 decimals (hash stability)', () => {
    for (const ring of taiwanForkGeography().land) {
      for (const [x, y] of ring) {
        expect(x).toBe(Math.round(x * 100) / 100);
        expect(y).toBe(Math.round(y * 100) / 100);
      }
    }
  });

  it('is deterministic across calls', () => {
    expect(taiwanForkGeography()).toEqual(taiwanForkGeography());
  });

  it('assembles Taiwan content + this geography into structurally-valid, playable content', () => {
    const taiwan = officialMapById('taiwan')!;
    const forked: GameContent = {
      meta: { mapId: 'custom:test', version: 1, nameZh: 'x', nameEn: 'x' },
      cities: taiwan.content.cities,
      routes: taiwan.content.routes,
      tickets: taiwan.content.tickets,
      geography: taiwanForkGeography(),
    };
    expect(validateContent(forked).errors).toEqual([]);
    expect(validateForPlay(forked, {}, 5).errors).toEqual([]);
  });

  it('exposes forkGeography on the official Taiwan registry entry', () => {
    expect(OFFICIAL_MAPS[0]!.forkGeography).toEqual(taiwanForkGeography());
    expect(officialMapById('taiwan')!.forkGeography).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/map-data test --run fork-geography`
Expected: FAIL — `taiwanForkGeography` is not exported / `forkGeography` undefined.

- [ ] **Step 3: Implement `taiwanForkGeography()` in `taiwan-geography.ts`**

At the top of `packages/map-data/src/taiwan-geography.ts`, add the type import next to the existing `smoothClosedPath` import:

```ts
import type { MapGeography } from './types';
```

Append at the end of the file:

```ts
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Sample a circle (centre + radius, board units) into a closed N-gon ring, 2-dp rounded.
 *  Deterministic (fixed angles) — no RNG, so a forked-but-untouched map re-publishes to the
 *  same content hash. */
function circleRing(cx: number, cy: number, r: number, segments = 16): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    ring.push([round2(cx + r * Math.cos(a)), round2(cy + r * Math.sin(a))]);
  }
  return ring;
}

/**
 * A `MapGeography` that reproduces the official Taiwan silhouette for a CUSTOM map forked from
 * Taiwan. `TAIWAN_CONTENT` itself carries no geography (it renders via the hand-authored
 * `Geography` component and must keep `CONTENT_HASH` stable); this is generated separately and
 * attached only to a forked draft. `land` = the main-island outline + one polygon ring per
 * outlying-island blob (the central-range relief has no generic land-ring equivalent and is
 * dropped). `crop` is a synthetic-but-plausible real-Taiwan lon/lat bbox — provenance only;
 * `CustomGeography` never reads it at render.
 */
export function taiwanForkGeography(): MapGeography {
  return {
    baseView: { ...TAIWAN_BASE_VIEW },
    land: [
      TAIWAN_OUTLINE.map(([x, y]) => [round2(x), round2(y)] as [number, number]),
      ...TAIWAN_ISLANDS.map((b) => circleRing(b.cx, b.cy, b.r)),
    ],
    crop: { lonMin: 118, lonMax: 122.1, latMin: 21.8, latMax: 26.4 },
  };
}
```

- [ ] **Step 4: Wire `forkGeography` onto the Taiwan registry entry in `index.ts`**

In `packages/map-data/src/index.ts`, extend the type import on line 2 to include `MapGeography`:

```ts
import type { GameContent, MapMeta, MapGeography } from './types';
```

Add an import of the generator (near the other `./` imports at the top):

```ts
import { taiwanForkGeography } from './taiwan-geography';
```

Add the optional field to the `OfficialMap` interface:

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

Set it on the Taiwan entry:

```ts
export const OFFICIAL_MAPS: readonly OfficialMap[] = [
  {
    mapId: MAP_META.mapId,
    content: TAIWAN_CONTENT,
    hash: CONTENT_HASH,
    forkGeography: taiwanForkGeography(),
  },
];
```

> Note: `index.ts` already `export * from './taiwan-geography'`, so `taiwanForkGeography` is re-exported for consumers and the test.

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/map-data test --run fork-geography`
Expected: PASS (all 6 assertions).

- [ ] **Step 6: Run the full map-data suite + typecheck (no regression to hashes/geography)**

Run: `yarn workspace @trm/map-data test --run` then `yarn workspace @trm/map-data typecheck`
Expected: PASS — especially `versions.spec.ts` and `hash-extension.spec.ts` (proves `CONTENT_HASH` is unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/map-data/src/taiwan-geography.ts packages/map-data/src/index.ts packages/map-data/test/fork-geography.spec.ts
git commit -m "feat(map-data): generate a forkable MapGeography from the Taiwan silhouette"
```

---

### Task 2: `apps/server` — `GET /maps/official` + `POST /maps/fork/:mapId`

**Files:**

- Modify: `apps/server/src/maps/maps.service.ts` (add `OfficialMapSummary`, `listOfficial()`, `forkOfficial()`)
- Modify: `apps/server/src/maps/maps.schemas.ts` (add `OfficialMapSummarySchema`)
- Modify: `apps/server/src/maps/maps.controller.ts` (add the two routes; ordering matters)
- Test: `apps/server/test/maps.e2e.spec.ts` (add a `describe` block; reuse the file's `registered`/`guest` helpers)

**Interfaces:**

- Consumes: `OFFICIAL_MAPS`, `officialMapById` (from `@trm/map-data`, incl. `forkGeography` from Task 1); `CustomMapRepo.create`/`update`; existing `toDetail`, `MapDraft`, `MapDetail`.
- Produces:
  - `MapsService.listOfficial(): OfficialMapSummary[]` where `OfficialMapSummary = { mapId: string; nameZh: string; nameEn: string; cities: number; routes: number }`.
  - `MapsService.forkOfficial(mapId: string, ownerId: string): Promise<MapDetail>`.
  - Routes `GET /api/v1/maps/official` → `OfficialMapSummary[]`, `POST /api/v1/maps/fork/:mapId` → `MapDetail` (consumed by Task 3's web client).

- [ ] **Step 1: Write the failing e2e test**

Append to `apps/server/test/maps.e2e.spec.ts` (the file already defines `registered`, `guest`, `server`, `auth`). Add this import at the top of the file, next to the existing imports:

```ts
import { OFFICIAL_MAPS } from '@trm/map-data';
```

Add this block at the end of the file:

```ts
describe('maps: fork from official', () => {
  it('lists official maps (route not shadowed by :id) with station/route counts', async () => {
    const a = await registered('fork-list@example.com', 'ForkList');
    const res = await request(server()).get('/api/v1/maps/official').set(auth(a.token)).expect(200);
    const taiwan = res.body.find((m: { mapId: string }) => m.mapId === 'taiwan');
    expect(taiwan).toBeDefined();
    expect(taiwan.cities).toBe(OFFICIAL_MAPS[0]!.content.cities.length);
    expect(taiwan.routes).toBe(OFFICIAL_MAPS[0]!.content.routes.length);
  });

  it('forks an official map into a new owned draft with content + geography', async () => {
    const a = await registered('fork-do@example.com', 'ForkDo');
    const forked = await request(server())
      .post('/api/v1/maps/fork/taiwan')
      .set(auth(a.token))
      .expect(201);
    expect(forked.body.nameEn).toContain('Copy');
    expect(forked.body.draft.cities).toHaveLength(OFFICIAL_MAPS[0]!.content.cities.length);
    expect(forked.body.draft.routes).toHaveLength(OFFICIAL_MAPS[0]!.content.routes.length);
    expect(forked.body.draft.tickets).toHaveLength(OFFICIAL_MAPS[0]!.content.tickets.length);
    expect(forked.body.draft.geography.land.length).toBeGreaterThan(0);
    // Owned by a: a can read it back.
    await request(server()).get(`/api/v1/maps/${forked.body.id}`).set(auth(a.token)).expect(200);
  });

  it('404s forking an unknown official map id', async () => {
    const a = await registered('fork-404@example.com', 'Fork404');
    await request(server()).post('/api/v1/maps/fork/nosuchmap').set(auth(a.token)).expect(404);
  });

  it('403s the official list + fork without the mapBuilder feature (guest)', async () => {
    const g = await guest('ForkGuest');
    await request(server()).get('/api/v1/maps/official').set(auth(g.token)).expect(403);
    await request(server()).post('/api/v1/maps/fork/taiwan').set(auth(g.token)).expect(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run maps.e2e`
Expected: FAIL — `/maps/official` 404s (or is captured by `:id`) and `/maps/fork/taiwan` 404s (route absent).

- [ ] **Step 3: Add the response schema**

In `apps/server/src/maps/maps.schemas.ts`, add near the other response schemas (e.g. after `MapSummarySchema`):

```ts
export const OfficialMapSummarySchema = z.object({
  mapId: z.string(),
  nameZh: z.string(),
  nameEn: z.string(),
  cities: z.number(),
  routes: z.number(),
});
```

- [ ] **Step 4: Add the service methods**

In `apps/server/src/maps/maps.service.ts`, extend the `@trm/map-data` import to add the registry accessors:

```ts
import {
  assertValidContent,
  hashContent,
  officialMapById,
  OFFICIAL_MAPS,
  validateContent,
  validateForPlay,
  validateGeography,
} from '@trm/map-data';
```

Add the summary type next to the other exported interfaces (near `MapSummary`):

```ts
export interface OfficialMapSummary {
  mapId: string;
  nameZh: string;
  nameEn: string;
  cities: number;
  routes: number;
}
```

Add these two methods to the `MapsService` class (e.g. right after `cloneByCode`):

```ts
listOfficial(): OfficialMapSummary[] {
  return OFFICIAL_MAPS.map((m) => ({
    mapId: m.mapId,
    nameZh: m.content.meta.nameZh,
    nameEn: m.content.meta.nameEn,
    cities: m.content.cities.length,
    routes: m.content.routes.length,
  }));
}

/** Fork an official map into a new custom-map draft owned by `ownerId`. Copies cities/routes/
 *  tickets/rules straight through; geography is the map's own (world-cropped official maps) or its
 *  generated silhouette (Taiwan's `forkGeography`). Nothing is published to `mapContents` — that
 *  still happens only at game start. */
async forkOfficial(mapId: string, ownerId: string): Promise<MapDetail> {
  const official = officialMapById(mapId);
  if (!official) throw new NotFoundException('official map not found');
  const { content, forkGeography } = official;
  const doc = await this.maps.create(
    randomUUID(),
    ownerId,
    `${content.meta.nameZh} (副本)`,
    `${content.meta.nameEn} (Copy)`,
  );
  const geography = content.geography ?? forkGeography;
  const draft: MapDraft = {
    cities: [...content.cities],
    routes: [...content.routes],
    tickets: [...content.tickets],
    ...(geography !== undefined ? { geography } : {}),
    ...(content.rules !== undefined ? { rules: content.rules } : {}),
  };
  const updated = await this.maps.update(doc._id, ownerId, { draft });
  return toDetail(updated ?? doc);
}
```

- [ ] **Step 5: Add the controller routes (ordering: `official` before `:id`)**

In `apps/server/src/maps/maps.controller.ts`, add `OfficialMapSummarySchema` to the import from `./maps.schemas`.

Insert the list route immediately AFTER the existing `list()` method (the `@Get()` handler) and BEFORE `@Post()` create — this guarantees it is registered ahead of `@Get(':id')`:

```ts
@Get('official')
@ApiOperation({ summary: 'List the official maps you can fork from' })
@ApiResponse({ status: 200, schema: apiSchema(z.array(OfficialMapSummarySchema)) })
listOfficial() {
  return this.maps.listOfficial();
}
```

Insert the fork route after the `clone()` method:

```ts
@Post('fork/:mapId')
@UseGuards(RegisteredUserGuard)
@ApiOperation({ summary: 'Fork an official map into a new custom map draft' })
@ApiResponse({ status: 201, schema: apiSchema(MapDetailSchema) })
fork(@Param('mapId') mapId: string, @CurrentUser() user: AuthUser) {
  return this.maps.forkOfficial(mapId, user.userId);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run maps.e2e`
Expected: PASS — all four new cases plus the existing CRUD/share/clone/bow cases.

- [ ] **Step 7: Typecheck the server**

Run: `yarn workspace @trm/server typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/maps/maps.service.ts apps/server/src/maps/maps.schemas.ts apps/server/src/maps/maps.controller.ts apps/server/test/maps.e2e.spec.ts
git commit -m "feat(server): fork an official map into a custom draft (GET /maps/official, POST /maps/fork/:mapId)"
```

---

### Task 3: `apps/web` — fork picker beside "Clone by code"

**Files:**

- Modify: `apps/web/src/net/rest.ts` (add `OfficialMapSummary` type + `listOfficialMaps`/`forkOfficialMap`)
- Modify: `apps/web/src/features/builder/MapsScreen.tsx` (fork card in a two-column row with clone-by-code)
- Modify: `apps/web/src/i18n/index.ts` (add `builder.forkOfficialTitle`, `builder.forkMap` in zh + en)
- Modify: `apps/web/src/styles/builder.css` (add `.maps-columns` two-column row)
- Test: `apps/web/src/features/builder/MapsScreen.test.tsx` (create)

**Interfaces:**

- Consumes: Task 2's `GET /maps/official` and `POST /maps/fork/:mapId`; existing `MapDetail` type, `useUi().enterMapEditor` (sets `view: 'mapEditor'`, `editingMapId`), `t('builder.peekSummary', { cities, routes })`.
- Produces (on `api`): `listOfficialMaps(): Promise<OfficialMapSummary[]>`, `forkOfficialMap(mapId: string): Promise<MapDetail>`, and the exported `OfficialMapSummary` interface.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/builder/MapsScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../../i18n';
import MapsScreen from './MapsScreen';
import { api } from '../../net/rest';
import type * as Rest from '../../net/rest';
import { useUi } from '../../store/ui';

vi.mock('../../net/rest', async () => {
  const actual = await vi.importActual<typeof Rest>('../../net/rest');
  return {
    ...actual,
    api: {
      ...actual.api,
      listMaps: vi.fn(),
      listOfficialMaps: vi.fn(),
      forkOfficialMap: vi.fn(),
    },
  };
});

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  asMock(api.listMaps).mockResolvedValue([]);
  asMock(api.listOfficialMaps).mockResolvedValue([
    { mapId: 'taiwan', nameZh: '台灣', nameEn: 'Taiwan', cities: 36, routes: 68 },
  ]);
  asMock(api.forkOfficialMap).mockResolvedValue({
    id: 'forked-1',
    nameZh: '台灣 (副本)',
    nameEn: 'Taiwan (Copy)',
    revision: 2,
    ownerId: 'u1',
    updatedAt: new Date().toISOString(),
    draft: { cities: [], routes: [], tickets: [] },
  });
});

afterEach(() => {
  useUi.setState({ view: 'home', editingMapId: null });
  vi.clearAllMocks();
});

describe('MapsScreen: fork from official', () => {
  it('lists an official map and forks it into the editor', async () => {
    render(<MapsScreen />);
    const forkBtn = await screen.findByRole('button', { name: '建立副本' });
    fireEvent.click(forkBtn);
    await waitFor(() => expect(api.forkOfficialMap).toHaveBeenCalledWith('taiwan'));
    await waitFor(() => expect(useUi.getState().view).toBe('mapEditor'));
    expect(useUi.getState().editingMapId).toBe('forked-1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run MapsScreen`
Expected: FAIL — `api.listOfficialMaps` is not a function / no "建立副本" button.

- [ ] **Step 3: Add the REST client methods**

In `apps/web/src/net/rest.ts`, add the type next to the other custom-map interfaces (e.g. after `MapSummary`):

```ts
export interface OfficialMapSummary {
  mapId: string;
  nameZh: string;
  nameEn: string;
  cities: number;
  routes: number;
}
```

Add these two entries to the `api` object, next to the existing `listMaps`/`cloneSharedMap`:

```ts
  listOfficialMaps: () => req<OfficialMapSummary[]>('GET', '/maps/official'),
  forkOfficialMap: (mapId: string) =>
    req<MapDetail>('POST', `/maps/fork/${encodeURIComponent(mapId)}`),
```

- [ ] **Step 4: Add the i18n keys (zh + en)**

In `apps/web/src/i18n/index.ts`, in the zh-Hant `builder` block (after `cloneMap`), add:

```ts
        forkOfficialTitle: '從官方地圖建立',
        forkMap: '建立副本',
```

In the en `builder` block (after `cloneMap`), add:

```ts
        forkOfficialTitle: 'Start from an official map',
        forkMap: 'Fork',
```

> The count summary reuses the existing `builder.peekSummary` key — no new summary string.

- [ ] **Step 5: Add the fork card + two-column layout in `MapsScreen.tsx`**

In `apps/web/src/features/builder/MapsScreen.tsx`:

Extend the rest import to include the new type:

```ts
import {
  api,
  ApiError,
  type MapSummary,
  type OfficialMapSummary,
  type SharedMapView,
} from '../../net/rest';
```

Add state + loader + handler inside the component (next to the existing `useState`/`refresh`):

```ts
const [official, setOfficial] = useState<OfficialMapSummary[] | null>(null);
const [forking, setForking] = useState<string | null>(null);

useEffect(() => {
  api
    .listOfficialMaps()
    .then(setOfficial)
    .catch(() => setOfficial([]));
}, []);

const doFork = async (mapId: string) => {
  setForking(mapId);
  try {
    const detail = await api.forkOfficialMap(mapId);
    enterMapEditor(detail.id);
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setForking(null);
  }
};
```

Replace the existing single "Clone by code" `<div className="card stack"> … </div>` (the second card) with a two-column row that holds the new fork card AND the clone card:

```tsx
<div className="row maps-columns">
  <div className="card stack">
    <h2>{t('builder.forkOfficialTitle')}</h2>
    {official?.map((m) => (
      <div key={m.mapId} className="row between maps-row">
        <div className="maps-row-name">
          <span>
            {m.nameZh} <span className="muted">({m.nameEn})</span>
          </span>
          <span className="muted maps-row-updated">
            {t('builder.peekSummary', { cities: m.cities, routes: m.routes })}
          </span>
        </div>
        <button
          className="primary"
          disabled={forking === m.mapId}
          onClick={() => void doFork(m.mapId)}
        >
          {t('builder.forkMap')}
        </button>
      </div>
    ))}
  </div>

  <div className="card stack">
    <h2>{t('builder.cloneByCode')}</h2>
    <div className="row">
      <input
        placeholder={t('builder.shareCode')}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <button onClick={() => void doPeek()}>{t('builder.peek')}</button>
    </div>
    {peekError && <p className="error">{peekError}</p>}
    {peek && (
      <div className="stack">
        <p>
          {peek.nameZh} <span className="muted">({peek.nameEn})</span>
        </p>
        <p className="muted">
          {t('builder.peekSummary', {
            cities: peek.draft.cities.length,
            routes: peek.draft.routes.length,
          })}
        </p>
        <button className="primary" disabled={cloning} onClick={() => void doClone()}>
          {t('builder.cloneMap')}
        </button>
      </div>
    )}
  </div>
</div>
```

> The "My maps" card above (with the create-new row) is unchanged and stays outside this row.

- [ ] **Step 6: Add the two-column CSS**

In `apps/web/src/styles/builder.css`, add after the `.maps-row-updated` rule (around line 23):

```css
/* Fork-official and clone-by-code sit side by side below the My-maps card; stack on narrow. */
.maps-columns {
  flex-wrap: wrap;
  align-items: flex-start;
}
.maps-columns > .card {
  flex: 1 1 260px;
  min-width: 0;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run MapsScreen`
Expected: PASS.

- [ ] **Step 8: Typecheck the web app**

Run: `yarn workspace @trm/web typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/features/builder/MapsScreen.tsx apps/web/src/i18n/index.ts apps/web/src/styles/builder.css apps/web/src/features/builder/MapsScreen.test.tsx
git commit -m "feat(web): fork an official map from the Maps screen"
```

---

### Task 4: Full-repo verification

**Files:** none (validation only).

- [ ] **Step 1: Build, lint, typecheck, test across the monorepo**

Run: `yarn build && yarn typecheck && yarn lint && yarn test`
Expected: PASS everywhere. `yarn build` runs `@trm/map-data` before `server`/`web`; the map-data `versions.spec.ts`/`hash-extension.spec.ts` prove `CONTENT_HASH` is untouched.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Start Mongo + server + web (`docker compose up -d mongo`, `yarn workspace @trm/server dev`, `yarn workspace @trm/web dev`), grant your account the `mapBuilder` feature, open `/maps`, click **Fork** on Taiwan, and confirm the editor opens on the **Stops** stage showing the Taiwan silhouette with all cities/routes.

- [ ] **Step 3: Commit any format fixes**

```bash
git add -u
git commit -m "chore: formatting after fork-from-official feature"
```

> Only if `yarn format` changed files; otherwise skip. Stage only files this feature touched (per repo git rules — never `git add -A`).

---

## Self-Review

**Spec coverage:**

- Fork geography for Taiwan (spec §1) → Task 1.
- `OfficialMap.forkGeography` + generic `content.geography ?? forkGeography` rule (spec §1) → Task 1 (field) + Task 2 (rule in `forkOfficial`).
- `GET /maps/official` + `POST /maps/fork/:mapId`, service, schema, route-ordering caveat (spec §2) → Task 2.
- Web fork picker beside clone-by-code, two-column row, rest client, i18n (spec §3, incl. the reviewed layout) → Task 3.
- Endpoint-over-bundle-import decision (spec §4) → Global Constraints + Task 3 (uses `listOfficialMaps`).
- Testing (spec §Testing): map-data unit → Task 1; server e2e (403/404/success/counts) → Task 2; web MapsScreen → Task 3.
- Out-of-scope items (no `TAIWAN_CONTENT`/hash/registry/game-start changes) → Global Constraints + Task 1 Step 6 (regression gate).

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact run commands with expected output.

**Type consistency:** `OfficialMapSummary` = `{ mapId, nameZh, nameEn, cities, routes }` identical in server service, server schema, and web rest client. `taiwanForkGeography(): MapGeography` and `OfficialMap.forkGeography?: MapGeography` match across Task 1 and Task 2. `forkOfficial(mapId, ownerId): Promise<MapDetail>` consumed by the `POST /maps/fork/:mapId` route and the web `forkOfficialMap`. `enterMapEditor(id)` sets `view: 'mapEditor'` + `editingMapId` — asserted in the Task 3 test.
