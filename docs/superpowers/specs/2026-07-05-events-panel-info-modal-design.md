# Events panel description modal — design

## Goal

`EventsPanel.tsx` (the persistent side-rail "事件" card) renders active events, open charters, and
the one-round forecast, but only ever shows an event's name — never its rule description. The
description copy already exists for all 8 event kinds (`events.{KIND}.desc` in
`src/i18n/index.ts`) and is used exactly once today, in `EventBanner.tsx`'s transient
auto-dismissing start banner (gone after ~3.4s). There is currently no durable, on-demand way for a
player to look up "what does this event actually do" while it's active.

Add a small info button to every kind-bearing row in `EventsPanel` that opens a modal showing that
event's full name + description, reusing existing modal/button chrome already used elsewhere in
`apps/web` (`ScoreBoard.tsx`'s ticket-list modal + `cell-view` icon button, `ConfirmDialog.tsx`'s
Escape-to-close).

## Scope

Rows that get the info button — every row keyed by an event `kind`:
- **Active events** (`ev.active`, each an `info.kind`)
- **Charters** (`ev.charters`, always `CHARTER_SPECIAL`)
- **Forecast** (`ev.forecast?.kind`)

Excluded: the free-station banner row (`ev.freeStationAvailable`) — it's a derived boolean, not a
row tied to one specific `kind`/description, so there's nothing distinct to show beyond its
existing inline copy.

## Component changes (`src/components/EventsPanel.tsx`)

- New local state: `const [infoKind, setInfoKind] = useState<string | null>(null);` — holds the
  clicked row's `kind`. Name/description are pure functions of `kind` (`eventNameKey`/
  `eventDescKey`), so no need to track which specific row instance (id) was clicked; if two rows
  ever shared a kind simultaneously they'd show identical modal content anyway.
- Each of the three row renders gets an appended icon-only button:
  ```tsx
  <button
    type="button"
    className="cell-view"
    aria-label={t('view')}
    title={t('view')}
    onClick={() => setInfoKind(info.kind)} // or ev.forecast.kind for the forecast row
  >
    <Info size={13} aria-hidden />
  </button>
  ```
  (`Info` from `lucide-react`, matching the existing `Eye`/`MapIcon` icon-button convention in
  `ScoreBoard.tsx`. `t('view')`/`t('close')` are existing i18n keys, already used there — no new
  copy needed for the button itself.)
- At the end of the component, when `infoKind` is set, render a modal:
  ```tsx
  {infoKind && (
    <div className="modal-backdrop" onClick={() => setInfoKind(null)}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t(eventNameKey(infoKind))}</h3>
          <button className="icon-button" aria-label={t('close')} onClick={() => setInfoKind(null)}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <p>{t(eventDescKey(infoKind))}</p>
      </div>
    </div>
  )}
  ```
- `Escape` closes the modal too (matching `ConfirmDialog`'s `useEffect` + `keydown` listener
  pattern), in addition to backdrop click and the `X` button.
- Modal content is name + description **only** — no restating of the row's own contextual summary
  (affected city/routes, rounds left, charter parties/points, "starts next round"). That context
  is already visible in the row itself; the modal is purely "what does this rule mean," matching
  how `EventBanner.tsx` already presents this same copy (title + desc, nothing else).

## No new i18n strings, no new CSS selectors

- `events.{KIND}.name` / `.desc` already exist for all 8 kinds (zh-Hant + en).
- `view` / `close` i18n keys already exist (used by `ScoreBoard.tsx`).
- `.cell-view` (icon button), `.modal` / `.modal-backdrop` / `.modal-head` (dialog chrome) are
  already global classes in `app.css`/`game.css`, not scoped to the components that currently use
  them.
- Possible minor spacing tweak inside the existing `.event-row` block in `game.css` if the appended
  button crowds `.event-rounds` (which uses `margin-left: auto`) — a `gap`/`margin-left` nudge only,
  no new selectors.

## Edge cases

- **Row with no matching i18n key** (a `kind` string that isn't one of the 8 known
  `EVENT_KINDS`): `eventNameKey`/`eventDescKey` already fall back gracefully (`eventNameKey`
  returns the raw kind string; `eventDescKey` always builds `events.{kind}.desc`, which
  react-i18next renders as the raw key if missing). Not a regression — same fallback behavior the
  panel already relies on for names today.
- **Multiple modals**: only one `infoKind` at a time — clicking a second info button while one
  modal is open just swaps the content in place (no stacking).

## Implementation surface

All in `apps/web`:

1. `src/components/EventsPanel.tsx` — add `infoKind` state, the three info buttons, and the modal
   (import `Info`, `X` from `lucide-react`).
2. `src/styles/game.css` — only if visual crowding requires a small spacing tweak in the existing
   `.event-row` rule block; no new class names anticipated.
3. **Tests** (`src/components/EventsPanel.test.tsx`):
   - Clicking the info button on an active event row opens the modal showing that kind's
     localized name + description.
   - Clicking the charter row's info button shows `CHARTER_SPECIAL`'s name + description.
   - Clicking the forecast row's info button shows the forecast kind's name + description.
   - The modal closes on `X` click, backdrop click, and `Escape`.
   - The free-station banner row has no info button.

## Out of scope

- No change to `EventBanner.tsx`'s transient start banner.
- No new event copy/translations.
- No visual redesign of the `.modal*` family — reused as-is.
- No info affordance on the free-station banner row.

## Success criteria

- Every active/charter/forecast row in the events panel shows a small info button.
- Clicking it opens a modal with that event's full localized name + description; closing it
  (X / backdrop / Escape) returns to the panel unchanged.
- `yarn workspace @trm/web test`, `yarn lint`, and `yarn typecheck` pass.
