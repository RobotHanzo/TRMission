# Route Curvature Tuning ("Curves" Stage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give custom-map authors a new map-builder stage that tunes each route's curvature (an optional per-route `bow` override riding draft → content → the shared geometry).

**Architecture:** A route's curvature is already one number — the signed perpendicular deviation of its quadratic-Bézier apex from the straight chord, computed in `packages/map-data/src/geometry.ts` (auto-bow + the official-map-only `BOW_OVERRIDE` table). We add an optional `bow?: number` to `RouteDef`/`RouteDraft` that wins over both, flowing through every route-copying seam (server zod/DTO, web adapters) so the builder canvas, live board, replays, and server social cards all render it via the same `buildRouteGeometryFor`. A new `curves` editor stage provides a draggable apex handle + slider. Absent `bow` hashes byte-identically to today (the shared digest drops absent keys), so no existing `contentHash` moves.

**Tech Stack:** TypeScript monorepo (Yarn 4 + Turborepo), vitest, zod (nestjs-zod), React 18 + zustand + react-zoom-pan-pinch v4, `@trm/map-data` (pure TS source, no build step).

**Spec:** `docs/superpowers/specs/2026-07-04-route-curvature-tuning-design.md`

## Global Constraints

- Run all commands from repo root `d:\Web Projects\TRMission` with Yarn 4: `yarn workspace <pkg> test --run <substr>`.
- **Never `git add -A` / `git add .`** — multiple agents share this worktree; stage only the files listed in each task's commit step.
- Optional fields are spread conditionally — `...(x !== undefined ? { x } : {})` — never assigned as a possibly-`undefined` key (`exactOptionalPropertyTypes` is on; the content digest must drop absent keys).
- The engine must stay untouched: `bow` is render-only. No proto changes (custom content travels as REST JSON, not protobuf).
- UI copy ships zh-Hant (primary) + en; zh strings use full-width colon `：`.
- `apps/web` pins Vite ^5 — don't touch it. The builder is a lazy route chunk; re-check chunk size at the end.
- New content hash tripwire: the pinned Taiwan hash `26ad5c18b2cd52c4ccea89de4319843b0dc46a1cdf992333fbfa0d8abe173b09` must stay green.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: map-data geometry — `bow` field, `BOW_LIMIT`, explicit-bow pass, exported offsets

**Files:**

- Modify: `packages/map-data/src/types.ts` (RouteDef, ~line 14–25)
- Modify: `packages/map-data/src/geometry.ts`
- Create: `packages/map-data/test/geometry.spec.ts`

**Interfaces:**

