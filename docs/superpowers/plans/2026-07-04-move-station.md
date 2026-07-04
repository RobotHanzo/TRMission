# Move Station (map builder "Stops" stage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Move Station" control to the Stops stage of the custom map builder's inspector so an author can reposition an existing station in place, without deleting and re-adding it (which today cascades-deletes incident routes/tickets).

**Architecture:** Pure UI wiring in one existing component (`StopsStage.tsx`). A local `isMoving` boolean toggles "move mode"; while active, the next canvas background click calls the store's already-implemented (but currently unused) `moveCity(id, x, y)` instead of `placeCity(...)`. No store, type, or wire changes.

**Tech Stack:** React + TypeScript, Zustand (`editor/store.ts`), react-i18next, Vitest + @testing-library/react.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-move-station-design.md` (read it for full rationale).
- UI ships in **Traditional Chinese (primary) + English** — every new user-facing string needs both `zh-Hant` and `en` entries in `apps/web/src/i18n/index.ts`.
- Do **not** modify `EditorCanvas.tsx`, `editor/store.ts`, `net/rest.ts`, or any `@trm/map-data` type — `moveCity` and the `CityDraft`/`CityDef` shapes already provide everything this feature needs.
- Follow the existing icon+text button convention in this file (e.g. `<Trash2 size={14} aria-hidden /> {t('builder.deleteStop')}`) for the new button.
- `apps/web` uses `yarn workspace @trm/web test` (Vitest) and `yarn workspace @trm/web typecheck`/`yarn lint` from repo root for verification.

---

### Task 1: Move Station button, move mode, and tests

**Files:**
- Modify: `apps/web/src/i18n/index.ts` (zh-Hant block ~line 330, en block ~line 752)
- Modify: `apps/web/src/features/builder/editor/stages/StopsStage.tsx` (full file, 120 lines today)
- Create: `apps/web/src/features/builder/editor/stages/StopsStage.test.tsx`

**Interfaces:**
- Consumes: `useEditorStore().moveCity(id: string, x: number, y: number): void` — already implemented in `editor/store.ts:166-172`, patches `draft.cities` through the existing undo/autosave `mutate()` path. `useEditorStore().draft.cities: CityDraft[]` where `CityDraft = { id: string; nameZh: string; nameEn: string; x: number; y: number; region: string; isIsland: boolean }` (`net/rest.ts`).
- Produces: no new exports — `StopsStage` remains a default-less named export with the same `export function StopsStage()` signature `EditorScreen.tsx` already imports.

- [ ] **Step 1: Add the zh-Hant (primary) i18n keys**

In `apps/web/src/i18n/index.ts`, find this block (~line 325-332):

```ts
        stopsHint: '點擊空白處新增車站，點擊車站以編輯',
        stopsEmptyHint: '點擊地圖以新增車站，或點擊現有車站以編輯',
        editStop: '編輯車站',
        region: '地區',
        isIsland: '離島',
        deleteStop: '刪除車站',
        confirmDelete: '確認刪除',
        confirmDeleteStop: '將一併移除 {{routes}} 條路線與 {{tickets}} 張任務卡，確定刪除？',
```

Replace it with:

```ts
        stopsHint: '點擊空白處新增車站，點擊車站以編輯',
        stopsEmptyHint: '點擊地圖以新增車站，或點擊現有車站以編輯',
        editStop: '編輯車站',
        region: '地區',
        isIsland: '離島',
        moveStop: '移動車站',
        cancelMove: '取消移動',
        moveStopHint: '點擊地圖以將「{{name}}」移動到新位置',
        deleteStop: '刪除車站',
        confirmDelete: '確認刪除',
        confirmDeleteStop: '將一併移除 {{routes}} 條路線與 {{tickets}} 張任務卡，確定刪除？',
```

- [ ] **Step 2: Add the English i18n keys**

In the same file, find the English block (~line 747-754):

```ts
        stopsHint: 'Click empty space to add a stop; click a stop to edit it',
        stopsEmptyHint: 'Click the map to add a stop, or click an existing stop to edit it',
        editStop: 'Edit stop',
        region: 'Region',
        isIsland: 'Island',
        deleteStop: 'Delete stop',
        confirmDelete: 'Confirm delete',
        confirmDeleteStop:
          'This will also remove {{routes}} route(s) and {{tickets}} ticket(s). Delete anyway?',
```

Replace it with:

```ts
        stopsHint: 'Click empty space to add a stop; click a stop to edit it',
        stopsEmptyHint: 'Click the map to add a stop, or click an existing stop to edit it',
        editStop: 'Edit stop',
        region: 'Region',
        isIsland: 'Island',
        moveStop: 'Move station',
        cancelMove: 'Cancel move',
        moveStopHint: "Click the map to move '{{name}}' to a new location",
        deleteStop: 'Delete stop',
        confirmDelete: 'Confirm delete',
        confirmDeleteStop:
          'This will also remove {{routes}} route(s) and {{tickets}} ticket(s). Delete anyway?',
