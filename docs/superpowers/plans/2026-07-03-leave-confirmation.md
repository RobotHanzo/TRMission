# Leave confirmation + clickable header logo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmation dialog to every action that leaves an active room/game (lobby leave,
header leave button, new clickable header logo, post-game leave), plus a native `beforeunload`
warning for accidental tab close/refresh while in a room or game.

**Architecture:** One generic `ConfirmDialog` modal (reusing the existing `.modal-backdrop`/`.modal`
pattern) plus one small `useConfirmAction` hook (holds a pending action until confirmed/cancelled),
consumed at three existing "leave" call sites (`RoomScreen`, `AppHeader`, `GameScreen`) and one new
one (the header brand becoming clickable). A separate `useLeaveWarning` hook wires the native
`beforeunload` prompt in `App.tsx`, scoped to `view === 'room' || view === 'game'`.

**Tech Stack:** React + TypeScript, zustand (`useUi`, `useGame`), react-i18next, Vitest +
`@testing-library/react`.

## Global Constraints

- UI copy ships in **both** `zh-Hant` (primary) and `en` in `src/i18n/index.ts` — every new string
  needs both.
- Follow the existing modal convention exactly: `.modal-backdrop` (click = cancel) wrapping `.modal`
  with `role="dialog"` `aria-modal="true"`, inner click `stopPropagation()`ed — see `SettingsModal.tsx`,
  `TunnelModal.tsx`.
- Button groups inside modals use the existing `.row` class (see `TunnelModal.tsx:168`,
  `RoomScreen.tsx`'s kicked modal).
- Reuse the existing `t('confirm')` / `t('cancel')` keys as default button labels — do not invent new
  ones for those.
- Test commands are `yarn workspace @trm/web test --run <substring>` (vitest substring match on file
  path) run from the repo root.
- Every task's commit stages only the files that task touched (never `git add -A`/`git add .` — see
  root `CLAUDE.md`).

---

### Task 1: `ConfirmDialog` component

**Files:**
- Create: `apps/web/src/components/ConfirmDialog.tsx`
- Test: `apps/web/src/components/ConfirmDialog.test.tsx`

