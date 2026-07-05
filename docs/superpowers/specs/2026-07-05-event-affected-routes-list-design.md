# Affected-routes list for route-targeting events — design

## Goal

`SKY_LANTERN` (天燈之夜) and `TYPHOON_LANDFALL` (颱風登陸) are the two random-event kinds that
target a specific set of routes — a whole region's touching routes for Sky Lantern, 2-3 of them for
Typhoon Landfall (`packages/engine/src/events/schedule.ts`). Today `EventsPanel.tsx`'s active/
forecast rows only ever show a route **count** ("2 條路線" via `events.affectedRoutes`), and the
existing info modal (landed in `2026-07-05-events-panel-info-modal-design.md`) shows only the
event's name + rule description — a player has no way to see *which* routes are affected short of
scanning the whole map for the amber sky-lantern glow (`.route.evt-sky`) or the typhoon glyph
(`.route.evt-closed`).

Add an affected-routes section to that same existing info modal, listing each targeted route by
city-pair name, with each row clickable to pan/zoom the board straight to it.

## Scope

Generic for any kind whose current instance (active or forecast) carries resolvable `routeIds` —
today that's `SKY_LANTERN` and `TYPHOON_LANDFALL` only. Every other kind (day-off, aftershock,
hotspot, charter, gala, stamp rally) keeps today's name+description-only modal, unchanged.

Both **active** and **forecast** rows get the section — `routeIds` is already resolved at genesis
schedule-generation time and carried through to both `EVENT_ANNOUNCED` and `EVENT_STARTED`
(`packages/engine/src/events/runtime.ts`), so the forecast row can show the exact same list one
round before the event starts.

## Which routes get listed

The event's target route set, **filtered to routes not already owned or locked** (via
`ownershipMap(snapshot)` from `game/view.ts` — the same helper `Board.tsx` already uses for the
board overlays). Rationale:

