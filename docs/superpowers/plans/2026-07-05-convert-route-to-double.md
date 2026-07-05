# Convert Route to Double Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Convert to double" button to the map builder's Routes stage so an author can turn an already-existing single route into a double-track pair in place, instead of deleting and redrawing it.

**Architecture:** A new atomic `convertToDouble(id)` action on the builder's `editor/store.ts` zustand store patches the target route with a freshly-picked double-group letter and appends a twin sibling route in a single undo step. `RoutesStage.tsx` renders a new button (gated on the route being a plain, non-double, non-tunnel, non-ferry route) that calls this action, and a shared `nextDoubleGroupLetter` helper replaces the duplicate letter-picking logic that used to live only inside the create-route form.

**Tech Stack:** React + TypeScript, zustand (`editor/store.ts`), vitest + @testing-library/react, react-i18next.

## Global Constraints

- UI strings ship in **both** Traditional Chinese (primary) and English — every new i18n key needs both `zh-Hant` and `en` entries (per project CLAUDE.md).
- Double-pair mutations must land as **one** `mutate()` call (one undo-stack entry) — the codebase already treats double-pair edits (`setRouteBow`, `removeRoute`'s cascade) as atomic; a two-call approach would let `undo()` leave the draft in a state that fails `validateContent`'s `doubleGroupWrongCount` check.
- Eligibility for the new button: the selected route must have no `doubleGroup`, `isTunnel` must be `false`, and `ferryLocos` must be `0` (per the approved spec — doubles are never tunnels or ferries in this game).
- Sibling color uses the existing alternation heuristic: `color === 'RED' ? 'BLUE' : 'RED'`.
- When staging/committing, add only the specific files each task touches — never `git add -A` (multiple agents may share this worktree, per project CLAUDE.md).
- Spec reference: `docs/superpowers/specs/2026-07-05-convert-route-to-double-design.md`.

---

### Task 1: Editor store — `convertToDouble` action + shared helpers

**Files:**

- Modify: `apps/web/src/features/builder/editor/store.ts`
- Test: `apps/web/src/features/builder/editor/store.test.ts`

**Interfaces:**

- Consumes: existing `EditorState.draft: MapDraft`, `RouteDraft` type from `../../../net/rest` (already imported in `store.ts`), existing `mutate(get, set, next)` helper (`store.ts`, local to the file).
- Produces (for Task 2 to consume):
  - `export const newRouteId: () => string` — mints a unique route id (moved here from `RoutesStage.tsx`, which currently declares its own copy).
  - `export function nextDoubleGroupLetter(existingGroups: readonly string[]): string` — first letter in `'ABCDEFGHIJ'` not present in `existingGroups`; falls back to `'A'` if all ten are taken.
  - `EditorState.convertToDouble(id: string): void` — new store action.

- [ ] **Step 1: Write the failing tests**

Open `apps/web/src/features/builder/editor/store.test.ts`. Find the existing test `'frees a double-route sibling when its pair partner is deleted'` (it ends around line 112, right before `'clears the selection when the selected city/route is removed'`). Insert the following four tests immediately after it (before the `'clears the selection...'` test):

```ts
it('convertToDouble assigns a doubleGroup and creates a matching sibling route', () => {
  const s = useEditorStore.getState();
  s.placeCity(city('c1'));
  s.placeCity(city('c2'));
  s.addRoute(route('r1', 'c1', 'c2', { color: 'RED', length: 3, isTunnel: false, ferryLocos: 0 }));

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
    ferryLocos: 0,
    doubleGroup: 'A',
    color: 'BLUE',
  });
});

it('convertToDouble picks the next free double-group letter', () => {
  const s = useEditorStore.getState();
  s.placeCity(city('c1'));
  s.placeCity(city('c2'));
  s.placeCity(city('c3'));
  s.addRoute(route('r1', 'c1', 'c2', { doubleGroup: 'A' }));
  s.addRoute(route('r2', 'c1', 'c2', { doubleGroup: 'A' }));
  s.addRoute(route('r3', 'c2', 'c3'));

  s.convertToDouble('r3');

  const routes = useEditorStore.getState().draft.routes;
  expect(routes.find((r) => r.id === 'r3')!.doubleGroup).toBe('B');
});

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

it('reverts convertToDouble in a single undo step', () => {
  const s = useEditorStore.getState();
  s.placeCity(city('c1'));
  s.placeCity(city('c2'));
  s.addRoute(route('r1', 'c1', 'c2'));

  s.convertToDouble('r1');
  expect(useEditorStore.getState().draft.routes).toHaveLength(2);

  useEditorStore.getState().undo();

  const routes = useEditorStore.getState().draft.routes;
  expect(routes).toHaveLength(1);
  expect(routes[0]).toMatchObject({ id: 'r1' });
  expect(routes[0]!.doubleGroup).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run store.test`
Expected: FAIL — `TypeError: s.convertToDouble is not a function` (the action doesn't exist yet).

- [ ] **Step 3: Implement the store changes**

In `apps/web/src/features/builder/editor/store.ts`, replace the `emptyDraft` line and everything up to (but not including) `interface EditorState {` with:

```ts
const emptyDraft = (): MapDraft => ({ cities: [], routes: [], tickets: [] });

let nextRouteCounter = 0;
/** Mints a unique route id for a newly authored route or double-pair sibling. */
export const newRouteId = (): string =>
  `r${Date.now().toString(36)}${(nextRouteCounter++).toString(36)}`;

const DOUBLE_GROUP_LETTERS = 'ABCDEFGHIJ';
/** First double-group letter (A-J) not already used by `existingGroups`; falls back to 'A' once
 *  all ten are taken (a builder-side limit, not enforced elsewhere). */
export function nextDoubleGroupLetter(existingGroups: readonly string[]): string {
  for (const letter of DOUBLE_GROUP_LETTERS) {
    if (!existingGroups.includes(letter)) return letter;
  }
  return 'A';
}
```

Then, in the `EditorState` interface, add the new method right after `removeRoute(id: string): void;`:

```ts
  removeRoute(id: string): void;
  convertToDouble(id: string): void;
```

Then, in the store implementation (`create<EditorState>()((set, get) => ({ ... }))`), add the new action right after the `removeRoute` implementation (which ends just before `setRouteBow: (id, bow) => {`):

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run store.test`
Expected: PASS — all tests in `store.test.ts` green, including the four new ones.

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/builder/editor/store.ts apps/web/src/features/builder/editor/store.test.ts
git commit -m "$(cat <<'EOF'
feat(builder): add convertToDouble store action

Lets a single route be turned into a double-track pair in one atomic
mutation (one undo step), with a shared next-free-letter helper so the
create-route double toggle and this new action don't duplicate the
A-J scan.
EOF
)"
```

---

### Task 2: Routes stage UI — "Convert to double" button

**Files:**

- Modify: `apps/web/src/features/builder/editor/stages/RoutesStage.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx` (new file)

**Interfaces:**

- Consumes: `newRouteId`, `nextDoubleGroupLetter`, and `EditorState.convertToDouble` from `../store` (Task 1). `RouteDraft` type from `../../../../net/rest` (already imported in this file).
- Produces: nothing new consumed elsewhere — this is the top of the feature (UI-only).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { RoutesStage } from './RoutesStage';
import { useEditorStore } from '../store';
import type { CityDraft, RouteDraft } from '../../../../net/rest';

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

const baseCities: CityDraft[] = [
  { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 50, region: 'r', isIsland: false },
  { id: 'c2', nameZh: '乙', nameEn: 'B', x: 60, y: 50, region: 'r', isIsland: false },
];

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

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: {
      cities: baseCities.map((c) => ({ ...c })),
      routes: baseRoutes.map((r) => ({ ...r })),
      tickets: [],
    },
    revision: 0,
    shareCode: undefined,
    stage: 'routes',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

describe('RoutesStage', () => {
  it('shows the convert-to-double button for a plain single route', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));

    expect(screen.getByText('轉換為雙軌路線')).toBeInTheDocument();
  });

  it('hides the convert-to-double button for a tunnel route', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r2'));

    expect(screen.queryByText('轉換為雙軌路線')).not.toBeInTheDocument();
  });

  it('hides the convert-to-double button for a route that is already part of a double pair', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r3'));

    expect(screen.queryByText('轉換為雙軌路線')).not.toBeInTheDocument();
  });

  it('clicking convert-to-double turns the selected route into a double pair', () => {
    render(<RoutesStage />);
    fireEvent.click(screen.getByText('route-r1'));
    fireEvent.click(screen.getByText('轉換為雙軌路線'));

    const routes = useEditorStore.getState().draft.routes;
    const original = routes.find((r) => r.id === 'r1')!;
    expect(original.doubleGroup).toBe('B'); // 'A' is already taken by r3
    const sibling = routes.find((r) => r.doubleGroup === 'B' && r.id !== 'r1');
    expect(sibling).toMatchObject({
      a: 'c1',
      b: 'c2',
      length: 2,
      isTunnel: false,
      ferryLocos: 0,
      color: 'BLUE',
    });
    expect(screen.queryByText('轉換為雙軌路線')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run RoutesStage.test`
Expected: FAIL — the button text `轉換為雙軌路線` is never found (i18n key doesn't exist yet and the button isn't rendered).

- [ ] **Step 3: Add the i18n keys**

In `apps/web/src/i18n/index.ts`, find the zh-Hant block containing `makeDouble: '建立為雙軌路線',` (around line 432) and add a new line immediately after it:

```ts
        makeDouble: '建立為雙軌路線',
        convertToDouble: '轉換為雙軌路線',
        deleteRoute: '刪除路線',
```

Then find the English block containing `makeDouble: 'Make this a double route',` (around line 964) and add a new line immediately after it:

```ts
        makeDouble: 'Make this a double route',
        convertToDouble: 'Convert to double route',
        deleteRoute: 'Delete route',
```

- [ ] **Step 4: Wire up the store in `RoutesStage.tsx`**

In `apps/web/src/features/builder/editor/stages/RoutesStage.tsx`, replace the top of the file (imports through the `newRouteId` declaration):

```tsx
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
import { useEditorStore } from '../store';
import type { RouteDraft } from '../../../../net/rest';

const ROUTE_COLORS: readonly RouteColor[] = [...TRAIN_COLORS, 'GRAY'];
let nextRouteCounter = 0;
const newRouteId = (): string => `r${Date.now().toString(36)}${(nextRouteCounter++).toString(36)}`;
```

with:

```tsx
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
import { useEditorStore, newRouteId, nextDoubleGroupLetter } from '../store';
import type { RouteDraft } from '../../../../net/rest';

const ROUTE_COLORS: readonly RouteColor[] = [...TRAIN_COLORS, 'GRAY'];
```

- [ ] **Step 5: Read the store's `convertToDouble` action and add the button**

In `RoutesStage()`, add a new selector next to the others (after `const removeRoute = useEditorStore((s) => s.removeRoute);`):

```tsx
const removeRoute = useEditorStore((s) => s.removeRoute);
const convertToDouble = useEditorStore((s) => s.convertToDouble);
```

Then replace the `selectedRoute` branch's `RouteForm` call:

```tsx
        ) : selectedRoute ? (
          <RouteForm
            title={t('builder.editRoute', {
              a: cityName(selectedRoute.a),
              b: cityName(selectedRoute.b),
            })}
            initial={selectedRoute}
            existingDoubleGroups={[]}
            hideDouble
            onCancel={() => select(null)}
            onSubmit={(route) => updateRoute(selectedRoute.id, route)}
            extra={
              <button className="danger" onClick={() => removeRoute(selectedRoute.id)}>
                <Trash2 size={14} aria-hidden /> {t('builder.deleteRoute')}
              </button>
            }
          />
```

with:

```tsx
        ) : selectedRoute ? (
          <RouteForm
            title={t('builder.editRoute', {
              a: cityName(selectedRoute.a),
              b: cityName(selectedRoute.b),
            })}
            initial={selectedRoute}
            existingDoubleGroups={[]}
            hideDouble
            onCancel={() => select(null)}
            onSubmit={(route) => updateRoute(selectedRoute.id, route)}
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
          />
```

- [ ] **Step 6: Replace `RouteForm`'s local letter-picking logic with the shared helper**

In the same file, inside `RouteForm`, remove the local `nextDoubleGroup` function:

```tsx
  const [makeDouble, setMakeDouble] = useState(false);
  const isFerry = ferryLocos > 0;

  const nextDoubleGroup = (): string => {
    const letters = 'ABCDEFGHIJ';
    for (const l of letters) if (!existingDoubleGroups.includes(l)) return l;
    return 'A';
  };

  const colorOptions: DropdownOption<RouteColor>[] = ROUTE_COLORS.map((c) => {
```

becomes:

```tsx
  const [makeDouble, setMakeDouble] = useState(false);
  const isFerry = ferryLocos > 0;

  const colorOptions: DropdownOption<RouteColor>[] = ROUTE_COLORS.map((c) => {
```

Then update its only call site:

```tsx
                ...(makeDouble ? { doubleGroup: nextDoubleGroup() } : {}),
```

becomes:

```tsx
                ...(makeDouble ? { doubleGroup: nextDoubleGroupLetter(existingDoubleGroups) } : {}),
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run RoutesStage.test`
Expected: PASS — all four tests in `RoutesStage.test.tsx` green.

- [ ] **Step 8: Run the full web test suite and typecheck**

Run: `yarn workspace @trm/web test --run`
Expected: PASS — no regressions (in particular `store.test.ts` from Task 1 still green, and no other file referenced the now-removed `RoutesStage.tsx`-local `newRouteId`/`nextDoubleGroup`).

Run: `yarn workspace @trm/web typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/builder/editor/stages/RoutesStage.tsx apps/web/src/features/builder/editor/stages/RoutesStage.test.tsx apps/web/src/i18n/index.ts
git commit -m "$(cat <<'EOF'
feat(builder): add convert-to-double button to Routes stage

Editing an existing single route now offers a one-click "convert to
double" action (hidden for tunnels, ferries, and routes already part
of a pair) instead of requiring delete-and-redraw with the
create-flow's double toggle.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** eligibility gating (tunnel/ferry/already-double) → Task 2 Step 5 condition + tests; auto-alternating sibling color → Task 1's `convertToDouble` + test; single atomic undo step → Task 1's `mutate()` call + dedicated undo test; shared next-free-letter helper → Task 1's `nextDoubleGroupLetter` + Task 2 Step 6 refactor of `RouteForm`; i18n zh/en keys → Task 2 Step 3; button placement next to Delete → Task 2 Step 5.
- **Out-of-scope items from the spec** (double→single conversion, color-picker changes beyond the existing heuristic) have no tasks — intentionally, per spec.
- **Type consistency:** `convertToDouble(id: string): void` in Task 1's interface matches the call `convertToDouble(selectedRoute.id)` in Task 2; `nextDoubleGroupLetter(existingGroups: readonly string[]): string` matches both call sites (`store.ts` passing a `string[]`, `RoutesStage.tsx` passing the `existingDoubleGroups` prop, itself a `string[]`).
