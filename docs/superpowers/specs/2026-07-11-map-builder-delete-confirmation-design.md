# Delete-map confirmation in the map builder

**Date:** 2026-07-11
**Status:** Approved (design)

## Problem

`MapsScreen.tsx` (the `/maps` list of a user's custom maps) has a trash-can button per row that
calls `api.deleteMap(id)` immediately on click — no confirmation, no undo. A misclick permanently
destroys a map draft.

## Decision (from brainstorming)

Reuse the app's existing confirm-dialog convention (`useConfirmAction()` + `<ConfirmDialog>`,
already wired identically in `AppHeader.tsx` and `RoomScreen.tsx` for leave/close-room), rather
than inventing a new pattern. Unlike those two call sites — which show a static generic
message — this dialog names the specific map being deleted, since a user may have several
similarly-named drafts and a generic "delete this map?" is less reassuring here.

Because `useConfirmAction`'s `request(action)` only carries the closure to run on confirm (not
display data), `MapsScreen` also holds one extra piece of local state: the display label of the
map currently pending deletion.

## Architecture

All in `apps/web/src/features/builder/MapsScreen.tsx`:

- Add `useConfirmAction()` (a second instance is not needed elsewhere in this file — this is the
  only destructive action on the screen).
- Add `const [deleteLabel, setDeleteLabel] = useState('')` to hold `"{nameZh} ({nameEn})"` for
  the map currently pending deletion.
- The trash-can button's `onClick` changes from `() => void remove(m.id)` to a handler that sets
  `deleteLabel` from `m` and calls `requestDelete(() => remove(m.id))`. `remove()` itself is
  unchanged (still calls `api.deleteMap` then `refresh()`).
- Render `<ConfirmDialog>` when `deleteOpen`, with:
  - `title={t('builder.deleteMapConfirmTitle')}`
  - `message={t('builder.deleteMapConfirmBody', { name: deleteLabel })}`
  - `onConfirm={confirmDelete}`, `onCancel={cancelDelete}`

No server, proto, or REST-layer changes — `api.deleteMap` is already called exactly as before,
just gated behind an explicit confirm step.

### i18n

Add to both the zh-Hant and en tables in `apps/web/src/i18n/index.ts`, under the existing
`builder` namespace (next to `deleteMap`/`editMap`-style keys), following the
`leaveConfirmTitle`/`leaveConfirmBody` naming convention already used for the app's other
confirm dialogs:

- `deleteMapConfirmTitle`: `刪除地圖？` / `Delete map?`
- `deleteMapConfirmBody`: `確定要刪除「{{name}}」嗎？此動作無法復原。` /
  `Are you sure you want to delete "{{name}}"? This cannot be undone.`

## Testing

`MapsScreen.test.tsx` (new or extended, testing-library, matching the existing pattern for
confirm-gated actions elsewhere in the app):

- Clicking the trash-can button does **not** call `api.deleteMap` and opens the confirm dialog
  with the map's name in the body text.
- Confirming calls `api.deleteMap(id)` and refreshes the list.
- Cancelling (or Escape) closes the dialog without calling `api.deleteMap`.

## Out of scope (YAGNI)

- No undo/soft-delete — this only adds a confirmation gate in front of the existing hard delete.
- No change to the official-map-fork or clone-by-code flows on the same screen — neither is
  destructive.
