# Leave confirmation + clickable header logo — design

## Goal

Leaving a room or an in-progress game currently happens instantly on click, with no way to back
out of a misclick: `RoomScreen`'s lobby "leave" button, `AppHeader`'s in-game leave button
(desktop icon-button + phone hamburger item), and `GameScreen`'s `leave` (used by the connecting/
error "back" buttons and passed as `onLeave` to the post-game `ScoreBoard`) all call `goHome()` /
`api.leaveRoom()` directly. Separately, the `TRMission` brand mark in the header
(`AppHeader.tsx`'s `.brand` div) is inert — not a link, not clickable.

Add a confirmation step to every leave action that would abandon an active room or game, and make
the header brand clickable to navigate home (subject to the same confirmation). Also add a native
`beforeunload` prompt so an accidental tab close/refresh/reload during an active room or game
warns the user before it takes effect.

## Components

**`ConfirmDialog`** (new, `src/components/ConfirmDialog.tsx`) — a generic modal following the
existing `.modal-backdrop` / `.modal` / `.modal-head` pattern already used by `SettingsModal`,
`TunnelModal`, `PaymentModal`:

```ts
interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string; // defaults to t('confirm')
  cancelLabel?: string;  // defaults to t('cancel')
  onConfirm: () => void;
  onCancel: () => void;
}
```

Backdrop click and `Escape` both cancel (`onCancel`), matching the dismiss behavior of the other
modals in this family. No new CSS needed beyond the existing `.modal*` classes.

**`useConfirmAction`** (new, `src/hooks/useConfirmAction.ts`) — the same four-line "hold a pending
action, confirm or cancel it" state shape is needed at three call sites, so it's factored out
rather than duplicated:

```ts
function useConfirmAction() {
  const [pending, setPending] = useState<(() => void) | null>(null);
  return {
    open: pending !== null,
    request: (action: () => void) => setPending(() => action),
    confirm: () => { pending?.(); setPending(null); },
    cancel: () => setPending(null),
  };
}
```

## Wiring

- **`RoomScreen.tsx`** — the lobby leave button's `onClick={() => void leave()}` becomes
  `onClick={() => request(() => void leave())}`; render `<ConfirmDialog>` when `open`, wired to
  `confirm`/`cancel`. Always confirms — this screen only renders while the viewer is in a room.

- **`AppHeader.tsx`** — one `useConfirmAction()` instance covers two triggers:
  - The existing in-game leave affordances (desktop `.leave-btn`, phone hamburger `t('leave')`
    item) call `request(goHome)` instead of `goHome` directly.
  - The `.brand` div becomes a `<button type="button" className="brand">` (same children,
    `type="button"` so it never behaves as a form submit). Its `onClick`:
    ```ts
    const onBrandClick = () => {
      if (view === 'room' || inGame) request(goHome);
      else goHome();
    };
    ```
    From any other screen (home, tutorial, history, maps, login) it navigates home immediately —
    there's no session to lose there, and confirming would be pure friction.

- **`GameScreen.tsx`** — its single `leave` function (shared by the connecting-state "back"
  button, the error-state "back" button, and `onLeave` passed into `GameStage` → `ScoreBoard`)
  becomes conditional on whether a snapshot exists:
  ```ts
  const leave = () => {
    if (snapshot) request(goHome);
    else goHome();
  };
  ```
  A `snapshot` is present for both live play and the post-game-over screen (phase is orthogonal to
  snapshot presence), so this one branch covers the normal in-game case and the `ScoreBoard` leave
  button. The pre-connect/error states (no snapshot yet) leave immediately — nothing is at stake
  before the first snapshot arrives.

All three call sites use the same copy: new i18n keys `leaveConfirmTitle` / `leaveConfirmBody`,
phrased generically enough to read naturally whether the viewer is still in the lobby or mid-game
(e.g. "離開？" / "確定要離開嗎？" — "Leave?" / "Are you sure you want to leave?").

## `beforeunload` guard

A `useEffect` in `App.tsx` (already reads `view` from `useUi`):

```ts
useEffect(() => {
  if (view !== 'room' && view !== 'game') return;
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [view]);
```

Browsers render their own fixed "Leave site?" copy for `beforeunload` and ignore any custom
string — this triggers that native prompt, it can't be themed. Scoped to `room`/`game` to match
where the in-app confirmations apply; `tutorial` (local sandbox), `replay` (read-only), and
`mapEditor` (autosaves per its own design) are intentionally excluded.

## Edge cases

- **Brand click during the `ScoreBoard` (game-over) screen**: `inGame` is `view === 'game' &&
  !!snapshot`, which is still true post-game-over (the snapshot doesn't disappear when the phase
  becomes `GAME_OVER`) — so the brand click confirms there too, consistent with the `ScoreBoard`'s
  own leave button.
- **Room-screen "kicked" modal** (`RoomScreen.tsx`'s existing `modal-backdrop` with
  `onClick={goHome}`, shown after the viewer has already been removed from the room): left
  untouched — the viewer is no longer a room member at that point, so there is nothing left to
  confirm away from.
- **Double-submit**: `useConfirmAction`'s `confirm()` invokes `pending` then immediately clears it
  synchronously in the same call, so a second click on the (about to unmount) dialog can't
  double-fire the leave action.

## Implementation surface

All in `apps/web`:

1. `src/components/ConfirmDialog.tsx` (new) — the modal.
2. `src/hooks/useConfirmAction.ts` (new) — the shared pending-action hook.
3. `src/i18n/index.ts` — add `leaveConfirmTitle` / `leaveConfirmBody` (zh-Hant + en).
4. `src/screens/RoomScreen.tsx` — wire lobby leave through `useConfirmAction`.
5. `src/components/AppHeader.tsx` — wire in-game leave (desktop + phone) and the new clickable
   `.brand` button through one shared `useConfirmAction`.
6. `src/screens/GameScreen.tsx` — wire `leave` through `useConfirmAction`, gated on `snapshot`.
7. `src/App.tsx` — add the `beforeunload` effect.
8. Minor CSS: `.brand` needs button-reset styling (no border/background/padding drift from the
   current div-based look) plus a pointer cursor and focus-visible ring, in whichever stylesheet
   currently carries `.brand` (likely `app.css`).
9. **Tests:**
   - `src/components/ConfirmDialog.test.tsx` (new) — renders title/message, `onConfirm`/`onCancel`
     fire on click, backdrop click and `Escape` both cancel.
   - `src/screens/RoomScreen.test.tsx` — leave button opens the dialog; `api.leaveRoom` /
     `goHome` are not called until confirmed.
   - `src/components/AppHeader.phone.test.tsx` + a desktop-variant AppHeader test — leave item and
     brand click both open the dialog while in-game; brand click from a non-game view navigates
     home without a dialog.
   - `src/screens/GameScreen.test.tsx` / `src/components/ScoreBoard.test.tsx` — `ScoreBoard`'s
     leave button opens the dialog; confirming calls `goHome`.
   - `src/App.test.tsx` (or a new small test) — the `beforeunload` listener is attached when
     `view` is `room`/`game` and removed otherwise (dispatch the event in jsdom and assert
     `defaultPrevented`).

## Out of scope

- No change to `tutorial`, `replay`, or `mapEditor` leave flows or their `beforeunload` coverage.
- No change to the room-screen "kicked" modal.
- No visual redesign of the existing `.modal*` family — `ConfirmDialog` reuses it as-is.

## Success criteria

- Clicking the lobby "leave" button, the header's in-game leave button (desktop and phone), the
  header brand while in a room or game, or the post-game "leave game" button all show the same
  confirmation dialog before actually leaving; cancelling leaves the user exactly where they were.
- Clicking the header brand from any screen other than an active room/game navigates home
  immediately, no dialog.
- Closing/refreshing/navigating away from the tab while in a room or an active game triggers the
  browser's native leave-site prompt; it does not trigger on other screens.
- `yarn workspace @trm/web test`, `yarn lint`, and `yarn typecheck` pass.