**Interfaces:**
- Produces: `ConfirmDialog(props: ConfirmDialogProps)` where
  ```ts
  interface ConfirmDialogProps {
    title: string;
    message: string;
    confirmLabel?: string; // defaults to t('confirm')
    cancelLabel?: string; // defaults to t('cancel')
    onConfirm: () => void;
    onCancel: () => void;
  }
  ```
  Renders a `role="dialog"` modal. Backdrop click, the Cancel button, and `Escape` all call
  `onCancel`. The Confirm button calls `onConfirm`. Later tasks import `ConfirmDialog` from
  `../components/ConfirmDialog`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ConfirmDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders the title and message, and fires onConfirm from the confirm button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="離開？" message="確定要離開嗎？" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('離開？')).toBeInTheDocument();
    expect(screen.getByText('確定要離開嗎？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels via the Cancel button, backdrop click, and Escape — never firing onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog title="離開？" message="確定要離開嗎？" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Clicking inside the dialog body must not bubble to the backdrop's cancel.
    fireEvent.click(screen.getByText('離開？'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('.modal-backdrop')!);
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('supports custom confirm/cancel labels', () => {
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="是"
        cancelLabel="否"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: '是' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '否' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run ConfirmDialog`
Expected: FAIL — `Failed to resolve import "./ConfirmDialog"` (the component doesn't exist yet).

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/ConfirmDialog.tsx`:

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="confirm-dialog-title">{title}</h3>
        </div>
        <p>{message}</p>
        <div className="row">
          <button type="button" onClick={onCancel}>
            {cancelLabel ?? t('cancel')}
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            {confirmLabel ?? t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run ConfirmDialog`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ConfirmDialog.tsx apps/web/src/components/ConfirmDialog.test.tsx
git commit -m "feat(web): add generic ConfirmDialog component"
```

---

### Task 2: `useConfirmAction` hook

**Files:**
- Create: `apps/web/src/hooks/useConfirmAction.ts`
- Test: `apps/web/src/hooks/useConfirmAction.test.ts`

**Interfaces:**
- Produces: `useConfirmAction(): { open: boolean; request: (action: () => void) => void; confirm: () => void; cancel: () => void }`.
  `request(action)` stores `action` as pending and sets `open` to `true`. `confirm()` invokes the
  pending action then clears it (`open` becomes `false`). `cancel()` clears the pending action
  without invoking it. A second `request()` before a `confirm()`/`cancel()` replaces the pending
  action. Later tasks import `useConfirmAction` from `../hooks/useConfirmAction`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/useConfirmAction.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmAction } from './useConfirmAction';

describe('useConfirmAction', () => {
  it('starts closed, opens on request, and runs the action exactly once on confirm', () => {
    const { result } = renderHook(() => useConfirmAction());
    expect(result.current.open).toBe(false);

    const action = vi.fn();
    act(() => result.current.request(action));
    expect(result.current.open).toBe(true);
    expect(action).not.toHaveBeenCalled();

    act(() => result.current.confirm());
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);
  });

  it('cancel closes without running the pending action', () => {
    const { result } = renderHook(() => useConfirmAction());
    const action = vi.fn();
    act(() => result.current.request(action));
    act(() => result.current.cancel());
    expect(result.current.open).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('a fresh request replaces the pending action', () => {
    const { result } = renderHook(() => useConfirmAction());
    const first = vi.fn();
    const second = vi.fn();
    act(() => result.current.request(first));
    act(() => result.current.request(second));
    act(() => result.current.confirm());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run useConfirmAction`
Expected: FAIL — `Failed to resolve import "./useConfirmAction"`.

- [ ] **Step 3: Write the hook**

Create `apps/web/src/hooks/useConfirmAction.ts`:

```ts
import { useState } from 'react';

interface ConfirmAction {
  open: boolean;
  request: (action: () => void) => void;
  confirm: () => void;
  cancel: () => void;
}

/** Holds one pending action until it's confirmed (run) or cancelled (dropped). */
export function useConfirmAction(): ConfirmAction {
  const [pending, setPending] = useState<(() => void) | null>(null);

  return {
    open: pending !== null,
    request: (action) => setPending(() => action),
    confirm: () => {
      pending?.();
      setPending(null);
    },
    cancel: () => setPending(null),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run useConfirmAction`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useConfirmAction.ts apps/web/src/hooks/useConfirmAction.test.ts
git commit -m "feat(web): add useConfirmAction hook"
```

---

### Task 3: Wire the lobby "leave" button through the confirmation

**Files:**
- Modify: `apps/web/src/i18n/index.ts:183` (zh-Hant), `apps/web/src/i18n/index.ts:562` (en)
- Modify: `apps/web/src/screens/RoomScreen.tsx`
- Test: `apps/web/src/screens/RoomScreen.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` (Task 1), `useConfirmAction` (Task 2).
- Consumes new i18n keys: `t('leaveConfirmTitle')`, `t('leaveConfirmBody')`.

- [ ] **Step 1: Add the i18n keys**

In `apps/web/src/i18n/index.ts`, zh-Hant block:

```diff
       inspectMap: '查看地圖',
       inspectingMap: '正在查看地圖',
       leaveGame: '離開遊戲',
+      leaveConfirmTitle: '離開？',
+      leaveConfirmBody: '確定要離開嗎？',
```

En block:

```diff
       inspectMap: 'Inspect map',
       inspectingMap: 'Viewing the map',
       leaveGame: 'Leave game',
+      leaveConfirmTitle: 'Leave?',
+      leaveConfirmBody: 'Are you sure you want to leave?',
```

- [ ] **Step 2: Write the failing test**

Append to `apps/web/src/screens/RoomScreen.test.tsx` (a new `describe` block at the end of the
file, after the existing `describe('RoomScreen kick', ...)` block):

```ts
describe('RoomScreen leave confirmation', () => {
  it('shows a confirmation dialog before leaving, and only leaves once confirmed', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    (api.leaveRoom as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<RoomScreen />);
    const leaveBtn = await screen.findByRole('button', { name: '離開房間' });
    fireEvent.click(leaveBtn);
    expect(api.leaveRoom).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(api.leaveRoom).toHaveBeenCalledWith('ABCD'));
    expect(useUi.getState().view).toBe('home');
  });

  it('cancels without leaving when the dialog is dismissed', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    const leaveBtn = await screen.findByRole('button', { name: '離開房間' });
    fireEvent.click(leaveBtn);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.leaveRoom).not.toHaveBeenCalled();
    expect(useUi.getState().view).toBe('room');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: FAIL — clicking `'離開房間'` calls `api.leaveRoom` immediately (no dialog appears), so
`expect(api.leaveRoom).not.toHaveBeenCalled()` fails right after the first click.

- [ ] **Step 4: Wire the confirmation into `RoomScreen.tsx`**

Add imports (after the existing `Toast` import):

```diff
 import { Toast } from '../components/Toast';
+import { ConfirmDialog } from '../components/ConfirmDialog';
+import { useConfirmAction } from '../hooks/useConfirmAction';
```

Add the hook and route the leave button through it:

```diff
+  const {
+    open: leaveOpen,
+    request: requestLeave,
+    confirm: confirmLeave,
+    cancel: cancelLeave,
+  } = useConfirmAction();
+
   const leave = async () => {
     await api.leaveRoom(code).catch(() => undefined);
     goHome();
   };
```

```diff
-        <button onClick={() => void leave()}>{t('leave')}</button>
+        <button onClick={() => requestLeave(() => void leave())}>{t('leave')}</button>
```

Render the dialog, right after the existing "kicked" modal block and before the component's
closing `</div>`:

```diff
             </div>
           </div>
         </div>
       )}
+      {leaveOpen && (
+        <ConfirmDialog
+          title={t('leaveConfirmTitle')}
+          message={t('leaveConfirmBody')}
+          onConfirm={confirmLeave}
+          onCancel={cancelLeave}
+        />
+      )}
     </div>
   );
 }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS (all `RoomScreen` tests, including the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/i18n/index.ts apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx
git commit -m "feat(web): confirm before leaving the room lobby"
```

---

### Task 4: Wire `GameScreen`'s leave (live game + post-game ScoreBoard) through the confirmation

**Files:**
- Modify: `apps/web/src/screens/GameScreen.tsx`
- Test: `apps/web/src/screens/GameScreen.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` (Task 1), `useConfirmAction` (Task 2), `t('leaveConfirmTitle')` /
  `t('leaveConfirmBody')` (Task 3).
- `GameScreen`'s `leave` only opens the confirmation when `snapshot` is truthy (covers live play and
  the post-game-over `ScoreBoard`, which both keep `snapshot` set); the pre-connect/error "back"
  buttons (no `snapshot` yet) still leave immediately.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/screens/GameScreen.test.tsx`, update the `@testing-library/react` import to add
`fireEvent`:

```diff
-import { render, screen } from '@testing-library/react';
+import { render, screen, fireEvent } from '@testing-library/react';
```

Add a `gameOverSnap` fixture and a new `describe` block at the end of the file:

```ts
// A finished game: ScoreBoard's own leave button becomes GameScreen's `leave` (onLeave prop).
const gameOverSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.GAME_OVER,
    players: [
      { id: 'p0', seat: 0, routePoints: 10 },
      { id: 'p1', seat: 1, routePoints: 5 },
    ],
    you: { playerId: 'p0' },
    finalScores: {
      players: [
        {
          playerId: 'p0',
          routePoints: 10,
          ticketNet: 0,
          ticketsCompleted: 0,
          stationsUsed: 0,
          unusedStations: 3,
          stationBonus: 0,
          longestTrailLength: 0,
          longestBonus: 0,
          total: 10,
          keptTicketIds: [],
          completedTicketIds: [],
          longestTrailRouteIds: [],
        },
        {
          playerId: 'p1',
          routePoints: 5,
          ticketNet: 0,
          ticketsCompleted: 0,
          stationsUsed: 0,
          unusedStations: 3,
          stationBonus: 0,
          longestTrailLength: 0,
          longestBonus: 0,
          total: 5,
          keptTicketIds: [],
          completedTicketIds: [],
          longestTrailRouteIds: [],
        },
      ],
      ranking: [{ playerIds: ['p0'] }, { playerIds: ['p1'] }],
    },
  });

describe('GameScreen leave confirmation', () => {
  beforeEach(() => {
    useUi.setState({ view: 'game', ticket: 'tkt', roomCode: 'ABCD', gameId: 'g1' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('leaves immediately from the pre-connect back button (nothing to lose yet)', () => {
    useGame.setState({ snapshot: null, rejection: null });
    render(<GameScreen />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUi.getState().view).toBe('home');
  });

  it('confirms before leaving from the post-game ScoreBoard', () => {
    useGame.setState({ snapshot: gameOverSnap(), rejection: null });
    render(<GameScreen />);
    fireEvent.click(screen.getByText('離開遊戲'));
    expect(useUi.getState().view).toBe('game'); // unchanged until confirmed
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(useUi.getState().view).toBe('home');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run GameScreen`
Expected: FAIL — clicking `'離開遊戲'` calls `goHome()` immediately (`view` becomes `'home'` right
away, no dialog), so `expect(useUi.getState().view).toBe('game')` fails right after that click.

- [ ] **Step 3: Wire the confirmation into `GameScreen.tsx`**

Add imports:

```diff
 import { useActiveContent } from '../game/useActiveContent';
 import { GameStage } from './GameStage';
+import { ConfirmDialog } from '../components/ConfirmDialog';
+import { useConfirmAction } from '../hooks/useConfirmAction';
```

Replace the `leave` function and final return:

```diff
-  const leave = () => goHome(); // goHome tears down the socket
+  const {
+    open: leaveOpen,
+    request: requestLeave,
+    confirm: confirmLeave,
+    cancel: cancelLeave,
+  } = useConfirmAction();
+
+  // goHome tears down the socket. Nothing is at stake before the first snapshot arrives, so only
+  // confirm once there's an actual game (live play, or the post-game-over ScoreBoard) to abandon.
+  const leave = () => {
+    if (snapshot) requestLeave(goHome);
+    else goHome();
+  };
```

```diff
-  return <GameStage snapshot={snapshot} commands={getSocket()} onLeave={leave} />;
+  return (
+    <>
+      <GameStage snapshot={snapshot} commands={getSocket()} onLeave={leave} />
+      {leaveOpen && (
+        <ConfirmDialog
+          title={t('leaveConfirmTitle')}
+          message={t('leaveConfirmBody')}
+          onConfirm={confirmLeave}
+          onCancel={cancelLeave}
+        />
+      )}
+    </>
+  );
 }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run GameScreen`
Expected: PASS (all `GameScreen` tests, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/GameScreen.tsx apps/web/src/screens/GameScreen.test.tsx
git commit -m "feat(web): confirm before leaving a live or finished game"
```

---

### Task 5: Wire `AppHeader`'s leave button + make the brand clickable

**Files:**
- Modify: `apps/web/src/components/AppHeader.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/components/AppHeader.phone.test.tsx`
- Create: `apps/web/src/components/AppHeader.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` (Task 1), `useConfirmAction` (Task 2), `t('leaveConfirmTitle')` /
  `t('leaveConfirmBody')` (Task 3).
- The `.brand` element becomes `<button type="button" className="brand">` — same visible content,
  now clickable. Clicking it calls `goHome()` directly outside an active room/game, or opens the
  confirmation (`view === 'room' || inGame`) inside one. The existing desktop `.leave-btn` and phone
  hamburger leave item both route through the same confirmation.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/AppHeader.phone.test.tsx`, add imports:

```diff
 import { useSession } from '../store/session';
 import { useUi } from '../store/ui';
+import { useGame } from '../store/game';
+import { create } from '@bufbuild/protobuf';
+import { GameSnapshotSchema, Phase } from '@trm/proto';
```

Add a snapshot fixture and a new `describe` block at the end of the file:

```ts
const gameSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
  });

describe('AppHeader phone leave confirmation', () => {
  afterEach(() => {
    useGame.setState({ snapshot: null });
    useUi.setState({ view: 'home' });
    vi.unstubAllGlobals();
  });

  it('confirms before leaving an active game from the hamburger menu', () => {
    vi.stubGlobal('matchMedia', phoneMatchMedia);
    useUi.setState({ view: 'game' });
    useGame.setState({ snapshot: gameSnap() });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: '選單' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '離開房間' }));
    expect(useUi.getState().view).toBe('game'); // unchanged until confirmed
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(useUi.getState().view).toBe('home');
  });
});
```

Create `apps/web/src/components/AppHeader.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { AppHeader } from './AppHeader';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useGame } from '../store/game';

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
} as const;

const gameSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
  });

describe('AppHeader brand + leave confirmation (desktop)', () => {
  afterEach(() => {
    useUi.setState({ view: 'home' });
    useGame.setState({ snapshot: null });
    useSession.setState({ user: null });
  });

  it('brand click navigates home immediately when there is no active room/game', () => {
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'history' });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: /台鐵任務/ }));
    expect(useUi.getState().view).toBe('home');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('brand click asks for confirmation while in the lobby', () => {
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'room', roomCode: 'ABCD' });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: /台鐵任務/ }));
    expect(useUi.getState().view).toBe('room');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(useUi.getState().view).toBe('home');
  });

  it('brand click asks for confirmation during an active game; cancel leaves it untouched', () => {
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'game' });
    useGame.setState({ snapshot: gameSnap() });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: /台鐵任務/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUi.getState().view).toBe('game');
  });

  it('the desktop leave button also confirms before leaving', () => {
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'game' });
    useGame.setState({ snapshot: gameSnap() });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: '離開房間' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(useUi.getState().view).toBe('home');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/web test --run AppHeader`
Expected: FAIL — the brand is a plain `<div>` (no button role, no click handler) and the leave
affordances call `goHome` directly with no dialog, so every new assertion about a `dialog` role
fails.

- [ ] **Step 3: Wire the confirmation + brand click into `AppHeader.tsx`**

Add imports (after the `SettingsModal` import):

```diff
 import { SettingsModal } from './SettingsModal';
+import { ConfirmDialog } from './ConfirmDialog';
+import { useConfirmAction } from '../hooks/useConfirmAction';
```

Add the hook and `onBrandClick`, right after the existing `inGame`/`turn`/`onAuthScreen` block:

```diff
   const inGame = view === 'game' && !!snapshot;
   const turn = snapshot ? turnStatus(snapshot) : null;
   const onAuthScreen = view === 'login' || view === 'loginCallback';
+
+  const {
+    open: leaveOpen,
+    request: requestLeave,
+    confirm: confirmLeave,
+    cancel: cancelLeave,
+  } = useConfirmAction();
+  // Leaving the lobby or an active game abandons your seat, so confirm first; from any other
+  // screen there's nothing to lose, so the brand just navigates home.
+  const onBrandClick = () => {
+    if (view === 'room' || inGame) requestLeave(goHome);
+    else goHome();
+  };
```

Turn the brand into a button:

```diff
-      <div className="brand">
-        <TrainFront size={22} aria-hidden />
-        <strong>{t('appName')}</strong>
-      </div>
+      <button type="button" className="brand" onClick={onBrandClick}>
+        <TrainFront size={22} aria-hidden />
+        <strong>{t('appName')}</strong>
+      </button>
```

Route the phone hamburger leave item through the confirmation:

```diff
                 {inGame && (
                   <button
                     className="header-menu-item header-menu-item--danger"
                     role="menuitem"
-                    onClick={menuAct(goHome)}
+                    onClick={menuAct(() => requestLeave(goHome))}
                   >
                     <DoorOpen size={16} aria-hidden /> {t('leave')}
                   </button>
                 )}
```

Route the desktop leave button through the confirmation:

```diff
             {inGame && (
-              <button className="leave-btn" onClick={goHome}>
+              <button className="leave-btn" onClick={() => requestLeave(goHome)}>
                 <DoorOpen size={16} aria-hidden />
                 {t('leave')}
               </button>
             )}
```

Render the dialog next to the settings modal:

```diff
       {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
+      {leaveOpen && (
+        <ConfirmDialog
+          title={t('leaveConfirmTitle')}
+          message={t('leaveConfirmBody')}
+          onConfirm={confirmLeave}
+          onCancel={cancelLeave}
+        />
+      )}
     </header>
   );
 }
```

- [ ] **Step 4: Reset the brand's button styling in `app.css`**

`.brand` is now a `<button>`, which inherits the global `button { border; background; padding }`
reset from `global.css`. Strip that back to the original look:

```diff
 .brand {
   display: flex;
   align-items: center;
   gap: var(--tr-space-2);
   color: var(--tr-blue);
+  border: none;
+  background: none;
+  padding: 0;
+  cursor: pointer;
 }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/web test --run AppHeader`
Expected: PASS — both `AppHeader.phone.test.tsx` and `AppHeader.test.tsx` (matches both files by
substring), all tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/AppHeader.tsx apps/web/src/components/AppHeader.phone.test.tsx apps/web/src/components/AppHeader.test.tsx apps/web/src/styles/app.css
git commit -m "feat(web): clickable header logo + confirm the header's leave actions"
```

---

### Task 6: Native `beforeunload` warning while in a room or game

**Files:**
- Create: `apps/web/src/hooks/useLeaveWarning.ts`
- Test: `apps/web/src/hooks/useLeaveWarning.test.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: `useLeaveWarning(): void` — a side-effect-only hook, no return value. Reads `view` from
  `useUi` internally. While `view` is `'room'` or `'game'`, a `beforeunload` listener calls
  `preventDefault()` and sets `returnValue`, which triggers the browser's own native "leave site?"
  prompt (its wording can't be customized). The listener detaches whenever `view` leaves that set,
  and on unmount.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/useLeaveWarning.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLeaveWarning } from './useLeaveWarning';
import { useUi } from '../store/ui';

const dispatchBeforeUnload = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('useLeaveWarning', () => {
  afterEach(() => {
    useUi.setState({ view: 'home' });
  });

  it('does not warn on a screen with nothing to lose', () => {
    useUi.setState({ view: 'home' });
    renderHook(() => useLeaveWarning());
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it('warns while in a room', () => {
    useUi.setState({ view: 'room' });
    renderHook(() => useLeaveWarning());
    expect(dispatchBeforeUnload()).toBe(true);
  });

  it('warns during an active game', () => {
    useUi.setState({ view: 'game' });
    renderHook(() => useLeaveWarning());
    expect(dispatchBeforeUnload()).toBe(true);
  });

  it('stops warning once the view changes away from room/game', () => {
    useUi.setState({ view: 'game' });
    renderHook(() => useLeaveWarning());
    act(() => {
      useUi.setState({ view: 'home' });
    });
    expect(dispatchBeforeUnload()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run useLeaveWarning`
Expected: FAIL — `Failed to resolve import "./useLeaveWarning"`.

- [ ] **Step 3: Write the hook**

Create `apps/web/src/hooks/useLeaveWarning.ts`:

```ts
import { useEffect } from 'react';
import { useUi } from '../store/ui';

/** Warns before an accidental tab close/refresh/navigation while a room or game is active. */
export function useLeaveWarning(): void {
  const view = useUi((s) => s.view);

  useEffect(() => {
    if (view !== 'room' && view !== 'game') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [view]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run useLeaveWarning`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into `App.tsx`**

```diff
 import { AppHeader } from './components/AppHeader';
+import { useLeaveWarning } from './hooks/useLeaveWarning';
```

```diff
   const user = useSession((s) => s.user);
   const booting = useSession((s) => s.booting);
   const restore = useSession((s) => s.restore);
 
+  useLeaveWarning();
+
   useEffect(() => {
     void restore();
   }, [restore]);
```

- [ ] **Step 6: Run the full web test suite to confirm nothing else broke**

Run: `yarn workspace @trm/web test`
Expected: PASS — all suites green (no test renders `<App />` today, so this change is additive-only
from every existing suite's point of view).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useLeaveWarning.ts apps/web/src/hooks/useLeaveWarning.test.ts apps/web/src/App.tsx
git commit -m "feat(web): warn on accidental tab close/refresh during a room or game"
```

---

### Task 7: Full validation pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `yarn typecheck`
Expected: PASS, no errors in any touched file.

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: PASS, no new warnings/errors.

- [ ] **Step 3: Full web test suite**

Run: `yarn workspace @trm/web test`
Expected: PASS, full suite green (this repeats Task 6's suite run but now covers every task's
changes together, not just the last one).

- [ ] **Step 4: Format check**

Run: `yarn format:check`
Expected: PASS. If it fails, run `yarn format` and re-stage only the files this plan touched (do
not use `git add -A`), then re-run `yarn format:check`.

- [ ] **Step 5: Manual smoke check (dev server)**

Run: `yarn workspace @trm/web dev` (needs `docker compose up -d mongo` and
`yarn workspace @trm/server dev` running alongside for a real lobby/game flow). Verify by hand:
- Clicking the header logo from the home screen navigates home with no dialog.
- Creating/joining a room, then clicking "離開房間" (both the lobby button and the header logo)
  shows the confirmation; Cancel stays in the room, Confirm leaves it.
- Starting a game, then clicking the header's leave button or the header logo shows the
  confirmation; Confirm leaves the game.
- On the post-game ScoreBoard, "離開遊戲" shows the confirmation before leaving.
- While in a room or a game, refreshing the tab (or closing it) triggers the browser's native
  "leave site?" prompt; from the home screen it does not.

No commit for this task (verification-only; nothing to stage).
