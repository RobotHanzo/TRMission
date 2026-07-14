# Custom-map mission-ticket display areas

**Date:** 2026-07-10
**Status:** Approved (design) — pending spec review before planning

## Problem

Every mission (destination) ticket card renders a mini-map behind its two endpoint cities via
[`RoutePreview`](../../../apps/web/src/components/RoutePreview.tsx). That component imports Taiwan's
`BASE_VIEW`, `TAIWAN_LAND_PATH`, `CENTRAL_RANGE_PATH`, and `ISLANDS` **directly**, so a custom map of
anywhere else still draws its tickets over the Taiwan silhouette. The live board already switches to
`content.geography` (via `ACTIVE_GEOGRAPHY` / `ACTIVE_BASE_VIEW` in `game/catalog.ts`); the ticket
preview simply never got the same treatment.

Two things follow from this:

1. **Correctness:** the ticket mini-map must follow the active map's geography, not hardcoded Taiwan.
2. **Feature:** authors want to control the _displayed area_ (crop/zoom) of each ticket's mini-map,
   per ticket, with a map-wide default and a safe fallback for tickets that set nothing.

## Scope

- **In:** `@trm/map-data` (types + resolver + validation + tests), the web ticket preview rendering,
  the builder's Missions stage authoring UI + draft plumbing, and the server zod schemas that
  validate a custom-map draft.
- **Out:** no engine change, no proto/wire change, no OG social-card change (the OG map card renders a
  whole-map preview, never individual ticket cards). Tickets already reach the client as IDs and
  resolve their full definitions — including the new field — from content-by-hash, so nothing new
  crosses the wire.

## Data model (`@trm/map-data`)

A presentation-only spec, resolved to an SVG `viewBox` rectangle at render time:

```ts
export type TicketView =
  | { readonly mode: 'full' } // whole map (baseView)
  | { readonly mode: 'auto' } // auto-crop: bbox of the two cities + padding
  | { readonly mode: 'zoom'; readonly level: number }; // auto-frame on midpoint(a,b); level 0..1

export interface TicketDef {
  // …existing id/a/b/value/deck…
  readonly view?: TicketView; // per-ticket override; absent ⇒ inherit map default
}

export interface MapGeography {
  // …existing baseView/land/crop…
  readonly defaultTicketView?: TicketView; // map-wide default for tickets that set no view
}
```

### Resolution

```
resolve(ticket, geography) =
  ticket.view ?? geography?.defaultTicketView ?? { mode: 'full' }
```

- An **unset** ticket (`view` absent) inherits the map default.
- If the author set **no** map default either, it falls back to **`full`** (whole `baseView`).
- The official Taiwan map has no `geography` and no ticket `view`s ⇒ every ticket resolves to `full`
  ⇒ Taiwan's `BASE_VIEW`, i.e. **exactly today's behavior — no regression.**

**Decision — ultimate fallback is whole-map, not auto-crop.** This preserves current Taiwan behavior
byte-for-behavior and is the most predictable "acceptable default". An author who wants every unset
ticket auto-framed sets the _map default_ to `auto` in one place.

### The two framing modes (math, in board space 0..100)

Given endpoints `a=(ax,ay)`, `b=(bx,by)` and the map's `baseView`:

- **`full`** → `rect = baseView`.
- **`auto`** (auto-crop): bounding box of `a`,`b`; pad each side by
  `p = max(AUTO_PAD_MIN, AUTO_PAD_FRAC · max(spanX, spanY))`; enforce a minimum box size so two nearby
  cities don't collapse to a pinhole; then **clamp inside `baseView`**. Always contains both pins.
  Proposed constants: `AUTO_PAD_FRAC = 0.6`, `AUTO_PAD_MIN = 8`, `AUTO_MIN_SPAN = 25` (board units).
- **`zoom`** (slider `level ∈ [0,1]`): centered on `midpoint(a,b)`; box size interpolates from the
  whole `baseView` at `0` to a tight close-up at `1` (`ZOOM_TIGHT_FRAC = 0.18` of each `baseView`
  dimension); clamp inside `baseView`. This is framing _tightness_, **not** guaranteed containment —
  the deliberate difference from `auto`.

The resolver lives in map-data (pure, unit-testable, single source of truth), e.g.
`ticket-view.ts`: `resolveTicketView(ticket, geo?) → TicketView` and
`ticketViewRect(spec, a, b, baseView) → { x, y, w, h }` (plus a combined convenience wrapper the web
calls). Aspect mismatch between the resolved rect and the card is handled by the existing
`preserveAspectRatio="xMidYMid meet"`.

## Hashing (`hashContent`) — no change required

`view` rides inside the already-hashed `tickets` array and `defaultTicketView` inside the
already-hashed `geography` object — exactly like `bow` on a `RouteDef`. The shared digest is a
key-sorted `JSON.stringify` that drops absent keys, so:

- A ticket without `view` and a geography without `defaultTicketView` hash **byte-identically** to
  today ⇒ the pinned Taiwan `CONTENT_HASH` and every existing custom-map hash are untouched.
- Setting a `view` (authored content) changes the hash, which is correct: an in-flight game replays
  against the exact content — display areas included.

**Invariant to preserve:** never assign `view: undefined` / `defaultTicketView: undefined`
explicitly. Follow the established spread-if-defined pattern (`...(x !== undefined ? { view: x } : {})`)
everywhere a draft/DTO is converted, and have "Default" in the UI _remove_ the key (see plumbing).

## Rendering (`apps/web`)

