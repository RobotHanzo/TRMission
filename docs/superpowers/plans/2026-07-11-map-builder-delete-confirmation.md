# Map Builder Delete Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the map builder's "delete map" button behind a confirmation dialog that names the
specific map, instead of deleting immediately on click.

**Architecture:** Reuse the app's existing `useConfirmAction()` hook + `<ConfirmDialog>` component
(already used identically in `AppHeader.tsx` and `RoomScreen.tsx` for leave/close-room). Add one
piece of local state in `MapsScreen.tsx` to hold the pending map's display label, since
`useConfirmAction`'s `request(action)` only carries the closure to run on confirm, not display
data. No server, proto, or REST changes — `api.deleteMap` is called exactly as before, now gated
behind an explicit confirm step.

**Tech Stack:** React + TypeScript, react-i18next, vitest + @testing-library/react.

## Global Constraints

- UI ships in Traditional Chinese (primary) + English — every new user-facing string needs both
  `zh-Hant` and `en` entries in `apps/web/src/i18n/index.ts`, added at the matching key path in
  both tables (the file's own tests enforce the two tables share the same key tree).
- Follow the existing `leaveConfirmTitle`/`leaveConfirmBody` naming convention for confirm-dialog
  i18n keys, and the existing `useConfirmAction()` + `<ConfirmDialog>` wiring pattern verbatim —
  do not invent a new confirmation mechanism.
- No changes to `api.deleteMap`, the REST layer, or any server/proto code — this is a client-only
  UI gate in front of an existing, already-working delete call.

---

### Task 1: Confirm dialog before deleting a map

**Files:**
- Modify: `apps/web/src/features/builder/MapsScreen.tsx:1-12` (imports), `:14-29` (component
  state), `:92-95` (unchanged `remove()`, referenced not edited), `:140-146` (delete button),
  `:219-220` (add dialog render before the closing root `</div>`)
- Modify: `apps/web/src/i18n/index.ts:387` (zh `builder` block, after `editMap`), `:988` (en
  `builder` block, after `editMap`)
- Test: `apps/web/src/features/builder/MapsScreen.test.tsx`

**Interfaces:**
- Consumes: `useConfirmAction()` from `apps/web/src/hooks/useConfirmAction.ts` — returns
  `{ open: boolean; request: (action: () => void) => void; confirm: () => void; cancel: () => void }`.
  `<ConfirmDialog>` from `apps/web/src/components/ConfirmDialog.tsx` — props
  `{ title: string; message: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void }`.
  Existing `api.deleteMap(id: string): Promise<void>` and `MapSummary { id, nameZh, nameEn,
  revision, shareCode?, updatedAt }` from `apps/web/src/net/rest.ts`.
- Produces: nothing consumed by later tasks — this is the only task in the plan.

- [ ] **Step 1: Add the two new i18n keys (zh-Hant + en)**

In `apps/web/src/i18n/index.ts`, in the zh-Hant `builder` block, immediately after the
`editMap: '編輯',` line (currently line 387):

```ts
        editMap: '編輯',
        deleteMapConfirmTitle: '刪除地圖？',
        deleteMapConfirmBody: '確定要刪除「{{name}}」嗎？此動作無法復原。',
```

In the en `builder` block, immediately after the `editMap: 'Edit',` line (currently line 988):

```ts
        editMap: 'Edit',
        deleteMapConfirmTitle: 'Delete map?',
        deleteMapConfirmBody: 'Are you sure you want to delete "{{name}}"? This cannot be undone.',
```

- [ ] **Step 2: Write the failing test**

Append to `apps/web/src/features/builder/MapsScreen.test.tsx`. This file already mocks
`api.listMaps`/`listOfficialMaps`/`forkOfficialMap`; extend the `vi.mock('../../net/rest', ...)`
factory to also stub `deleteMap`:

```ts
vi.mock('../../net/rest', async () => {
  const actual = await vi.importActual<typeof Rest>('../../net/rest');
  return {
    ...actual,
    api: {
      ...actual.api,
      listMaps: vi.fn(),
      listOfficialMaps: vi.fn(),
      forkOfficialMap: vi.fn(),
      deleteMap: vi.fn(),
    },
  };
});
```

Add a new describe block at the end of the file:

```ts
describe('MapsScreen: delete confirmation', () => {
  const oneMap = [
    {
      id: 'm1',
      nameZh: '測試地圖',
      nameEn: 'Test Map',
      revision: 1,
      updatedAt: new Date().toISOString(),
    },
  ];

  it('asks for confirmation before deleting, naming the map', async () => {
    asMock(api.listMaps).mockResolvedValue(oneMap);
    asMock(api.deleteMap).mockResolvedValue(undefined);
    render(<MapsScreen />);
    const deleteBtn = await screen.findByRole('button', { name: '刪除' });
    fireEvent.click(deleteBtn);
    expect(api.deleteMap).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('確定要刪除「測試地圖 (Test Map)」嗎？此動作無法復原。')).toBeInTheDocument();
  });

  it('deletes and refreshes on confirm', async () => {
    asMock(api.listMaps).mockResolvedValue(oneMap);
    asMock(api.deleteMap).mockResolvedValue(undefined);
    render(<MapsScreen />);
    const deleteBtn = await screen.findByRole('button', { name: '刪除' });
    fireEvent.click(deleteBtn);
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(api.deleteMap).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(api.listMaps).toHaveBeenCalledTimes(2));
  });

  it('does not delete on cancel', async () => {
    asMock(api.listMaps).mockResolvedValue(oneMap);
    asMock(api.deleteMap).mockResolvedValue(undefined);
    render(<MapsScreen />);
    const deleteBtn = await screen.findByRole('button', { name: '刪除' });
    fireEvent.click(deleteBtn);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.deleteMap).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run MapsScreen`
Expected: FAIL — the delete button currently has no accessible name of `'刪除'` bound via
`aria-label`, and clicking it calls `api.deleteMap` immediately with no dialog ever appearing (or
the mock's missing `deleteMap` throws) — the three new tests in `MapsScreen: delete confirmation`
should fail; the pre-existing `MapsScreen: fork from official` test should still pass.

- [ ] **Step 4: Wire the confirm dialog into `MapsScreen.tsx`**

Add the imports (`apps/web/src/features/builder/MapsScreen.tsx:1-12`):

```tsx
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useConfirmAction } from '../../hooks/useConfirmAction';
```

Add state, right after the existing `const [forking, setForking] = useState<string | null>(null);`
line (currently line 28):

```tsx
  const [deleteLabel, setDeleteLabel] = useState('');
  const {
    open: deleteOpen,
    request: requestDelete,
    confirm: confirmDelete,
    cancel: cancelDelete,
  } = useConfirmAction();
```

Leave `remove()` (currently lines 92-95) exactly as-is:

```tsx
  const remove = async (id: string) => {
    await api.deleteMap(id).catch(() => undefined);
    refresh();
  };
```

Replace the delete button's `onClick` (currently lines 140-146):

```tsx
              <button
                className="danger icon-btn"
                onClick={() => {
                  setDeleteLabel(`${m.nameZh} (${m.nameEn})`);
                  requestDelete(() => void remove(m.id));
                }}
                aria-label={t('delete')}
              >
                <Trash2 size={14} aria-hidden />
              </button>
```

Render the dialog just before the root `</div>` that closes the component's return (currently the
`</div>` on line 220, right after the `maps-columns` row `</div>`):

```tsx
      {deleteOpen && (
        <ConfirmDialog
          title={t('builder.deleteMapConfirmTitle')}
          message={t('builder.deleteMapConfirmBody', { name: deleteLabel })}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run MapsScreen`
Expected: PASS — all four tests in `MapsScreen.test.tsx` (the pre-existing fork test plus the
three new delete-confirmation tests) pass.

- [ ] **Step 6: Typecheck**

Run: `yarn workspace @trm/web exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/builder/MapsScreen.tsx apps/web/src/features/builder/MapsScreen.test.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web): confirm before deleting a map in the builder"
```

## Self-Review

- **Spec coverage:** the spec's three requirements — confirm gate reusing the existing pattern,
  naming the specific map, and the two new i18n keys — are all covered by Task 1's steps 1 and 4.
  Testing section of the spec (open/confirm/cancel behavior) is covered by Task 1 steps 2-3, 5.
  "Out of scope" items (no undo, no changes to fork/clone flows) are correctly untouched.
- **Placeholder scan:** none — every step has literal code/commands.
- **Type consistency:** `deleteLabel: string`, `useConfirmAction()`'s returned shape, and
  `ConfirmDialog`'s props are used identically across steps 1, 2, and 4, matching the real
  signatures read from `apps/web/src/hooks/useConfirmAction.ts` and
  `apps/web/src/components/ConfirmDialog.tsx`.