- Consumes: existing `buildRouteGeometryFor(cities, routes)`, `GeometryRoute`, `RouteDef`.
- Produces (later tasks rely on these exact names):
  - `RouteDef.bow?: number` and `GeometryRoute.bow?: number` (optional, board units, signed along the chord normal `n = (-dy, dx)/len` for the a→b chord).
  - `export const BOW_LIMIT = 12` (from `geometry.ts`, re-exported by the package index's `export * from './geometry'`).
  - `export interface RouteOffset { readonly gap: number; readonly bow: number }`.
  - `export function computeRouteOffsetsFor(cities: readonly GeometryCity[], routes: readonly GeometryRoute[]): Map<string, RouteOffset>` (the previously-private `computeOffsetsFor`, renamed and exported).

- [ ] **Step 1: Write the failing tests**

Create `packages/map-data/test/geometry.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRouteGeometryFor, computeRouteOffsetsFor, BOW_LIMIT } from '../src/index';
import type { GeometryCity, GeometryRoute } from '../src/index';

// Horizontal chord a→b with one intruding town just south of it. Chord normal is (0, 1),
// so a positive bow moves the apex south (larger y), negative north.
const cities: GeometryCity[] = [
  { id: 'a', x: 20, y: 50 },
  { id: 'b', x: 80, y: 50 },
  { id: 'town', x: 50, y: 52 },
];

const route = (over: Partial<GeometryRoute> = {}): GeometryRoute => ({
  id: 'r1',
  a: 'a',
  b: 'b',
  length: 4,
  ...over,
});

describe('explicit route bow', () => {
  it('exports the authoring clamp', () => {
    expect(BOW_LIMIT).toBe(12);
  });

  it('without a bow the route still auto-bows away from the intruding town', () => {
    const { geometry } = buildRouteGeometryFor(cities, [route()]);
    // town sits south of the chord → the curve arcs north (apex y < 50).
    expect(geometry.get('r1')!.mid.y).toBeLessThan(49.5);
  });

  it('an explicit bow places the apex exactly bow units along the chord normal', () => {
    const { geometry } = buildRouteGeometryFor(cities, [route({ bow: -6 })]);
    expect(geometry.get('r1')!.mid.x).toBeCloseTo(50, 5);
    expect(geometry.get('r1')!.mid.y).toBeCloseTo(44, 5);
  });

  it('bow: 0 forces a straight route despite the intruder', () => {
    const { geometry } = buildRouteGeometryFor(cities, [route({ bow: 0 })]);
    expect(geometry.get('r1')!.mid.y).toBeCloseTo(50, 5);
  });

  it('an authored bow may exceed the MAX_BOW auto clamp', () => {
    const { geometry } = buildRouteGeometryFor(cities, [route({ bow: 10 })]);
    expect(geometry.get('r1')!.mid.y).toBeCloseTo(60, 5);
  });

  it('a double pair keeps its twin-track gap and both siblings take the explicit bow', () => {
    const pair = [
      route({ id: 'r1', doubleGroup: 'A', bow: 3 }),
      route({ id: 'r2', doubleGroup: 'A', bow: 3 }),
    ];
    const offsets = computeRouteOffsetsFor(cities, pair);
    expect(offsets.get('r1')!.bow).toBe(3);
    expect(offsets.get('r2')!.bow).toBe(3);
    expect(offsets.get('r1')!.gap).not.toBe(0);
    expect(offsets.get('r1')!.gap).toBe(-offsets.get('r2')!.gap);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/map-data test --run geometry.spec`
Expected: FAIL — `computeRouteOffsetsFor` / `BOW_LIMIT` are not exported (import error).

- [ ] **Step 3: Implement**

In `packages/map-data/src/types.ts`, add to `RouteDef` (after `isTunnel`):

```ts
  /**
   * Signed curve-apex deviation from the straight chord (board units, along the chord's unit
   * normal (-dy, dx)/len for a→b). Absent ⇒ the automatic bow (arc away from intruding cities).
   * Authored by the map builder's Curves stage; render-only — the engine ignores it.
   */
  readonly bow?: number;
```

In `packages/map-data/src/geometry.ts`:

1. Add the same `readonly bow?: number;` (same doc comment, one line is fine) to `GeometryRoute`.
2. Below `MAX_BOW`, add:

```ts
/**
 * Clamp for an AUTHORED per-route `bow` (the map builder's Curves stage; also the server's
 * schema bound and the builder slider range). Deliberately wider than MAX_BOW — hand-tuned
 * bows may exceed the auto clamp, just as BOW_OVERRIDE's do.
 */
export const BOW_LIMIT = 12;
```

3. Export the offset shape (replace `interface RouteOffset` with `export interface RouteOffset`).
4. Rename `computeOffsetsFor` → `computeRouteOffsetsFor`, add `export`, and update its one call site in `buildGeometryFor`. Update the JSDoc's first line to mention it is exported for the builder's "auto value" display.
5. At the end of `computeRouteOffsetsFor`, after the `BOW_OVERRIDE` loop, add:

```ts
// An authored per-route bow — the custom-map equivalent of BOW_OVERRIDE — wins over both the
// auto-bow and the override table, keeping any double-gap intact so a pair bows together.
for (const r of routes) {
  if (r.bow === undefined) continue;
  const o = out.get(r.id);
  if (o) out.set(r.id, { gap: o.gap, bow: r.bow });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/map-data test` (full package — the existing content/versions specs must stay green)
Expected: PASS, including `geometry.spec.ts`.
Also run: `yarn workspace @trm/web test --run routeGeometry` — the Taiwan `BOW_OVERRIDE` behavior tests must be unaffected.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/map-data/src/types.ts packages/map-data/src/geometry.ts packages/map-data/test/geometry.spec.ts
git commit -m "feat(map-data): optional per-route bow override in route geometry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: map-data validation — `bowOutOfRange`

**Files:**

- Modify: `packages/map-data/src/validate.ts` (routes loop ~line 130–163; `formatIssue` switch ~line 32–96)
- Modify: `packages/map-data/test/geometry.spec.ts` (append a describe block)

**Interfaces:**

- Consumes: `BOW_LIMIT` from `./geometry` (Task 1), `testContent()` from `test/fixtures.ts`.
- Produces: `validateContent` emits issue code `bowOutOfRange` with params `{ routeId, bow, limit }`. Task 6 adds its `builder.validation.bowOutOfRange` i18n strings.

- [ ] **Step 1: Write the failing tests**

Append to `packages/map-data/test/geometry.spec.ts`:

```ts
import { validateContent } from '../src/index';
import { testContent } from './fixtures';
import type { GameContent } from '../src/index';
```

(merge these into the existing import lines at the top of the file), then:

```ts
describe('validateContent: bow bounds', () => {
  const withFirstRouteBow = (bow: number): GameContent => {
    const base = testContent();
    return { ...base, routes: base.routes.map((r, i) => (i === 0 ? { ...r, bow } : r)) };
  };

  it('accepts an in-range bow', () => {
    expect(validateContent(withFirstRouteBow(4)).ok).toBe(true);
    expect(validateContent(withFirstRouteBow(-BOW_LIMIT)).ok).toBe(true);
  });

  it('rejects an out-of-range bow with a stable issue code', () => {
    const res = validateContent(withFirstRouteBow(BOW_LIMIT + 0.1));
    expect(res.ok).toBe(false);
    expect(res.issues.some((i) => i.code === 'bowOutOfRange')).toBe(true);
  });

  it('rejects a non-finite bow', () => {
    expect(validateContent(withFirstRouteBow(Number.NaN)).ok).toBe(false);
    expect(validateContent(withFirstRouteBow(Number.POSITIVE_INFINITY)).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/map-data test --run geometry.spec`
Expected: FAIL — the out-of-range/non-finite cases report `ok: true` (no check exists yet).

- [ ] **Step 3: Implement**

In `packages/map-data/src/validate.ts`:

1. Add `BOW_LIMIT` to the imports: `import { BOW_LIMIT } from './geometry';`
2. In the routes loop, after the `if (r.isTunnel) tunnelCount++;` line, add:

```ts
if (r.bow !== undefined && (!Number.isFinite(r.bow) || Math.abs(r.bow) > BOW_LIMIT)) {
  push('bowOutOfRange', { routeId: rid, bow: r.bow, limit: BOW_LIMIT });
}
```

3. In `formatIssue`, after the `ferryAndTunnel` case, add:

```ts
    case 'bowOutOfRange':
      return `${p.routeId}: bow ${p.bow} is outside the allowed range [-${p.limit}, ${p.limit}]`;
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn workspace @trm/map-data test`
Expected: PASS (all specs).

- [ ] **Step 5: Commit**

```bash
git add packages/map-data/src/validate.ts packages/map-data/test/geometry.spec.ts
git commit -m "feat(map-data): validate route bow bounds (bowOutOfRange)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: map-data hash tripwire — absent `bow` never moves a hash

**Files:**

- Modify: `packages/map-data/test/hash-extension.spec.ts`

**Interfaces:**

- Consumes: `TAIWAN_CONTENT`, `hashContent`, the pinned hash constant `PINNED_V3_HASH` already in the file.
- Produces: nothing new — a regression gate.

- [ ] **Step 1: Write the test** (it should pass immediately — this is a tripwire, per the map-data CLAUDE.md rule for optional-field extensions)

Append inside the existing `describe('hashContent extension', ...)`:

```ts
it('a route bow changes the hash; content without one hashes exactly as before', () => {
  const withBow: GameContent = {
    ...TAIWAN_CONTENT,
    routes: TAIWAN_CONTENT.routes.map((r, i) => (i === 0 ? { ...r, bow: 3 } : r)),
  };
  expect(hashContent(withBow)).not.toBe(PINNED_V3_HASH);
  // The type extension alone must not move any pre-existing hash.
  expect(hashContent({ ...TAIWAN_CONTENT })).toBe(PINNED_V3_HASH);
});
```

- [ ] **Step 2: Run to verify pass**

Run: `yarn workspace @trm/map-data test --run hash-extension`
Expected: PASS (including the pinned-hash assertions).

- [ ] **Step 3: Commit**

```bash
git add packages/map-data/test/hash-extension.spec.ts
git commit -m "test(map-data): hash tripwire for the optional route bow field

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: server — zod bound + DTO seam + e2e

**Files:**

- Modify: `apps/server/src/maps/maps.schemas.ts` (`RouteDraftSchema` ~line 30–39; `draftFromDto` routes map ~line 138–147)
- Modify: `apps/server/test/maps.e2e.spec.ts`

**Interfaces:**

- Consumes: `BOW_LIMIT` from `@trm/map-data` (Task 1). The server's internal `MapDraft.routes` is `RouteDef[]` (`maps.types.ts`), so the type change from Task 1 already covers storage and `assembleContent` (which passes `draft.routes` through untouched to published content).
- Produces: `PUT /maps/:id` accepts/round-trips `routes[].bow`; out-of-range bow → 400. `MapContentResponseSchema` reuses `RouteDraftSchema`, so `GET /maps/content/:hash` carries it with no further change.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/maps.e2e.spec.ts` (uses the file's existing `registered`, `server`, `auth`, `tinyDraft` helpers):

```ts
describe('maps: route bow', () => {
  it('accepts and round-trips an in-range route bow', async () => {
    const a = await registered('mapbow1@example.com', 'Bow1');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '彎', nameEn: 'Bow' })
      .expect(201);
    const id: string = created.body.id;

    const draft = { ...tinyDraft, routes: [{ ...tinyDraft.routes[0]!, bow: -3.5 }] };
    await request(server())
      .put(`/api/v1/maps/${id}`)
      .set(auth(a.token))
      .send({ draft })
      .expect(200);

    const got = await request(server()).get(`/api/v1/maps/${id}`).set(auth(a.token)).expect(200);
    expect(got.body.draft.routes[0].bow).toBe(-3.5);
  });

  it('rejects a bow outside the shared limit (schema bound)', async () => {
    const a = await registered('mapbow2@example.com', 'Bow2');
    const created = await request(server())
      .post('/api/v1/maps')
      .set(auth(a.token))
      .send({ nameZh: '彎', nameEn: 'Bow' })
      .expect(201);
    const id: string = created.body.id;

    const draft = { ...tinyDraft, routes: [{ ...tinyDraft.routes[0]!, bow: 12.5 }] };
    await request(server())
      .put(`/api/v1/maps/${id}`)
      .set(auth(a.token))
      .send({ draft })
      .expect(400);
  });
});
```

(If another session's feature-gating work has landed and registered users now need a `mapBuilder` grant, mirror whatever setup the file's other `describe` blocks use at that time — follow the file, not this snippet.)

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/server test --run maps.e2e`
Expected: FAIL — the round-trip test gets `bow: undefined` (zod strips unknown keys), the rejection test gets 200 instead of 400.