Refactor [`RoutePreview`](../../../apps/web/src/components/RoutePreview.tsx) into a **purely
presentational** component — the same "single presentational component" pattern `MapScene` already
follows (see `apps/web/CLAUDE.md`). It receives everything it needs as props rather than importing
the active catalog / Taiwan globals:

- endpoints `a`, `b`;
- the resolved `viewBox` rect;
- geography source: the custom map's smoothed land rings (`smoothClosedPath`) when
  `geography` is present, else the Taiwan coastline/relief/islands;
- cities + routes (for the faint network + dots);
- `tone` (`long` / `short`).

- `TicketCard` feeds it from the **active game catalog** (`ACTIVE_GEOGRAPHY` / `ACTIVE_BASE_VIEW`,
  `CITIES`, `ROUTES`, `cityById`) + the resolved rect for that ticket.
- The builder feeds it from the **draft** so the author sees a live thumbnail (see below).

## Authoring UI (builder Missions stage)

In [`MissionsStage`](../../../apps/web/src/features/builder/editor/stages/MissionsStage.tsx):

- **Map-default control** at the top of the stage: `Full` / `Auto` / `Zoom` (+ slider when Zoom).
  Writes `geography.defaultTicketView`.
- **Per-ticket control** as a new column on each ticket row: `Default` (inherit) / `Full` / `Auto` /
  `Zoom` (+ slider when Zoom). Writes/clears `ticket.view`.
- **Live thumbnail** of the currently-selected ticket's framing, rendered by the refactored
  `RoutePreview` over the draft (draft cities/routes/geography + resolved rect).

All new strings go through i18n (`zh-Hant` primary + `en`).

## Plumbing (draft ↔ content ↔ wire)

New optional fields must be carried through and validated at every boundary:

- **Web draft types** (`apps/web/src/net/rest.ts`): add `view?: TicketView` to `TicketDraft`,
  `defaultTicketView?: TicketView` to `MapGeographyDraft` (import `TicketView` from `@trm/map-data`).
- **Editor store** (`editor/store.ts`): `updateTicket` already merges patches, but "Default" must
  **remove** the `view` key (not set `undefined`) — mirror `setRouteBow`'s key-deleting pattern with a
  small `setTicketView(id, view?)` helper. Add `setDefaultTicketView(view?)` that writes/removes the
  key on `geography` (guard: only when `geography` exists). Both go through `mutate` for undo/autosave.
- **Content adapter** (`editor/contentAdapter.ts`): spread `view` per ticket
  (`...(t.view !== undefined ? { view: t.view } : {})`); `defaultTicketView` rides along inside the
  whole-`geography` passthrough already there.
- **Server draft types** (`apps/server/src/maps/maps.types.ts`): same two optional fields.
- **Server zod** (`apps/server/src/maps/maps.schemas.ts`): add a `TicketViewSchema`
  (discriminated union on `mode`; `zoom.level` bounded `[0,1]`); add `.view` to `TicketDraftSchema`
  and to `MapContentResponseSchema`'s ticket shape; add `.defaultTicketView` to
  `MapGeographyDraftSchema`; carry both through `draftFromDto` (spread-if-defined).
- **Start seam:** verify the draft→`GameContent` publish path (`MapsService.resolveForStart`) carries
  both fields into `mapContents` so live games and replays resolve the authored framing.

## Validation (`@trm/map-data` `validate.ts`)

- In `validateContent`: for each `ticket.view`, reject unknown `mode` and `zoom.level` outside
  `[0,1]`.
- In `validateGeographyIssues`: same check for `geography.defaultTicketView`.
- New `ValidationIssue` codes (e.g. `ticketViewInvalidMode`, `ticketViewLevelOutOfRange`) with
  `formatIssue` renderings; the web `ValidationPanel` translates them like the rest.
- Mirror the numeric bound (`level ∈ [0,1]`) in the server zod so bad input is rejected at the API
  boundary too.

## Testing

- **map-data:** unit tests for `resolveTicketView` (precedence chain) and `ticketViewRect`
  (`full`/`auto`/`zoom` geometry, clamping, min-size); validation tests for the new issue codes; a
  `hash-extension.spec.ts` case proving a ticket `view` (and a `defaultTicketView`) changes the hash
  while content without them still hashes to the pinned Taiwan hash.
- **web:** a `RoutePreview` render test asserting custom geography (land rings) is drawn instead of
  Taiwan and that the resolved rect drives the `viewBox`; a builder store/adapter round-trip test
  (set per-ticket + map-default views → `draftToContent` → fields present; "Default" removes the key).
- **server:** a schema test that `TicketViewSchema` accepts valid specs and rejects `level` out of
  range / unknown mode, and that `draftFromDto` round-trips both fields.

## Build order (for the plan)

1. map-data: types → resolver → validation → tests.
2. web rendering: refactor `RoutePreview` to presentational; wire `TicketCard` to the active catalog +
   resolver (fixes the Taiwan-silhouette bug on its own).
3. plumbing: web/server draft types, zod schema, adapters, store setters; verify the start seam.
4. builder UI: Missions-stage map-default + per-ticket controls + live thumbnail; i18n.
5. tests across all layers; `yarn typecheck` / `lint` / `test` / `format:check` green.

## Non-goals / rejected alternatives

- **Free-form draggable rectangle per ticket** — rejected in favor of computed `auto` + `zoom`
  (no rectangle state to store, no drag handle, no aspect babysitting).
- **A new top-level `GameContent` field** for the map default — rejected; `defaultTicketView` belongs
  with the other presentation cartography on `MapGeography` and needs no `hashContent` change.
- **Excluding views from the content hash** — rejected; hashing rides for free and gives replay
  exactness, consistent with how `geography` is already hashed.
