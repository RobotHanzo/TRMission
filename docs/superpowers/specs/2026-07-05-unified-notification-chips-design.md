# Unified Notification Chips — Design

## Problem

The web client has two independent transient-notification systems that look and behave
differently:

- **`components/Toast.tsx`** — a single bottom-center pill (one message at a time), used for:
  action-rejection errors and the client-side "insufficient cards" nudge in `GameStage.tsx`
  (red/blue variants), and the "copied" confirmation in `RoomScreen.tsx` (green variant).
- **`EventToasts`/`EventToastRow`** (in `components/EventBanner.tsx`, backed by
  `store/animations.ts`'s `eventToasts` slice) — a top-center **stack** of pills, used only for
  random-event announcements and bonuses (e.g. "集章 +1", "打卡熱點 +2").

Same underlying idea (a self-expiring pill notification), two positions, two component trees, two
store mechanisms. Event notifications like the stamp-rally bonus should render through the same
unified "notification chip" popup as every other transient message in the game.

## Goal

One notification system: one store slice, one rendering component, one on-screen stack, used by
every transient notification in the client (system errors/notices/success **and** event
announcements/bonuses). Event bonus chips ("集章+1" etc.) are just one variant among several, not a
separate mechanism.

## Store: generalize `store/animations.ts`

The existing `eventToasts` slice already has the isolation semantics this needs for free: the
store is accessed through `useAnimationsStore`, which resolves to a **contextual, isolated**
instance under `AnimationsStoreProvider` (used by the in-game encyclopedia sandbox and the replay
screen) or falls back to the shared live singleton otherwise. This matters because a sandbox demo
can be open *over* a live game at the same time (`EncyclopediaModal`) — without this isolation, a
demo's chips and the real game's chips would land in the same array. Building a brand-new store
would have to re-solve this; extending the existing slice inherits it automatically. `RoomScreen`
(no game yet, no provider) naturally falls back to the live singleton, which is correct since
there's no isolation concern pre-game.

Changes to `store/animations.ts`:

- Generalize `EventToastCue` → `NotificationCue`, a discriminated union on `variant`:
  - `{ id, variant: 'announced' | 'bonus', kind, reason, points, cityId, routeId }` — unchanged
    shape from today; text resolves at render time from i18n so late locale/roster changes apply.
  - `{ id, variant: 'error' | 'notice' | 'success', text }` — new; text is pre-resolved by the
    caller (mirrors how `<Toast message={...}>` callers already pass fully-translated strings
    today).
- Rename `eventToasts` → `notifications`, `pushEventToast` → `pushNotification`,
  `removeEventToast` → `removeNotification`. No change to `reset()` semantics.

## Component: `components/NotificationStack.tsx` (new), delete `components/Toast.tsx`

Move `EventToastRow`/`EventToasts` out of `EventBanner.tsx` (which keeps only the big skippable
event-START banner — out of scope for this change) into a new file, renamed
`NotificationChip`/`NotificationStack`:

- `NotificationChip` render switch: `announced`/`bonus` resolve their text exactly as
  `EventToastRow` does today (`t('log.eventAnnounced', ...)` / `t('log.eventBonus.<reason>', ...)`);
  `error`/`notice`/`success` render `cue.text` directly.
- Each chip owns its own auto-dismiss timer, keyed by variant, matching today's actual durations
  exactly (no behavior change): `error` 3000ms, `notice` 3500ms, `success` 2000ms,
  `announced`/`bonus` 3400ms.
- Each chip gets a two-phase unmount (mount → hold → `exiting` → remove after 200ms) so the smooth
  fade-out `Toast.tsx` had is not lost now that every variant flows through the stack.
- `NotificationStack` renders all current `notifications` as a `<div className="notification-stack">`
  of chips, newest appended at the end (same stacking order `EventToasts` uses today).
- `components/Toast.tsx` is deleted — fully superseded.

## CSS (`styles/game.css`)

- Delete the standalone bottom-center `.toast` / `.toast-notice` / `.toast-success` rules and their
  `.game--dock` bottom-offset overrides (no longer needed — everything lives in one top-center
  stack now).
- Rename `.event-toast-stack` → `.notification-stack`, `.event-toast` → `.notification-chip`.
  Keep the `--announced` / `--bonus` modifiers as-is; add `--error` (red, `var(--tr-danger)`),
  `--notice` (blue, `var(--tr-blue)`), `--success` (green, `var(--tr-ok)`) — all colors already
  exist as tokens, no new ones introduced. Keep the existing `tr-toast-in` enter keyframe and the
  `prefers-reduced-motion` disable; add the mirrored `tr-toast-out` exit keyframe (already exists,
  currently only used by `Toast.tsx`) to the chip's `--exiting` state.

## Call-site migration

- **`GameStage.tsx`**: remove the local `notice` state + its dismiss-effect; the 3
  `setNotice(...)` call sites (insufficient cards/locos, no stations left) become
  `pushNotification({ variant: 'notice', text: ... })`. Remove both `<Toast>` JSX lines. Add an
  effect on `rejection` that, for a fresh non-chat rejection, calls
  `pushNotification({ variant: 'error', text: t(eventRejectionHintKey(...) ?? 'actionRejected') })`
  once. The existing `rejection` store state and its clearing (on `version` change / 3000ms
  timeout — `ChatPanel` still reads it for its own inline chat-rejection hint) is untouched; only
  the visual chip now flows through the unified stack instead of a dedicated `<Toast>`.
- **`RoomScreen.tsx`**: remove the local `toast`/`flashToast` state and the
  `<Toast variant="toast-success">`; call `pushNotification({ variant: 'success', text: t('copied') })`
  directly where `flashToast(t('copied'))` was called. Mount `<NotificationStack />` in its JSX
  (it renders nothing from the animations store today).
- **`useAnimationDriver.ts`**: rename the two `pushEventToast(...)` calls to `pushNotification(...)`
  (same payload shape).
- **`AnimationLayer.tsx`**: swap the `EventToasts` render for `NotificationStack`.

## Non-goals

- The big skippable event-START banner (`EventBanner`) is unchanged — it's a distinct, modal-like
  cue, not a chip.
- No change to which events produce a chip today (STAMP, HOTSPOT, REOPEN, CHARTER, FREE_STATION
  bonuses; forecast announcements) — only how/where they render.
- No new i18n strings — all text is already translated at existing call sites.

## Testing

- New tests for `NotificationStack`/`NotificationChip`: renders each variant with correct text/class,
  auto-dismisses after its variant's duration, plays the exit phase before removal, stacks multiple
  concurrent notifications in push order.
- Updated `RoomScreen.test.tsx` "flashes a success toast" case keeps passing unchanged (asserts on
  text content, not the old `.toast` class).
- `GameStage` behavior: a rejected action still surfaces exactly one chip (verify the chat-rejection
  filter still suppresses the chip when `isChatRejectionKey` is true); insufficient-cards/no-stations
  nudges still produce a chip with the same copy as today.
- `yarn workspace @trm/web test`, `yarn lint`, `yarn typecheck` must pass before committing.