- [ ] **Step 3: Implement**

In `apps/server/src/maps/maps.schemas.ts`:

1. Extend the map-data import: `import { RULE_BOUNDS, BOW_LIMIT } from '@trm/map-data';`
2. In `RouteDraftSchema`, after `doubleGroup`:

```ts
  bow: z.number().finite().min(-BOW_LIMIT).max(BOW_LIMIT).optional(),
```

3. In `draftFromDto`'s routes map, after the `doubleGroup` spread:

```ts
      ...(r.bow !== undefined ? { bow: r.bow } : {}),
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn workspace @trm/server test --run maps.e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/maps/maps.schemas.ts apps/server/test/maps.e2e.spec.ts
git commit -m "feat(server): accept optional route bow in map drafts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: web data plumbing — draft type, adapters, store actions

**Files:**

- Modify: `apps/web/src/net/rest.ts` (`RouteDraft`, ~line 123–132)
- Modify: `apps/web/src/features/builder/editor/contentAdapter.ts`
- Modify: `apps/web/src/game/contentCache.ts` (`contentFromDto` routes map)
- Modify: `apps/web/src/features/builder/editor/store.ts`
- Create: `apps/web/src/features/builder/editor/contentAdapter.test.ts`
- Modify: `apps/web/src/features/builder/editor/store.test.ts`

**Interfaces:**

- Consumes: `BOW_LIMIT` from `@trm/map-data` (Task 1).
- Produces (Task 8 relies on these exact signatures):
  - `RouteDraft.bow?: number`
  - store `setRouteBow(id: string, bow: number | undefined): void` — clamps to ±`BOW_LIMIT`, rounds to 0.1, normalises −0, patches the route **and its `doubleGroup` siblings** in one undo entry; `undefined` removes the key.
  - store `clearAllRouteBows(): void` — strips every `bow` in one undo entry; no-op (no undo entry) when none are set.

- [ ] **Step 1: Write the failing store tests**

Append to `apps/web/src/features/builder/editor/store.test.ts` (uses the file's existing `city`/`route` helpers):

```ts
describe('setRouteBow', () => {
  it('sets a 0.1-rounded, clamped bow on the route and marks dirty', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2', 10));
    s.addRoute(route('r1', 'c1', 'c2'));

    s.setRouteBow('r1', 3.14159);
    expect(useEditorStore.getState().draft.routes[0]!.bow).toBe(3.1);

    s.setRouteBow('r1', 99);
    expect(useEditorStore.getState().draft.routes[0]!.bow).toBe(12);

    s.setRouteBow('r1', -0.04);
    expect(Object.is(useEditorStore.getState().draft.routes[0]!.bow, 0)).toBe(true);
  });

  it('applies the bow to both siblings of a double pair', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2', 10));
    s.addRoute(route('r1', 'c1', 'c2', { doubleGroup: 'A' }));
    s.addRoute(route('r2', 'c1', 'c2', { doubleGroup: 'A' }));
    s.addRoute(route('r3', 'c1', 'c2'));

    s.setRouteBow('r1', 2);

    const routes = useEditorStore.getState().draft.routes;
    expect(routes.find((r) => r.id === 'r1')!.bow).toBe(2);
    expect(routes.find((r) => r.id === 'r2')!.bow).toBe(2);
    expect(routes.find((r) => r.id === 'r3')!.bow).toBeUndefined();
  });

  it('undefined removes the key entirely (both siblings), as one undo entry', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2', 10));
    s.addRoute(route('r1', 'c1', 'c2', { doubleGroup: 'A' }));
    s.addRoute(route('r2', 'c1', 'c2', { doubleGroup: 'A' }));
    s.setRouteBow('r1', 2);

    s.setRouteBow('r2', undefined);

    for (const r of useEditorStore.getState().draft.routes) {
      expect(Object.keys(r)).not.toContain('bow');
    }
    s.undo();
    expect(useEditorStore.getState().draft.routes[0]!.bow).toBe(2);
  });

  it('is a no-op for an unknown route id', () => {
    const before = useEditorStore.getState().undoStack.length;
    useEditorStore.getState().setRouteBow('nope', 3);
    expect(useEditorStore.getState().undoStack.length).toBe(before);
  });
});

