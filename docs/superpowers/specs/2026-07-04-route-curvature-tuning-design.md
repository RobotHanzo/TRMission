# Map builder: route curvature tuning ("Curves" stage)

**Date:** 2026-07-04
**Status:** Approved

## Goal

Custom-map authors get a dedicated builder step for tuning the curvature of railway routes for
aesthetics. Today every route's curve ("bow") is computed automatically by
`packages/map-data/src/geometry.ts` — routes arc away from intruding cities, clamped to ±4.6 —
and only the official Taiwan map can fix ugly cases, via the hardcoded `BOW_OVERRIDE` table keyed
by official route ids. Custom maps have no curvature control at all. This feature exposes exactly
the number the override table tunes — the signed perpendicular deviation of the quadratic curve's
apex from the straight chord — as an optional, author-editable per-route field.

## Decisions (settled with the user)

1. **Interaction — drag handle + slider.** Click a route in the new stage → a handle appears at
   the curve's apex and drags along the chord's perpendicular; an inspector panel offers a slider
   - numeric input, shows the auto-computed value for reference, and has "reset to auto".
2. **Scope — symmetric bow only.** One signed number per route (single quadratic Bézier apex
   deviation, the existing geometry model). S-curves / multi-segment waypoint paths are out of
   scope (they would rewrite the shared curve/slot/tie math and the renderer).

## 1. Data model — optional `bow` on a route

- `RouteDraft` (web `net/rest.ts`, server `maps.types.ts`) and `RouteDef`
  (`packages/map-data/src/types.ts`) gain `bow?: number`: signed apex deviation in board units;
  sign picks the side (along the chord's unit normal). **Absent = auto-bow (today's behavior);
  present = override.**
- New exported constant in `@trm/map-data` geometry: `BOW_LIMIT = 12` — the clamp for authored
  bows (auto-bow maxes at `MAX_BOW = 4.6`; the largest official hand override is 6). The client
  slider/drag and the server zod schema both derive their bounds from it (no drift).
- The builder stores values **rounded to 0.1** (drag produces long floats; rounding keeps drafts
  and hashes stable, mirroring the 2 dp rounding of geography).
- **Hashing:** the shared digest drops absent keys, so a route without `bow` hashes byte-identically
  to one that never had the field — every existing map's `contentHash` is unchanged. A map that
  sets a bow hashes differently, which is correct: it is published content that games/replays pin.
  Per the map-data extension rule, every seam spreads it conditionally
  (`...(r.bow !== undefined ? { bow: r.bow } : {})`), never as an explicit possibly-`undefined`
  key (`exactOptionalPropertyTypes`).

## 2. Geometry (`packages/map-data/src/geometry.ts`)

- `GeometryRoute` gains `readonly bow?: number`.
- `computeOffsetsFor` precedence per route: auto-bow → `BOW_OVERRIDE` → **explicit `r.bow` wins**
  (content beats the hardcoded table; in practice they never collide — official content carries no
  `bow` fields and custom ids never match official ids). An explicit bow is NOT clamped by
  `MAX_BOW` (same as overrides); `BOW_LIMIT` is enforced at the input boundaries (store + zod +
  `validateContent`).
- A double-route pair keeps its perpendicular `gap` and bows together — explicit bow replaces only
  the `bow` component of the pair's offsets, exactly as `BOW_OVERRIDE` composes today.
- Export the offsets computation (currently module-private) so the builder can display the
  **auto** value a selected route would get without its override.
- No engine / proto / determinism impact: `bow` is render-only; `buildBoard` and the engine ignore
  it; game snapshots reference content by hash and custom content travels as REST JSON, not
  protobuf.

## 3. Builder UI — new stage `curves`

- `Stage` union + `STAGES` (`editor/store.ts`): insert `'curves'` between `'routes'` and
  `'missions'` → Crop → Trim → Stops → Routes → **Curves** → Missions → Rules → Share.
  `EditorScreen` gains the label key, lucide `Spline` icon, and stage render; the existing
  geography lock applies unchanged.
