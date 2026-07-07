# Double Ferries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a custom map's double-route pair include ferry routes, and fix the map builder so an author can actually create/edit that combination without corrupting the sibling route.

**Architecture:** The engine (`@trm/engine`), `@trm/map-data`'s `validateContent`, the server's Zod schema, and the client's route rendering already treat `doubleGroup` and `ferryLocos` as fully independent per-route fields — nothing there needs to change. Tasks 1–2 add regression tests proving this (map-data validation, engine claim/payment/sibling-lock) since no code changes are needed at those layers. The real gap is the map builder's authoring flow (`apps/web/src/features/builder/editor/`): `store.ts`'s `convertToDouble` refuses ferries and, along with `RoutesStage.tsx`'s new-route-with-double path, mints the sibling by flipping color to RED/BLUE — which corrupts a ferry (must stay GRAY). Tasks 3–4 fix both call sites so a ferry source mirrors its color+locomotive count onto the sibling instead of flipping it.

**Tech Stack:** TypeScript across `@trm/map-data`, `@trm/engine` (pure reducer, vitest), and `apps/web` (React + zustand + vitest + @testing-library/react).

## Global Constraints

- No engine, schema, or rendering changes — confirmed independent already (see Architecture). Do not touch `packages/engine/src/reduce.ts`, `packages/engine/src/board.ts`, `packages/engine/src/payments.ts`, `apps/server/src/maps/maps.schemas.ts`, `apps/web/src/components/RouteShape.tsx`, or `apps/server/src/og/map-svg.ts`.
- Sibling default when doubling a ferry: **mirror** the source's GRAY color and `ferryLocos` count (settled with the user during design) — never flip to RED/BLUE for a ferry. Non-ferry routes keep today's RED/BLUE alternation unchanged.
- Tunnels remain excluded from "convert to double" — unchanged, out of scope.
- i18n: no new strings needed — existing `makeDouble`/`convertToDouble`/`ferryLocos` keys already describe the actions generically (per project CLAUDE.md's zh-Hant + English requirement, already satisfied).
- When staging/committing, add only the specific files each task touches — never `git add -A` (multiple agents may share this worktree, per project CLAUDE.md).
- Spec reference: `docs/superpowers/specs/2026-07-07-double-ferries-design.md`.

---

### Task 1: `@trm/map-data` — prove double-ferry pairs validate, and document the combo

**Files:**

- Create: `packages/map-data/test/double-ferry.spec.ts`
- Modify: `packages/map-data/CLAUDE.md`

**Interfaces:**

- Consumes: `validateContent` (`packages/map-data/src/validate.ts`, re-exported from `../src/index`), `testContent`/`ringRoutes` (`packages/map-data/test/fixtures.ts`) — all already exist, no changes.
- Produces: nothing consumed by later tasks — this task is a standalone regression proof.

This task adds tests only; `validateContent` already permits the combination (per the design's Background section: `ferryMustBeGray`/`ferryLocosExceedLength`/`ferryAndTunnel` and `doubleGroupWrongCount`/`doubleGroupDifferentPairs`/`doubleGroupLengthMismatch` run independently of each other). So there is no red step here — write the test, run it, and confirm it passes immediately as a regression guard.

- [ ] **Step 1: Write the test file**

Create `packages/map-data/test/double-ferry.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { asCityId, asRouteId } from '@trm/shared';
import type { RouteDef } from '../src/index';
import { validateContent } from '../src/index';
import { testContent, ringRoutes } from './fixtures';

describe('double-ferry routes (custom maps)', () => {
  it('accepts a double-route pair where both members are ferries', () => {
    const doubleFerryPair: RouteDef[] = [
      {
        id: asRouteId('DF1'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 1,
        isTunnel: false,
        doubleGroup: 'Z',
      },
      {
        id: asRouteId('DF2'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 2,
        isTunnel: false,
        doubleGroup: 'Z',
      },
    ];
    const content = testContent({ routes: [...ringRoutes(12), ...doubleFerryPair] });

    const result = validateContent(content);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.doublePairCount).toBe(1);
    expect(result.stats.ferryCount).toBe(2);
  });

  it('accepts a mixed double-route pair (one ferry, one plain colored route)', () => {
    const mixedPair: RouteDef[] = [
      {
        id: asRouteId('DF3'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 1,
        isTunnel: false,
        doubleGroup: 'Y',
      },
      {
        id: asRouteId('DF4'),
        a: asCityId('k0'),
        b: asCityId('k1'),
        color: 'RED',
        length: 2,
        ferryLocos: 0,
        isTunnel: false,
        doubleGroup: 'Y',
      },
    ];
    const content = testContent({ routes: [...ringRoutes(12), ...mixedPair] });

    const result = validateContent(content);

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.doublePairCount).toBe(1);
    expect(result.stats.ferryCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `yarn workspace @trm/map-data test --run double-ferry`
Expected: PASS — both cases green (no production code change needed at this layer).

- [ ] **Step 3: Document the combination**

In `packages/map-data/CLAUDE.md`, find this line (in the "Structure & invariants" section):

```
- Route flags carry mechanics: `doubleGroup` (A–J pairs), `ferryLocos > 0` (gray ferry, N locomotives
  required), `isTunnel`. The engine reads these directly, so they must match the intended rule.
```

Replace it with:

```
- Route flags carry mechanics: `doubleGroup` (A–J pairs), `ferryLocos > 0` (gray ferry, N locomotives
  required), `isTunnel`. The engine reads these directly, so they must match the intended rule.
  `doubleGroup` and `ferryLocos` may combine on custom maps — a "double ferry" pair where one or both
  members require locomotives — even though the bundled Taiwan map's own authoring convention
  (`routes.ts`) keeps every route at most one of double/tunnel/ferry.
```

- [ ] **Step 4: Typecheck**

Run: `yarn workspace @trm/map-data typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/map-data/test/double-ferry.spec.ts packages/map-data/CLAUDE.md
git commit -m "$(cat <<'EOF'
test(map-data): prove double-route pairs may include ferries

validateContent already checks ferry and double-group invariants
independently of each other; add regression coverage for both a
double-ferry pair and a mixed ferry+plain pair, and document the
combination as intentionally supported for custom maps.
EOF
)"
```

---

### Task 2: `@trm/engine` — prove claim/payment/sibling-lock work for a double-ferry pair

**Files:**

- Modify: `packages/engine/test/rules.spec.ts`

**Interfaces:**

- Consumes: `buildBoard` (`packages/engine/src/board.ts`, not yet imported in this test file), `reduce` (`packages/engine/src/reduce.ts`, already imported), the file's own local `st()` state builder and `p0`/`p1` player-id constants (already defined in this file, board-agnostic).
- Produces: nothing consumed by later tasks — standalone regression proof.

Like Task 1, this is a proof test — `packages/engine/src/board.ts`'s `siblingOf`/`buildBoard` and `packages/engine/src/payments.ts`'s `canAffordRoute`/`validateRoutePayment` never inspect each other's field, so no reducer change is needed. Every other test in this file uses the real bundled Taiwan content (`taiwanBoard()`), which has no double-ferry route by convention — so this task builds one small custom `Board` via `buildBoard()` just for these two tests.

- [ ] **Step 1: Write the tests**

In `packages/engine/test/rules.spec.ts`, add the import for `buildBoard` and `GameContent`. Replace:

```ts
import { taiwanBoard } from '../src/taiwan';
```

with:

```ts
import { taiwanBoard } from '../src/taiwan';
import { buildBoard } from '../src/board';
import type { GameContent } from '@trm/map-data';
```

Then insert a new `describe('double-ferry routes', ...)` block between the existing `describe('ferries', ...)` block and `describe('tunnels', ...)` block. Find:

```ts
  it('rejects a ferry payment without enough locomotives', () => {
    const state = st({ hands: { p0: { RED: 2 } } });
    const res = apply(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R88'),
      payment: { color: 'RED', colorCount: 2, locomotives: 0 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('FERRY_LOCOS_SHORT');
  });
});

describe('tunnels', () => {
```

Replace it with:

```ts
  it('rejects a ferry payment without enough locomotives', () => {
    const state = st({ hands: { p0: { RED: 2 } } });
    const res = apply(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('R88'),
      payment: { color: 'RED', colorCount: 2, locomotives: 0 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('FERRY_LOCOS_SHORT');
  });
});

describe('double-ferry routes', () => {
  // A small custom board with a double-route pair where BOTH members are ferries, with
  // different locomotive counts — proves doubleGroup (sibling lock) and ferryLocos (payment)
  // stay fully independent even on the same pair. taiwanBoard() has no such route by the
  // bundled map's own convention, so this content is purpose-built.
  const doubleFerryContent: GameContent = {
    meta: { mapId: 'test-double-ferry', version: 1, nameZh: '雙渡輪測試', nameEn: 'Double Ferry Test' },
    cities: [
      { id: asCityId('x1'), nameZh: '甲', nameEn: 'X1', x: 0, y: 0, region: 'test', isIsland: false },
      { id: asCityId('x2'), nameZh: '乙', nameEn: 'X2', x: 10, y: 0, region: 'test', isIsland: false },
    ],
    routes: [
      {
        id: asRouteId('DF1'),
        a: asCityId('x1'),
        b: asCityId('x2'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 1,
        isTunnel: false,
        doubleGroup: 'A',
      },
      {
        id: asRouteId('DF2'),
        a: asCityId('x1'),
        b: asCityId('x2'),
        color: 'GRAY',
        length: 2,
        ferryLocos: 2,
        isTunnel: false,
        doubleGroup: 'A',
      },
    ],
    tickets: [],
  };
  const doubleFerryBoard = buildBoard(doubleFerryContent);
  const apply2 = (state: GameState, action: Action) => reduce(doubleFerryBoard, state, action);

  it('locks the ferry sibling in a 2-player game, exactly like a non-ferry double route', () => {
    const state = st({ numPlayers: 2, hands: { p0: { RED: 1, LOCOMOTIVE: 1 } } });
    const res = apply2(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('DF1'),
      payment: { color: 'RED', colorCount: 1, locomotives: 1 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.ownership['DF1']).toEqual({ owner: p0 });
    expect(res.value.state.ownership['DF2']).toEqual({ locked: true });
  });

  it("keeps each side's locomotive requirement independent", () => {
    const state = st({
      numPlayers: 4,
      hands: { p0: { RED: 1, LOCOMOTIVE: 1 }, p1: { BLUE: 1, LOCOMOTIVE: 2 } },
    });
    const r1 = apply2(state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: asRouteId('DF1'),
      payment: { color: 'RED', colorCount: 1, locomotives: 1 },
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.state.ownership['DF2']).toBeUndefined(); // 4p: no sibling lock

    const underpaid = apply2(r1.value.state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('DF2'),
      payment: { color: 'BLUE', colorCount: 1, locomotives: 1 },
    });
    expect(underpaid.ok).toBe(false);
    if (underpaid.ok) return;
    expect(underpaid.error.code).toBe('FERRY_LOCOS_SHORT'); // DF2 needs 2 locos, not 1

    const r2 = apply2(r1.value.state, {
      t: 'CLAIM_ROUTE',
      player: p1,
      routeId: asRouteId('DF2'),
      payment: { color: null, colorCount: 0, locomotives: 2 },
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.ownership['DF2']).toEqual({ owner: p1 });
  });
});

describe('tunnels', () => {
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `yarn workspace @trm/engine test --run rules`
Expected: PASS — both new tests green alongside every existing test in the file (no production code change needed).

- [ ] **Step 3: Typecheck**

Run: `yarn workspace @trm/engine typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/test/rules.spec.ts
git commit -m "$(cat <<'EOF'
test(engine): prove double-route sibling lock and ferry payment stay
independent on a double-ferry pair

Builds a small custom board with a double-route pair where both
members are ferries (different locomotive counts each), confirming
the 2-3p sibling lock and per-route FERRY_LOCOS_SHORT validation
already compose correctly — no reducer change needed.
EOF
)"
```

---

### Task 3: Builder store — let `convertToDouble` mirror a ferry into the sibling

**Files:**

- Modify: `apps/web/src/features/builder/editor/store.ts`
- Test: `apps/web/src/features/builder/editor/store.test.ts`

**Interfaces:**

- Consumes: existing `EditorState.draft.routes: RouteDraft[]`, `nextDoubleGroupLetter`, `newRouteId`, `mutate()` — all already defined in this file, unchanged shapes.
- Produces (for Task 4 to consume): `convertToDouble(id: string): void` now succeeds for ferry routes too (previously a no-op when `ferryLocos > 0`), and its minted sibling has `color: 'GRAY'` + the same `ferryLocos` as the source whenever the source is a ferry.

- [ ] **Step 1: Update the failing/changed tests**

In `apps/web/src/features/builder/editor/store.test.ts`, find the existing test:

```ts
  it('convertToDouble is a no-op for tunnel, ferry, or already-double routes', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2'));
    s.addRoute(route('r1', 'c1', 'c2', { isTunnel: true }));
    s.addRoute(route('r2', 'c1', 'c2', { ferryLocos: 1, color: 'GRAY' }));
    s.addRoute(route('r3', 'c1', 'c2', { doubleGroup: 'A' }));

    s.convertToDouble('r1');
    s.convertToDouble('r2');
    s.convertToDouble('r3');

    expect(useEditorStore.getState().draft.routes).toHaveLength(3);
  });
```

Replace it with two tests — ferry is no longer a no-op case, so it gets its own positive test instead:

```ts
  it('convertToDouble is a no-op for tunnel or already-double routes', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2'));
    s.addRoute(route('r1', 'c1', 'c2', { isTunnel: true }));
    s.addRoute(route('r2', 'c1', 'c2', { doubleGroup: 'A' }));

    s.convertToDouble('r1');
    s.convertToDouble('r2');

    expect(useEditorStore.getState().draft.routes).toHaveLength(2);
  });

  it('convertToDouble mirrors a ferry route into a double-ferry pair', () => {
    const s = useEditorStore.getState();
    s.placeCity(city('c1'));
    s.placeCity(city('c2'));
    s.addRoute(
      route('r1', 'c1', 'c2', { color: 'GRAY', length: 3, ferryLocos: 2, isTunnel: false }),
    );

    s.convertToDouble('r1');

    const routes = useEditorStore.getState().draft.routes;
    expect(routes).toHaveLength(2);
    const original = routes.find((r) => r.id === 'r1')!;
    expect(original.doubleGroup).toBe('A');
    const sibling = routes.find((r) => r.id !== 'r1')!;
    expect(sibling).toMatchObject({
      a: 'c1',
      b: 'c2',
      length: 3,
      isTunnel: false,
      ferryLocos: 2,
      color: 'GRAY',
      doubleGroup: 'A',
    });
  });
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `yarn workspace @trm/web test --run store.test`
Expected: FAIL on `'convertToDouble mirrors a ferry route into a double-ferry pair'` — the store still no-ops on `ferryLocos > 0`, so `routes` stays length 1.

- [ ] **Step 3: Fix the store**

In `apps/web/src/features/builder/editor/store.ts`, find:

```ts
  convertToDouble: (id) => {
    const { draft } = get();
    const target = draft.routes.find((r) => r.id === id);
    if (!target || target.doubleGroup || target.isTunnel || target.ferryLocos > 0) return;
    const existingGroups = [
      ...new Set(draft.routes.map((r) => r.doubleGroup).filter(Boolean)),
    ] as string[];
    const group = nextDoubleGroupLetter(existingGroups);
    const sibling: RouteDraft = {
      ...target,
      id: newRouteId(),
      color: target.color === 'RED' ? 'BLUE' : 'RED',
      doubleGroup: group,
    };
    mutate(get, set, {
      ...draft,
      routes: [
        ...draft.routes.map((r) => (r.id === id ? { ...r, doubleGroup: group } : r)),
        sibling,
      ],
    });
  },
```

Replace it with:

```ts
  convertToDouble: (id) => {
    const { draft } = get();
    const target = draft.routes.find((r) => r.id === id);
    if (!target || target.doubleGroup || target.isTunnel) return;
    const existingGroups = [
      ...new Set(draft.routes.map((r) => r.doubleGroup).filter(Boolean)),
    ] as string[];
    const group = nextDoubleGroupLetter(existingGroups);
    // A ferry sibling must stay GRAY (validateContent's ferryMustBeGray) and mirrors the
    // source's locomotive count, so doubling a ferry produces a true double-ferry pair by
    // default; a plain route still gets the RED/BLUE alternation for visual distinction.
    const sibling: RouteDraft = {
      ...target,
      id: newRouteId(),
      color: target.ferryLocos > 0 ? target.color : target.color === 'RED' ? 'BLUE' : 'RED',
      doubleGroup: group,
    };
    mutate(get, set, {
      ...draft,
      routes: [
        ...draft.routes.map((r) => (r.id === id ? { ...r, doubleGroup: group } : r)),
        sibling,
      ],
    });
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run store.test`
Expected: PASS — every test in `store.test.ts` green, including the updated no-op test and the new mirroring test.

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/editor/store.ts apps/web/src/features/builder/editor/store.test.ts
git commit -m "$(cat <<'EOF'
fix(builder): let convertToDouble turn a ferry into a double-ferry pair

Previously a no-op for ferries, and would have corrupted the sibling's
color (forcing RED/BLUE on a route that must stay GRAY) if the guard
were simply dropped. The sibling now mirrors the source's GRAY color
and locomotive count when the source is a ferry.
EOF
)"
```

---

### Task 4: Routes stage UI — allow authoring double ferries

**Files:**

- Modify: `apps/web/src/features/builder/editor/stages/RoutesStage.tsx`
- Test: `apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx`

**Interfaces:**

- Consumes: `convertToDouble` from `../store` (Task 3's fixed behavior), `RouteDraft` type from `../../../../net/rest` (already imported in this file).
- Produces: nothing consumed elsewhere — top of the feature (UI-only).

- [ ] **Step 1: Extend the test fixtures and canvas mock**

In `apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx`, replace the `EditorCanvas` mock:

```tsx
vi.mock('../EditorCanvas', () => ({
  EditorCanvas: ({ onRouteClick }: { onRouteClick?: (id: string) => void }) => (
    <div data-testid="fake-canvas">
      <button type="button" onClick={() => onRouteClick?.('r1')}>
        route-r1
      </button>
      <button type="button" onClick={() => onRouteClick?.('r2')}>
        route-r2
      </button>
      <button type="button" onClick={() => onRouteClick?.('r3')}>
        route-r3
      </button>
    </div>
  ),
}));
```

with (adds a `route-r4` button for a ferry route, and `onCityClick` buttons for the new-route flow):

```tsx
vi.mock('../EditorCanvas', () => ({
  EditorCanvas: ({
    onRouteClick,
    onCityClick,
  }: {
    onRouteClick?: (id: string) => void;
    onCityClick?: (id: string) => void;
  }) => (
    <div data-testid="fake-canvas">
      <button type="button" onClick={() => onRouteClick?.('r1')}>
        route-r1
      </button>
      <button type="button" onClick={() => onRouteClick?.('r2')}>
        route-r2
      </button>
      <button type="button" onClick={() => onRouteClick?.('r3')}>
        route-r3
      </button>
      <button type="button" onClick={() => onRouteClick?.('r4')}>
        route-r4
      </button>
      <button type="button" onClick={() => onCityClick?.('c1')}>
        city-c1
      </button>
      <button type="button" onClick={() => onCityClick?.('c2')}>
        city-c2
      </button>
    </div>
  ),
}));
```

Then replace the `baseRoutes` fixture:

```tsx
const baseRoutes: RouteDraft[] = [
  { id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
  { id: 'r2', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: true },
  {
    id: 'r3',
    a: 'c1',
    b: 'c2',
    color: 'RED',
    length: 2,
    ferryLocos: 0,
    isTunnel: false,
    doubleGroup: 'A',
  },
];
```

with (adds `r4`, a plain single ferry route):

```tsx
const baseRoutes: RouteDraft[] = [
  { id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false },
  { id: 'r2', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: true },
  {
    id: 'r3',
    a: 'c1',
    b: 'c2',
    color: 'RED',
    length: 2,
    ferryLocos: 0,
    isTunnel: false,
    doubleGroup: 'A',
  },
  { id: 'r4', a: 'c1', b: 'c2', color: 'GRAY', length: 2, ferryLocos: 1, isTunnel: false },
];
```

- [ ] **Step 2: Add the failing tests**

In the same file, add these tests inside the `describe('RoutesStage', ...)` block, after the existing `'clicking convert-to-double turns the selected route into a double pair'` test:

```tsx
  it('shows the convert-to-double button for a ferry route', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r4'));

    expect(screen.getByText('轉換為雙軌路線')).toBeInTheDocument();
  });

  it('clicking convert-to-double on a ferry route mirrors it into a double-ferry pair', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r4'));
    fireEvent.click(screen.getByText('轉換為雙軌路線'));

    const routes = useEditorStore.getState().draft.routes;
    const original = routes.find((r) => r.id === 'r4')!;
    expect(original.doubleGroup).toBe('B'); // 'A' is already taken by r3
    const sibling = routes.find((r) => r.doubleGroup === 'B' && r.id !== 'r4');
    expect(sibling).toMatchObject({
      a: 'c1',
      b: 'c2',
      length: 2,
      isTunnel: false,
      ferryLocos: 1,
      color: 'GRAY',
    });
  });

  it('creates a mirrored double-ferry pair from the new-route form when ferry and make-double are both set', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('city-c2'));

    fireEvent.change(screen.getByLabelText('渡輪所需火車頭數'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('switch', { name: '建立為雙軌路線' }));
    fireEvent.click(screen.getByText('儲存'));

    const routes = useEditorStore.getState().draft.routes;
    const created = routes.filter((r) => !baseRoutes.some((b) => b.id === r.id));
    expect(created).toHaveLength(2);
    const [first, second] = created;
    expect(first).toMatchObject({ a: 'c1', b: 'c2', color: 'GRAY', ferryLocos: 2 });
    expect(second).toMatchObject({
      a: 'c1',
      b: 'c2',
      color: 'GRAY',
      ferryLocos: 2,
      doubleGroup: first!.doubleGroup,
    });
  });
```

- [ ] **Step 3: Run the tests to verify the new ones fail**

Run: `yarn workspace @trm/web test --run RoutesStage.test`
Expected: FAIL —
- `'shows the convert-to-double button for a ferry route'` fails because the button is still gated on `ferryLocos === 0`.
- `'clicking convert-to-double on a ferry route...'` fails for the same reason (button not found to click).
- `'creates a mirrored double-ferry pair from the new-route form...'` fails because the sibling still gets flipped to `RED`/`BLUE` instead of mirroring `GRAY`.

- [ ] **Step 4: Fix the button visibility gate**

In `apps/web/src/features/builder/editor/stages/RoutesStage.tsx`, find:

```tsx
            extra={
              <>
                {!selectedRoute.doubleGroup &&
                  !selectedRoute.isTunnel &&
                  selectedRoute.ferryLocos === 0 && (
                    <button onClick={() => convertToDouble(selectedRoute.id)}>
                      {t('builder.convertToDouble')}
                    </button>
                  )}
                <button className="danger" onClick={() => removeRoute(selectedRoute.id)}>
                  <Trash2 size={14} aria-hidden /> {t('builder.deleteRoute')}
                </button>
              </>
            }
```

Replace it with:

```tsx
            extra={
              <>
                {!selectedRoute.doubleGroup && !selectedRoute.isTunnel && (
                  <button onClick={() => convertToDouble(selectedRoute.id)}>
                    {t('builder.convertToDouble')}
                  </button>
                )}
                <button className="danger" onClick={() => removeRoute(selectedRoute.id)}>
                  <Trash2 size={14} aria-hidden /> {t('builder.deleteRoute')}
                </button>
              </>
            }
```

- [ ] **Step 5: Fix the new-route sibling mirroring**

In the same file, find:

```tsx
            onSubmit={(route, makeDouble) => {
              addRoute(route);
              if (makeDouble) {
                // route.doubleGroup is already set by RouteForm whenever makeDouble is true —
                // the spread carries it through, the sibling only needs a fresh id and colour.
                addRoute({
                  ...route,
                  id: newRouteId(),
                  color: route.color === 'RED' ? 'BLUE' : 'RED',
                });
              }
              setDraftPair(null);
            }}
```

Replace it with:

```tsx
            onSubmit={(route, makeDouble) => {
              addRoute(route);
              if (makeDouble) {
                // route.doubleGroup is already set by RouteForm whenever makeDouble is true —
                // the spread carries it through, the sibling only needs a fresh id and colour. A
                // ferry sibling mirrors the source's GRAY colour (and thus its locomotive count)
                // instead of the RED/BLUE alternation, since ferries must stay GRAY.
                addRoute({
                  ...route,
                  id: newRouteId(),
                  color:
                    route.ferryLocos > 0 ? route.color : route.color === 'RED' ? 'BLUE' : 'RED',
                });
              }
              setDraftPair(null);
            }}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run RoutesStage.test`
Expected: PASS — all tests in `RoutesStage.test.tsx` green, including the three new ones.

- [ ] **Step 7: Run the full web test suite and typecheck**

Run: `yarn workspace @trm/web test --run`
Expected: PASS — no regressions in any other builder test.

Run: `yarn workspace @trm/web typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/builder/editor/stages/RoutesStage.tsx apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx
git commit -m "$(cat <<'EOF'
feat(builder): support authoring double-ferry routes in the Routes stage

The convert-to-double button now shows for ferries too, and the
new-route "make this a double route" path mirrors a ferry's GRAY
color and locomotive count onto the sibling instead of flipping it to
RED/BLUE, which would have produced an invalid (non-GRAY) ferry.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** "no engine/validation/schema/rendering changes needed" → Tasks 1–2 (regression proof only, explicitly no production diff at those layers). "Sibling mirrors ferry stats" decision → Task 3's `convertToDouble` fix + Task 4's new-route `onSubmit` fix, both using the identical `ferryLocos > 0 ? color : (RED/BLUE flip)` rule. "Convert-to-double button shows for ferries" → Task 4 Step 4. "Each side stays independently editable after creation" → already true today (`RouteForm`'s edit branch never gated ferryLocos on doubleGroup), no task needed — verified in Background, not re-tested here since it's pre-existing behavior. "Tunnel/double stays excluded" → unchanged guard in Task 3 (`target.isTunnel` still blocks). Doc note → Task 1 Step 3.
- **Placeholder scan:** no TBD/TODO; every step has full code and exact commands with expected pass/fail outcomes.
- **Type consistency:** `convertToDouble(id: string): void` unchanged signature between Task 3 (definition) and Task 4 (call site `convertToDouble(selectedRoute.id)`). `RouteDraft`'s `color`/`ferryLocos`/`doubleGroup` field names match between `store.ts`, `RoutesStage.tsx`, and both test files throughout.
- **Out-of-scope items from the spec** (tunnel+double combos, RED/BLUE heuristic changes for non-ferry routes, engine/schema/rendering changes) have no tasks — intentionally, per spec.