```

- [ ] **Step 3: Write the failing tests**

Create `apps/web/src/features/builder/editor/stages/StopsStage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../../../../i18n';
import { StopsStage } from './StopsStage';
import { useEditorStore } from '../store';
import type { CityDraft } from '../../../../net/rest';

// EditorCanvas's real background/city clicks go through SVG screen-CTM math
// (clientToBoardPoint) that jsdom doesn't implement (no createSVGPoint), so a real <svg> click
// never reaches onBackgroundClick under Vitest. Stub it with plain buttons that call the same
// callbacks directly, so these tests exercise StopsStage's own move/place branching — the actual
// unit under test — instead of failing to fire at all.
vi.mock('../EditorCanvas', () => ({
  EditorCanvas: ({
    onBackgroundClick,
    onCityClick,
  }: {
    onBackgroundClick?: (point: { x: number; y: number }) => void;
    onCityClick?: (id: string) => void;
  }) => (
    <div data-testid="fake-canvas">
      <button type="button" onClick={() => onBackgroundClick?.({ x: 42, y: 17 })}>
        background
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

const baseCities: CityDraft[] = [
  { id: 'c1', nameZh: '甲', nameEn: 'A', x: 10, y: 50, region: 'r', isIsland: false },
  { id: 'c2', nameZh: '乙', nameEn: 'B', x: 60, y: 50, region: 'r', isIsland: false },
];

beforeEach(() => {
  useEditorStore.setState({
    mapId: 'm1',
    loadState: 'ready',
    nameZh: '',
    nameEn: '',
    draft: { cities: baseCities.map((c) => ({ ...c })), routes: [], tickets: [] },
    revision: 0,
    shareCode: undefined,
    stage: 'stops',
    selection: null,
    dirty: false,
    saving: false,
    saveError: null,
    undoStack: [],
    redoStack: [],
  });
});

describe('StopsStage', () => {
  it('does not show the move button when no station is selected', () => {
    render(<StopsStage />);
    expect(screen.queryByText('移動車站')).not.toBeInTheDocument();
  });

  it('selecting a station shows the move button and the normal hint', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));

    expect(screen.getByText('移動車站')).toBeInTheDocument();
    expect(screen.getByText('點擊空白處新增車站，點擊車站以編輯')).toBeInTheDocument();
  });

  it('clicking move swaps the button label and the canvas hint', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    expect(screen.getByText('取消移動')).toBeInTheDocument();
    expect(screen.getByText('點擊地圖以將「甲」移動到新位置')).toBeInTheDocument();
  });

  it('clicking the canvas in move mode moves the selected station instead of adding one', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    fireEvent.click(screen.getByText('background'));

    const state = useEditorStore.getState();
    expect(state.draft.cities).toHaveLength(2);
    expect(state.draft.cities.find((c) => c.id === 'c1')).toMatchObject({ x: 42, y: 17 });
    expect(state.selection).toEqual({ kind: 'city', id: 'c1' });
    expect(screen.getByText('移動車站')).toBeInTheDocument();
  });

  it('clicking the canvas without move mode still adds a new station as before', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('background'));

    const state = useEditorStore.getState();
    expect(state.draft.cities).toHaveLength(3);
    expect(state.draft.cities.find((c) => c.id === 'c1')).toMatchObject({ x: 10, y: 50 });
  });

  it('Escape cancels move mode without changing the station position', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByText('移動車站')).toBeInTheDocument();
    expect(useEditorStore.getState().draft.cities.find((c) => c.id === 'c1')).toMatchObject({
      x: 10,
      y: 50,
    });
  });

  it('selecting a different station cancels move mode for the original one', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    fireEvent.click(screen.getByText('city-c2'));

    expect(screen.getByText('移動車站')).toBeInTheDocument();
    expect(screen.queryByText('取消移動')).not.toBeInTheDocument();
  });

  it('deleting the selected station exits move mode along with the inspector', () => {
    render(<StopsStage />);
    fireEvent.click(screen.getByText('city-c1'));
    fireEvent.click(screen.getByText('移動車站'));

    fireEvent.click(screen.getByText('刪除車站'));
    fireEvent.click(screen.getByText('確認刪除'));

    expect(useEditorStore.getState().draft.cities).toHaveLength(1);
    expect(screen.getByText('點擊地圖以新增車站，或點擊現有車站以編輯')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run StopsStage`
Expected: FAIL — `StopsStage.test.tsx` can't find the "移動車站" text (the button doesn't exist yet) and/or the move-mode assertions fail, since `StopsStage.tsx` doesn't yet implement any of this.

- [ ] **Step 5: Implement the move button and move mode**

Replace the full contents of `apps/web/src/features/builder/editor/stages/StopsStage.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Move, Trash2 } from 'lucide-react';
import { Switch } from '../../../../components/ui/Switch';
import { EditorCanvas } from '../EditorCanvas';
import { useEditorStore } from '../store';

let nextCityCounter = 0;
const newCityId = (): string => `c${Date.now().toString(36)}${(nextCityCounter++).toString(36)}`;

export function StopsStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const placeCity = useEditorStore((s) => s.placeCity);
  const updateCity = useEditorStore((s) => s.updateCity);
  const removeCity = useEditorStore((s) => s.removeCity);
  const moveCity = useEditorStore((s) => s.moveCity);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  const selected =
    selection?.kind === 'city' ? draft.cities.find((c) => c.id === selection.id) : undefined;

  // Leaving the selection (deselect, pick a different station, or delete it) always cancels an
  // in-flight move — there's no "moving station" once it's no longer the selected one.
  useEffect(() => {
    setIsMoving(false);
  }, [selected?.id]);

  useEffect(() => {
    if (!isMoving) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMoving(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMoving]);

  const incidentRoutes = selected
    ? draft.routes.filter((r) => r.a === selected.id || r.b === selected.id).length
    : 0;
  const incidentTickets = selected
    ? draft.tickets.filter((tk) => tk.a === selected.id || tk.b === selected.id).length
    : 0;

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <EditorCanvas
          onBackgroundClick={(pt) => {
            const x = Math.round(pt.x * 10) / 10;
            const y = Math.round(pt.y * 10) / 10;
            if (isMoving && selected) {
              moveCity(selected.id, x, y);
              setIsMoving(false);
              return;
            }
            const id = newCityId();
            placeCity({
              id,
              // A default content name in both languages, independent of the builder UI's
              // current locale — the user renames it via the inspector immediately after.
              nameZh: '新車站',
              nameEn: 'New Stop',
              x,
              y,
              region: '',
              isIsland: false,
            });
            select({ kind: 'city', id });
          }}
          onCityClick={(id) => select({ kind: 'city', id })}
        />
        <p className="muted editor-hint">
          {isMoving && selected
            ? t('builder.moveStopHint', { name: selected.nameZh })
            : t('builder.stopsHint')}
        </p>
      </div>
      <aside className="card stack editor-inspector">
        {selected ? (
          <>
            <h3>{t('builder.editStop')}</h3>
            <label className="field">
              <span className="field-label">{t('builder.nameZh')}</span>
              <input
                value={selected.nameZh}
                onChange={(e) => updateCity(selected.id, { nameZh: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('builder.nameEn')}</span>
              <input
                value={selected.nameEn}
                onChange={(e) => updateCity(selected.id, { nameEn: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('builder.region')}</span>
              <input
                value={selected.region}
                onChange={(e) => updateCity(selected.id, { region: e.target.value })}
              />
            </label>
            <div className="row between setting-row">
              <span className="field-label">{t('builder.isIsland')}</span>
              <Switch
                checked={selected.isIsland}
                onChange={(v) => updateCity(selected.id, { isIsland: v })}
                label={t('builder.isIsland')}
              />
            </div>
            <button type="button" onClick={() => setIsMoving((v) => !v)}>
              <Move size={14} aria-hidden /> {isMoving ? t('builder.cancelMove') : t('builder.moveStop')}
            </button>
            {confirmDelete ? (
              <div className="stack">
                <p className="muted">
                  {t('builder.confirmDeleteStop', {
                    routes: incidentRoutes,
                    tickets: incidentTickets,
                  })}
                </p>
                <div className="row">
                  <button
                    className="danger"
                    onClick={() => {
                      removeCity(selected.id);
                      setConfirmDelete(false);
                    }}
                  >
                    {t('builder.confirmDelete')}
                  </button>
                  <button onClick={() => setConfirmDelete(false)}>{t('cancel')}</button>
                </div>
              </div>
            ) : (
              <button className="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} aria-hidden /> {t('builder.deleteStop')}
              </button>
            )}
          </>
        ) : (
          <p className="muted">{t('builder.stopsEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run StopsStage`
Expected: PASS — all 8 tests in `StopsStage.test.tsx` green.

- [ ] **Step 7: Typecheck and lint**

Run: `yarn typecheck && yarn lint`
Expected: both exit 0. (`yarn typecheck` runs `tsc --noEmit` across all workspaces; `yarn lint` runs `eslint .`.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/i18n/index.ts apps/web/src/features/builder/editor/stages/StopsStage.tsx apps/web/src/features/builder/editor/stages/StopsStage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): add move-station control to the map builder Stops stage

Wires the already-implemented but unused moveCity store action to a new
"Move Station" inspector button, so relocating a station no longer
requires deleting and re-adding it (which cascades incident routes/tickets).
EOF
)"
```

---

## Self-Review

**Spec coverage:** Every behavior in `docs/superpowers/specs/2026-07-04-move-station-design.md`'s Flow section (button visibility, mode toggle, click-to-relocate, the four cancel triggers, i18n keys, no store/EditorCanvas changes) has a corresponding step and/or test above.

**Placeholders:** None — all steps show complete, runnable code (full file contents for the modified component, full new test file, exact i18n diffs with surrounding context).

**Type consistency:** `moveCity(id: string, x: number, y: number)` is called with the same signature it's declared with in `editor/store.ts`. `CityDraft` fields (`nameZh`, `nameEn`, `x`, `y`, `region`, `isIsland`) match exactly what `placeCity` already sends and what the test fixtures use. The test's mocked `EditorCanvas` prop types (`onBackgroundClick`, `onCityClick`) match `EditorCanvasProps` in `EditorCanvas.tsx`.