- **`stages/CurvesStage.tsx`:**
  - Renders the shared `EditorCanvas`; clicking a route selects it (`select({kind:'route'})`);
    background click deselects.
  - Selected route shows a drag handle at the curve apex (`mid + normal · bow`). Dragging projects
    the pointer (via the existing `clientToBoardPoint`) onto the chord normal → clamp to
    ±`BOW_LIMIT`, round to 0.1. The handle's class is excluded from react-zoom-pan-pinch panning
    so dragging never pans the canvas.
  - Inspector panel: route title (endpoint names, like `RouteForm`), slider −`BOW_LIMIT`…+`BOW_LIMIT`
    step 0.1 + numeric input, the auto value for reference, "reset to auto" (removes the field),
    and — with no selection — a "reset all curves" button.
  - **Ephemeral preview:** during a drag/slide the pending bow is component state passed to
    `EditorCanvas` as an optional `bowPreview={{ routeId, bow }}` prop and merged into the routes
    before `buildRouteGeometryFor`; the store commits once on release. One undo entry per gesture;
    no autosave flood.
- **Store:** new `setRouteBow(id: string, bow: number | undefined)` — the single enforcement
  point for clamping to ±`BOW_LIMIT` and rounding to 0.1 (callers may pass raw drag floats); a
  single `mutate()` patches the route **and its `doubleGroup` siblings** (twin tracks stay in
  sync); `undefined` removes the key (rest-destructuring, like `removeRoute` drops `doubleGroup`).
- i18n: zh-Hant (primary) + en keys for the stage label, hints, bow label, auto reference, reset
  buttons.
- The builder is a lazy route chunk — re-check chunk sizes after the change.

## 4. Server & wire

- `RouteDraftSchema` (`maps.schemas.ts`): `bow: z.number().finite().min(-BOW_LIMIT).max(BOW_LIMIT).optional()`
  (the server already imports from `@trm/map-data`). `MapContentResponseSchema` reuses
  `RouteDraftSchema`, so `GET /maps/content/:hash` carries it automatically.
- Spread-if-defined at the four explicit route-copy seams: server `draftFromDto`
  (`maps.schemas.ts`), server internal `MapDraft` route type (`maps.types.ts` —
  `assembleContent` then passes `draft.routes` through untouched), web
  `editor/contentAdapter.ts` (draft → validation/preview content), web `game/contentCache.ts`
  (content DTO → catalog).
- `validateContent` (map-data `validate.ts`) additionally rejects a non-finite or
  out-of-±`BOW_LIMIT` bow — belt-and-braces behind zod.
- The live board, replays, and the server's shared-map social card all render through the same
  `buildRouteGeometryFor`, so tuned curves appear everywhere with no further work.

## 5. Testing

- **map-data geometry:** explicit bow honored (single route; double pair keeps gap and moves
  together); absent bow = auto; `BOW_OVERRIDE` behavior unchanged.
- **map-data hashing:** `hash-extension.spec.ts` case — content whose routes omit `bow` hashes
  byte-identically to pre-change content; the pinned Taiwan hash in `versions.spec.ts` stays
  green. `validate.ts` bounds cases.
- **web store (`store.test.ts`):** `setRouteBow` sets/rounds, syncs double siblings, `undefined`
  removes the key, one undo entry per call.
- **web `CurvesStage` test** (following `TrimStage.test.tsx` patterns): slider commit calls
  `setRouteBow`; reset clears; auto value displayed.
- **server maps spec:** schema accepts in-bounds / rejects out-of-bounds bow; bow round-trips
  update → publish → `GET /content/:hash`.

## Out of scope

- S-curves / waypoint paths (rejected — geometry model rewrite).
- Migrating the official Taiwan `BOW_OVERRIDE` table into content (would change the pinned
  `CONTENT_HASH`; the table keeps working as-is).
- Any engine or gameplay change; curvature never affects rules, scoring, or determinism.