- **Typhoon Landfall**: an already-claimed route in the target set was never actually closed
  (`packages/engine/src/events/effects.ts`'s `closedRouteIds` already excludes it) — listing it as
  "affected" would be wrong.
- **Sky Lantern**: an already-claimed route's score is already locked in; nothing more can happen to
  it. Listing only the unclaimed subset keeps the list actionable ("these are the routes I could
  still go claim") instead of padded with noise.

If filtering empties the list (every targeted route is already claimed), the section doesn't
render — same fallback as today's "no routes" case.

## Component changes (`src/components/EventsPanel.tsx`)

- A helper resolves the current route-id set for a clicked `infoKind`:
  ```tsx
  const routeIdsForKind = (kind: string): readonly string[] =>
    ev.active.find((a) => a.kind === kind)?.routeIds ??
    (forecast?.kind === kind ? forecast.routeIds : []);
  ```
  (At most one active/forecast instance of a given kind exists at once — the schedule generator's
  gap-spacing invariant never overlaps two windows — so matching purely on `kind` is unambiguous.)
- That raw set is filtered against `ownershipMap(snapshot)` (new `useMemo` in the component, same
  pattern as `Board.tsx`) to drop owned/locked routes.
- Inside the existing modal, below the `<p>{t(eventDescKey(infoKind))}</p>` description, append:
  ```tsx
  {infoRouteIds.length > 0 && (
    <div className="event-route-section">
      <h4>{t('events.routeListTitle')}</h4>
      <ul className="event-route-list">
        {infoRouteIds.map((rid) => {
          const r = routeById.get(rid);
          if (!r) return null;
          return (
            <li key={rid}>
              <button
                type="button"
                className="event-route-item"
                onClick={() => {
                  setEventSpotlight({ kind: 'route', ids: [rid] });
                  setInfoKind(null);
                }}
              >
                {cityName(r.a, locale)}–{cityName(r.b, locale)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  )}
  ```
- New imports: `routeById` (already exported from `game/content.ts`, just not currently imported
  here), `setEventSpotlight` selected off `useAnimationsStore` (new field, see below).

## Board camera wiring (new, small — mirrors the existing `routeReveal` pattern)

`ScoreBoard.tsx` already drives the board's camera via a field on `useAnimationsStore`
(`routeReveal`/`setRouteReveal`, consumed by `Board.tsx`'s `RevealFramer`). This feature adds the
same shape for a one-shot pan instead of a persistent highlight:

- `store/animations.ts`: new field `eventSpotlight: BoardFrameTarget | null` (reusing the existing
  `BoardFrameTarget` type from `game/boardView.ts`) + `setEventSpotlight(target: BoardFrameTarget)`.
  Included in `initial()`/`reset()` like every other field.
- `components/Board.tsx`: `SpotlightFramer` (today driven only by the tutorial/replay `frameTarget`
  prop) falls back to this store field when the prop is absent:
  ```tsx
  const eventSpotlight = useAnimationsStore((s) => s.eventSpotlight);
  const effective = target ?? eventSpotlight;
  ```
  and uses `effective` everywhere `target` was used, keyed the same way
  (`` `${effective.kind}:${effective.ids.join(',')}` ``). No new component, no change to the
  tutorial/replay call sites — a live game never passes `frameTarget`, so `effective` is always
  `eventSpotlight` there; a sandbox context that *does* pass `frameTarget` keeps taking priority.
- No new board overlay/highlight is added for the panned-to route — the existing persistent amber
  glow (`.route.evt-sky`) / typhoon glyph (`.route.evt-closed`) is already the "this route is
  affected" visual; panning just brings it into view.

## i18n

One new key, both locales, next to the existing `events.*` block in `src/i18n/index.ts`:

| Key                     | zh-Hant      | en             |
| ----------------------- | ------------ | -------------- |
| `events.routeListTitle` | 受影響路線   | Affected routes |

Everything else (route names) resolves through `cityName`, already fed from the active content
catalog, not a translation table.

## CSS (new, scoped to `game.css`'s events-panel section)

- `.event-route-section` — a small heading + list block inside `.modal`.
- `.event-route-list` — vertical flex list, tight gaps.
- `.event-route-item` — a full-width text button, hover state matching `.cell-view`'s existing
  hover treatment (`color-mix` tint), left-aligned text.

## Edge cases

- **Unknown route id** (shouldn't happen — `routeIds` always comes from the authoritative engine
  projection): `routeById.get(rid)` returns `undefined`, the row is skipped (`return null`), not a
  crash.
- **Every targeted route already claimed**: section doesn't render (empty list after filtering).
- **Clicking a route row**: closes the modal (so the pan is actually visible) and pans; if the
  player immediately reopens the same modal and clicks the *same* route again, the pan doesn't
  re-fire (unchanged key) — an accepted pre-existing limitation, identical to how the tutorial's
  `SpotlightFramer` already behaves for a repeated identical target.
- **Kind with no routes** (day-off, aftershock, hotspot, charter, gala, stamp rally): `routeIdsForKind`
  returns `[]`, section doesn't render — modal is byte-for-byte what it is today for these kinds.

## Testing

`EventsPanel.test.tsx`:
- Active `SKY_LANTERN`/`TYPHOON_LANDFALL` row's modal shows the affected-routes section with the
  correct city-pair names.
- A route already owned in the snapshot is excluded from the list.
- Clicking a route row calls `setEventSpotlight` with `{ kind: 'route', ids: [thatRouteId] }` and
  closes the modal.
- Forecast row's modal shows the same section (from `forecast.routeIds`).
- A kind with no routes (e.g. `AFTERSHOCK`) renders the modal without the section (regression check
  against the existing info-modal tests).

`Board.test.tsx` / a small `store/animations.test.ts` addition: setting `eventSpotlight` is read by
`SpotlightFramer`'s fallback — kept to a state-shape assertion, not new pixel-math tests (existing
camera tests already bail out early under jsdom's unmeasured layout, same as the tutorial framer).

## Out of scope

- No "frame all affected routes at once" view — each row pans to just that one route.
- No filtering/preview refinement beyond current ownership (e.g. not attempting to predict whether
  a *forecast* Typhoon Landfall route will still be unclaimed by the time it actually starts next
  round — the list reflects current ownership at the moment it's opened).
- No change to the board's existing per-route overlays (glow/glyph) — reused as-is.

## Success criteria

- Sky Lantern's and Typhoon Landfall's active/forecast info modal lists every currently-unclaimed
  targeted route by name.
- Clicking a listed route closes the modal and pans/zooms the board to frame it.
- `yarn workspace @trm/web test`, `yarn lint`, and `yarn typecheck` pass.