describe('clearAllRouteBows', () => {
  it('strips every bow in one undo step, and is a no-op when none are set', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2', 10));
    s.addRoute(route('r1', 'c1', 'c2'));
    s.addRoute(route('r2', 'c1', 'c2'));
    s.setRouteBow('r1', 1);
    s.setRouteBow('r2', -2);
    const undoBefore = useEditorStore.getState().undoStack.length;

    s.clearAllRouteBows();

    expect(useEditorStore.getState().draft.routes.every((r) => r.bow === undefined)).toBe(true);
    expect(useEditorStore.getState().undoStack.length).toBe(undoBefore + 1);

    s.clearAllRouteBows(); // nothing left to clear
    expect(useEditorStore.getState().undoStack.length).toBe(undoBefore + 1);
  });
});
```

- [ ] **Step 2: Write the failing adapter test**

Create `apps/web/src/features/builder/editor/contentAdapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { draftToContent } from './contentAdapter';
import type { MapDraft } from '../../../net/rest';

const draft = (bow?: number): MapDraft => ({
  cities: [],
  routes: [
    {
      id: 'r1',
      a: 'a',
      b: 'b',
      color: 'RED',
      length: 2,
      ferryLocos: 0,
      isTunnel: false,
      ...(bow !== undefined ? { bow } : {}),
    },
  ],
  tickets: [],
});

describe('draftToContent', () => {
  it('carries an authored route bow into content', () => {
    const content = draftToContent(draft(-2.5), { nameZh: 'x', nameEn: 'x' });
    expect(content.routes[0]!.bow).toBe(-2.5);
  });

  it('omits the key entirely when the draft has no bow', () => {
    const content = draftToContent(draft(), { nameZh: 'x', nameEn: 'x' });
    expect(Object.keys(content.routes[0]!)).not.toContain('bow');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `yarn workspace @trm/web test --run store.test`
Expected: FAIL — `s.setRouteBow is not a function`.
Run: `yarn workspace @trm/web test --run contentAdapter`
Expected: FAIL — `bow` type error / value undefined (the adapter drops it).

- [ ] **Step 4: Implement**

1. `apps/web/src/net/rest.ts` — add to `RouteDraft` after `isTunnel: boolean;`:

```ts
  /** Signed curve-apex deviation override (board units); absent = automatic bow. */
  bow?: number;
```

2. `apps/web/src/features/builder/editor/contentAdapter.ts` — in the routes map, after the `doubleGroup` spread:

```ts
      ...(r.bow !== undefined ? { bow: r.bow } : {}),
```

3. `apps/web/src/game/contentCache.ts` — same one-line spread in `contentFromDto`'s routes map, after its `doubleGroup` spread. (Type-checked against `RouteDef.bow`; no dedicated test — the adapter test covers the identical pattern.)

4. `apps/web/src/features/builder/editor/store.ts`:
   - Add `import { BOW_LIMIT } from '@trm/map-data';`
   - Add to the `EditorState` interface, after `removeRoute(id: string): void;`:

```ts
  /** Set (clamped ±BOW_LIMIT, 0.1-rounded) or clear (undefined) a route's curvature override.
   *  A double pair's siblings are always patched together so the twin track bows as one. */
  setRouteBow(id: string, bow: number | undefined): void;
  clearAllRouteBows(): void;
```

- Add the implementations after `removeRoute`:

```ts
  setRouteBow: (id, bow) => {
    const { draft } = get();
    const target = draft.routes.find((r) => r.id === id);
    if (!target) return;
    // 0.1 granularity keeps drafts (and thus content hashes) stable across drag jitter;
    // `|| 0` normalises -0 away. bow: 0 is meaningful — it forces a straight route.
    const rounded =
      bow === undefined
        ? undefined
        : Math.round(Math.max(-BOW_LIMIT, Math.min(BOW_LIMIT, bow)) * 10) / 10 || 0;
    const inPair = (r: RouteDraft): boolean =>
      r.id === id || (!!target.doubleGroup && r.doubleGroup === target.doubleGroup);
    mutate(get, set, {
      ...draft,
      routes: draft.routes.map((r) => {
        if (!inPair(r)) return r;
        if (rounded === undefined) {
          const { bow: _drop, ...rest } = r;
          return rest;
        }
        return { ...r, bow: rounded };
      }),
    });
  },
  clearAllRouteBows: () => {
    const { draft } = get();
    if (!draft.routes.some((r) => r.bow !== undefined)) return;
    mutate(get, set, {
      ...draft,
      routes: draft.routes.map((r) => {
        if (r.bow === undefined) return r;
        const { bow: _drop, ...rest } = r;
        return rest;
      }),
    });
  },
```

- Extend the store's rest import with the `RouteDraft` type if not already imported: `import { api, type CityDraft, type MapDetail, type MapDraft, type MapRulesDraft, type RouteDraft, type TicketDraft } from '../../../net/rest';` (already present — verify).

- [ ] **Step 5: Run to verify pass**

Run: `yarn workspace @trm/web test --run store.test` → PASS
Run: `yarn workspace @trm/web test --run contentAdapter` → PASS
Run: `yarn workspace @trm/web typecheck` (or `yarn typecheck` at root) → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/features/builder/editor/contentAdapter.ts apps/web/src/features/builder/editor/contentAdapter.test.ts apps/web/src/game/contentCache.ts apps/web/src/features/builder/editor/store.ts apps/web/src/features/builder/editor/store.test.ts
git commit -m "feat(web): route bow through draft seams + setRouteBow store actions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: web i18n — Curves-stage strings (zh-Hant + en)

**Files:**

- Modify: `apps/web/src/i18n/index.ts` (zh builder block ~line 270–360 + zh `validation` block at ~line 363; en builder block ~line 660–760 + en `validation` block at ~line 760)

**Interfaces:**

- Produces the keys Task 8's component uses verbatim: `builder.stageCurves`, `builder.curvesHint`, `builder.curvesEmptyHint`, `builder.editCurve`, `builder.curveBow`, `builder.curveAuto`, `builder.curveReset`, `builder.curveResetAll`, `builder.validation.bowOutOfRange`.

- [ ] **Step 1: Add the zh-Hant keys**

In the zh builder section, after `stageRoutes: '路線',` add:

```ts
        stageCurves: '曲線',
```

After `deleteRoute: '刪除路線',` add:

```ts
        curvesHint: '拖曳曲線頂點的圓點，或使用右側滑桿調整彎曲程度',
        curvesEmptyHint: '點擊路線以調整其彎曲程度',
        editCurve: '調整曲線：{{a}} ↔ {{b}}',
        curveBow: '彎曲程度',
        curveAuto: '自動值：{{value}}',
        curveReset: '重設為自動',
        curveResetAll: '全部重設為自動（{{n}} 條）',
```

In the zh `validation` block (line ~363), alongside the other route codes add:

```ts
          bowOutOfRange: '{{routeId}}：彎曲程度 {{bow}} 超出允許範圍 [-{{limit}}, {{limit}}]',
```

- [ ] **Step 2: Add the en keys**

In the en builder section, after `stageRoutes: 'Routes',` add:

```ts
        stageCurves: 'Curves',
```

After `deleteRoute: 'Delete route',` add:

```ts
        curvesHint: 'Drag the dot at the apex of the curve, or tune the bend with the slider',
        curvesEmptyHint: 'Click a route to tune its bend',
        editCurve: 'Tune curve: {{a}} ↔ {{b}}',
        curveBow: 'Bend',
        curveAuto: 'Auto: {{value}}',
        curveReset: 'Reset to auto',
        curveResetAll: 'Reset all curves ({{n}})',
```

In the en `validation` block (line ~760), add:

```ts
          bowOutOfRange: '{{routeId}}: bow {{bow}} is outside the allowed range [-{{limit}}, {{limit}}]',
```

- [ ] **Step 3: Verify**

Run: `yarn workspace @trm/web typecheck` → clean. (The keys are exercised by Task 8's tests.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/index.ts
git commit -m "feat(web): i18n strings for the builder Curves stage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: web canvas — `curveMath` helper + EditorCanvas apex handle

**Files:**

- Create: `apps/web/src/features/builder/editor/curveMath.ts`
- Create: `apps/web/src/features/builder/editor/curveMath.test.ts`
- Modify: `apps/web/src/features/builder/editor/EditorCanvas.tsx`
- Modify: `apps/web/src/styles/builder.css`

**Interfaces:**

- Consumes: `clientToBoardPoint(svg, clientX, clientY)` (`canvasProjection.ts`), `BOW_LIMIT` (Task 1), `RouteDraft.bow` (Task 5).
- Produces (Task 8 relies on these):
  - `bowFromPoint(a: {x,y}, b: {x,y}, p: {x,y}): number` — signed bow implied by a board point (projection of `p − mid` onto the chord normal `(-dy, dx)/len`; same convention as the geometry module).
  - `EditorCanvasProps.curveHandle?: CurveHandle` where

```ts
export interface CurveHandle {
  routeId: string;
  /** Live preview value while dragging/sliding; null when idle (render the stored/auto bow). */
  bow: number | null;
  onDrag(bow: number): void;
  onCommit(bow: number): void;
}
```

- While `curveHandle.bow !== null`, the canvas renders the selected route (and its double siblings) with that bow instead of the stored one; a `<circle class="curve-handle">` sits at the curve apex and is draggable.

- [ ] **Step 1: Write the failing math tests**

Create `apps/web/src/features/builder/editor/curveMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bowFromPoint } from './curveMath';
import { buildRouteGeometryFor } from '../../../game/routeGeometry';

describe('bowFromPoint', () => {
  it('projects onto the chord normal for a horizontal chord (normal points +y)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(bowFromPoint(a, b, { x: 5, y: 3 })).toBeCloseTo(3, 5);
    expect(bowFromPoint(a, b, { x: 5, y: -4 })).toBeCloseTo(-4, 5);
    // Movement along the chord contributes nothing.
    expect(bowFromPoint(a, b, { x: 9, y: 3 })).toBeCloseTo(3, 5);
  });

  it('matches the geometry module sign convention (round-trip through the apex)', () => {
    const cities = [
      { id: 'a', x: 20, y: 30 },
      { id: 'b', x: 70, y: 80 },
    ];
    const routes = [{ id: 'r1', a: 'a', b: 'b', length: 3, bow: -5 }];
    const { geometry } = buildRouteGeometryFor(cities, routes);
    const apex = geometry.get('r1')!.mid;
    expect(bowFromPoint(cities[0]!, cities[1]!, apex)).toBeCloseTo(-5, 5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/web test --run curveMath`
Expected: FAIL — module `./curveMath` does not exist.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/features/builder/editor/curveMath.ts`:

```ts
/** Pure pointer→bow math for the Curves stage, kept out of the component so it's testable in
 *  jsdom (where SVG CTMs don't exist). Sign convention matches @trm/map-data's geometry:
 *  the chord normal is (-dy, dx)/len for the a→b chord. */

export function bowFromPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  return ((p.x - midX) * -dy + (p.y - midY) * dx) / len;
}
```

Run: `yarn workspace @trm/web test --run curveMath` → PASS.

- [ ] **Step 4: Extend EditorCanvas**

In `apps/web/src/features/builder/editor/EditorCanvas.tsx`:

1. Add imports:

```ts
import { BOW_LIMIT } from '@trm/map-data';
import type { RouteDraft } from '../../../net/rest';
import { bowFromPoint } from './curveMath';
```

2. Add the `CurveHandle` interface (exported, exactly as in this task's Interfaces block) and add `curveHandle?: CurveHandle;` to `EditorCanvasProps` with the doc comment `/** Curves-stage apex handle: rendered for this route, draggable along the chord normal. */`.

3. Destructure `curveHandle` in the component props, and replace the geometry memo with a preview-aware pair:

```ts
const routesForGeometry = useMemo(() => {
  if (!curveHandle || curveHandle.bow === null) return draft.routes;
  const target = draft.routes.find((r) => r.id === curveHandle.routeId);
  if (!target) return draft.routes;
  const inPair = (r: RouteDraft): boolean =>
    r.id === target.id || (!!target.doubleGroup && r.doubleGroup === target.doubleGroup);
  // Ephemeral drag/slide preview: the pair bows together, exactly as setRouteBow will commit.
  return draft.routes.map((r) => (inPair(r) ? { ...r, bow: curveHandle.bow! } : r));
}, [draft.routes, curveHandle]);

const { geometry, hubs } = useMemo(
  () => buildRouteGeometryFor(draft.cities, routesForGeometry),
  [draft.cities, routesForGeometry],
);
```

4. Add the drag handler inside the component:

```ts
const onHandlePointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
  if (!curveHandle || !svgRef.current) return;
  const route = draft.routes.find((r) => r.id === curveHandle.routeId);
  const a = route && draft.cities.find((c) => c.id === route.a);
  const b = route && draft.cities.find((c) => c.id === route.b);
  if (!a || !b) return;
  e.stopPropagation();
  e.preventDefault();
  const svg = svgRef.current;
  let last = curveHandle.bow ?? bowFromPoint(a, b, geometry.get(route.id)?.mid ?? a);
  const move = (ev: PointerEvent) => {
    const p = clientToBoardPoint(svg, ev.clientX, ev.clientY);
    if (!p) return;
    last = Math.max(-BOW_LIMIT, Math.min(BOW_LIMIT, bowFromPoint(a, b, p)));
    curveHandle.onDrag(last);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    curveHandle.onCommit(last);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
};
```

5. Render the handle after the cities map (so it draws on top), just before `</svg>`:

```tsx
{
  curveHandle && geometry.get(curveHandle.routeId) && (
    <circle
      className="curve-handle"
      cx={geometry.get(curveHandle.routeId)!.mid.x}
      cy={geometry.get(curveHandle.routeId)!.mid.y}
      onPointerDown={onHandlePointerDown}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
```

6. Keep react-zoom-pan-pinch from panning while dragging: on the `<TransformWrapper ...>` add `panning={{ excluded: ['curve-handle'] }}`.

- [ ] **Step 5: Style the handle**

Append to `apps/web/src/styles/builder.css` (counter-scaled like the other markers):

```css
/* Curves stage: draggable apex handle */
.curve-handle {
  r: calc(1.3px * var(--inv-scale, 1));
  fill: #f5b942;
  stroke: #1c2430;
  stroke-width: calc(0.35px * var(--inv-scale, 1));
  cursor: grab;
}
.curve-handle:active {
  cursor: grabbing;
}
```

- [ ] **Step 6: Verify**

Run: `yarn workspace @trm/web typecheck` → clean.
Run: `yarn workspace @trm/web test` → all existing web tests still PASS (the new prop is optional; no behavior change when absent). The handle's render/drag is exercised by Task 8's component tests and the manual check in Task 9.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/builder/editor/curveMath.ts apps/web/src/features/builder/editor/curveMath.test.ts apps/web/src/features/builder/editor/EditorCanvas.tsx apps/web/src/styles/builder.css
git commit -m "feat(web): draggable curve-apex handle in the editor canvas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: web — CurvesStage component + stage registration

**Files:**

- Modify: `apps/web/src/features/builder/editor/store.ts` (`Stage` union + `STAGES`, lines 4–5)
- Modify: `apps/web/src/features/builder/editor/EditorScreen.tsx` (label map, icon map, stage render)
- Create: `apps/web/src/features/builder/editor/stages/CurvesStage.tsx`
- Create: `apps/web/src/features/builder/editor/stages/CurvesStage.test.tsx`

**Interfaces:**

- Consumes: `setRouteBow` / `clearAllRouteBows` (Task 5), `CurveHandle` prop on `EditorCanvas` (Task 7), `computeRouteOffsetsFor` + `BOW_LIMIT` (Task 1), i18n keys (Task 6).
- Produces: the user-visible feature; stage id `'curves'` between `'routes'` and `'missions'`.

- [ ] **Step 1: Write the failing component tests**

Create `apps/web/src/features/builder/editor/stages/CurvesStage.test.tsx` (pattern: `TrimStage.test.tsx`; i18n renders zh-Hant):

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { CurvesStage } from './CurvesStage';
import { useEditorStore } from '../store';
import type { RouteDraft } from '../../../../net/rest';

const routes: RouteDraft[] = [
  { id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
  { id: 'r2', a: 'c2', b: 'c3', color: 'BLUE', length: 2, ferryLocos: 0, isTunnel: false, bow: 4 },
];

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: {
      cities: [
        { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 50, region: 'r', isIsland: false },
        { id: 'c2', nameZh: '乙', nameEn: 'B', x: 60, y: 50, region: 'r', isIsland: false },
        { id: 'c3', nameZh: '丙', nameEn: 'C', x: 90, y: 20, region: 'r', isIsland: false },
      ],
      routes,
      tickets: [],
      geography: {
        baseView: { x: 0, y: 0, w: 100, h: 100 },
        land: [
          [
            [0, 0],
            [100, 0],
            [100, 100],
          ],
        ],
        crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
      },
    },
    revision: 0,
    shareCode: undefined,
    stage: 'curves',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

describe('CurvesStage', () => {
  it('shows the empty hint and the reset-all button when bows exist', () => {
    render(<CurvesStage />);
    expect(screen.getByText('點擊路線以調整其彎曲程度')).toBeInTheDocument();
    expect(screen.getByText('全部重設為自動（1 條）')).toBeInTheDocument();
  });

  it('selecting a route shows the tuner, the auto value, and the apex handle', () => {
    const { container } = render(<CurvesStage />);
    fireEvent.click(container.querySelectorAll('.editor-route')[0]!);

    expect(screen.getByText('調整曲線：甲 ↔ 乙')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getByText(/自動值：/)).toBeInTheDocument();
    expect(container.querySelector('.curve-handle')).not.toBeNull();
  });

  it('slider change previews without committing; blur commits to the store', () => {
    const { container } = render(<CurvesStage />);
    fireEvent.click(container.querySelectorAll('.editor-route')[0]!);
    const slider = screen.getByRole('slider');

    fireEvent.change(slider, { target: { value: '3' } });
    expect(useEditorStore.getState().draft.routes[0]!.bow).toBeUndefined();

    fireEvent.blur(slider);
    expect(useEditorStore.getState().draft.routes[0]!.bow).toBe(3);
  });

  it('reset-to-auto removes the stored bow', () => {
    const { container } = render(<CurvesStage />);
    fireEvent.click(container.querySelectorAll('.editor-route')[1]!);

    fireEvent.click(screen.getByText('重設為自動'));

    expect(useEditorStore.getState().draft.routes[1]!.bow).toBeUndefined();
  });

  it('reset-all clears every tuned bow', () => {
    render(<CurvesStage />);
    fireEvent.click(screen.getByText('全部重設為自動（1 條）'));
    expect(useEditorStore.getState().draft.routes.every((r) => r.bow === undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/web test --run CurvesStage`
Expected: FAIL — module `./CurvesStage` does not exist.

- [ ] **Step 3: Implement the stage component**

Create `apps/web/src/features/builder/editor/stages/CurvesStage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { BOW_LIMIT, computeRouteOffsetsFor } from '@trm/map-data';
import { EditorCanvas } from '../EditorCanvas';
import { useEditorStore } from '../store';

export function CurvesStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const setRouteBow = useEditorStore((s) => s.setRouteBow);
  const clearAllRouteBows = useEditorStore((s) => s.clearAllRouteBows);
  // The in-flight drag/slide value; null while idle. Committed to the store once per gesture so
  // a whole drag is a single undo entry (and a single debounced autosave).
  const [preview, setPreview] = useState<number | null>(null);

  const selectedRoute =
    selection?.kind === 'route' ? draft.routes.find((r) => r.id === selection.id) : undefined;

  // What each route would do with no overrides — the "auto" reference value in the inspector.
  const autoOffsets = useMemo(() => {
    const stripped = draft.routes.map(({ bow: _drop, ...rest }) => rest);
    return computeRouteOffsetsFor(draft.cities, stripped);
  }, [draft.cities, draft.routes]);

  const cityName = (id: string): string => draft.cities.find((c) => c.id === id)?.nameZh ?? id;
  const tunedCount = draft.routes.filter((r) => r.bow !== undefined).length;
  const autoBow = selectedRoute ? (autoOffsets.get(selectedRoute.id)?.bow ?? 0) : 0;
  const effectiveBow = preview ?? selectedRoute?.bow ?? autoBow;
  const shownBow = Math.round(effectiveBow * 10) / 10;

  const commit = (bow: number): void => {
    setPreview(null);
    if (selectedRoute) setRouteBow(selectedRoute.id, bow);
  };

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <EditorCanvas
          onRouteClick={(id) => {
            setPreview(null);
            select({ kind: 'route', id });
          }}
          onBackgroundClick={() => {
            setPreview(null);
            select(null);
          }}
          curveHandle={
            selectedRoute
              ? { routeId: selectedRoute.id, bow: preview, onDrag: setPreview, onCommit: commit }
              : undefined
          }
        />
        <p className="muted editor-hint">{t('builder.curvesHint')}</p>
      </div>
      <aside className="card stack editor-inspector">
        {selectedRoute ? (
          <>
            <h3>
              {t('builder.editCurve', {
                a: cityName(selectedRoute.a),
                b: cityName(selectedRoute.b),
              })}
            </h3>
            <label className="field">
              <span className="field-label">{t('builder.curveBow')}</span>
              <input
                type="range"
                min={-BOW_LIMIT}
                max={BOW_LIMIT}
                step={0.1}
                value={shownBow}
                onChange={(e) => setPreview(Number(e.target.value))}
                onPointerUp={() => {
                  if (preview !== null) commit(preview);
                }}
                onBlur={() => {
                  if (preview !== null) commit(preview);
                }}
                aria-label={t('builder.curveBow')}
              />
            </label>
            <label className="field">
              <input
                type="number"
                min={-BOW_LIMIT}
                max={BOW_LIMIT}
                step={0.1}
                value={shownBow}
                onChange={(e) => setPreview(Number(e.target.value) || 0)}
                onBlur={() => {
                  if (preview !== null) commit(preview);
                }}
                aria-label={t('builder.curveBow')}
              />
            </label>
            <p className="muted">{t('builder.curveAuto', { value: autoBow.toFixed(1) })}</p>
            <button
              onClick={() => {
                setPreview(null);
                setRouteBow(selectedRoute.id, undefined);
              }}
              disabled={selectedRoute.bow === undefined}
            >
              <RotateCcw size={14} aria-hidden /> {t('builder.curveReset')}
            </button>
          </>
        ) : (
          <>
            <p className="muted">{t('builder.curvesEmptyHint')}</p>
            {tunedCount > 0 && (
              <button onClick={clearAllRouteBows}>
                <RotateCcw size={14} aria-hidden /> {t('builder.curveResetAll', { n: tunedCount })}
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Register the stage**

1. `apps/web/src/features/builder/editor/store.ts` lines 4–5:

```ts
export type Stage =
  | 'crop'
  | 'trim'
  | 'stops'
  | 'routes'
  | 'curves'
  | 'missions'
  | 'rules'
  | 'share';
export const STAGES: readonly Stage[] = [
  'crop',
  'trim',
  'stops',
  'routes',
  'curves',
  'missions',
  'rules',
  'share',
];
```

2. `apps/web/src/features/builder/editor/EditorScreen.tsx`:
   - Extend the lucide import with `Spline`.
   - Add `import { CurvesStage } from './stages/CurvesStage';`
   - `STAGE_LABEL_KEY`: add `curves: 'builder.stageCurves',` after `routes: ...`.
   - `STAGE_ICON`: add `curves: Spline,` after `routes: Route,`.
   - In the stage render block, after the routes line:

```tsx
{
  stage === 'curves' && hasGeography && <CurvesStage />;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `yarn workspace @trm/web test --run CurvesStage` → PASS
Run: `yarn workspace @trm/web test` → full web suite PASS (Stage-union consumers are exhaustive `Record`s — typecheck catches any missed map).
Run: `yarn workspace @trm/web typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/editor/stages/CurvesStage.tsx apps/web/src/features/builder/editor/stages/CurvesStage.test.tsx apps/web/src/features/builder/editor/store.ts apps/web/src/features/builder/editor/EditorScreen.tsx
git commit -m "feat(web): Curves stage — tune route curvature in the map builder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification

**Files:** none (verification only; fix-forward anything found, committing per fix).

- [ ] **Step 1: Full repo gates**

Run from root, expect all green:

```bash
yarn typecheck
yarn lint
yarn test
yarn format:check
```

(If `format:check` complains about new files, run `yarn format` and amend nothing — commit the formatting as its own `style:` commit touching only this feature's files.)

- [ ] **Step 2: Builder chunk size**

Run: `yarn workspace @trm/web build`
Compare the builder lazy-chunk size against main; the Curves stage must not inflate the main bundle (it's inside the existing lazy chunk — verify the output lists it there).

- [ ] **Step 3: Live smoke test (the deliverable is visual)**

```bash
docker compose up -d mongo
yarn workspace @trm/server dev   # :3001
yarn workspace @trm/web dev      # :5173
```

As a registered user, open `/maps/:id/edit` on a map with geography + routes (create one if needed): verify the Curves rail step appears between 路線 and 任務; select a route; drag the apex handle (canvas must not pan while dragging); slide the slider; confirm reset-to-auto and reset-all; confirm a double pair bows together and stays a twin track; confirm undo (one entry per gesture) and that autosave settles ("已儲存").

- [ ] **Step 4: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 5: Docs touch-up commit (if needed)**

If anything in `apps/web/CLAUDE.md`'s builder stage list needs the new stage name (it enumerates Crop → Trim → Stops → Routes → Missions → Rules → Share), update that sentence to include Curves and commit:

```bash
git add apps/web/CLAUDE.md
git commit -m "docs(web): document the builder Curves stage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
