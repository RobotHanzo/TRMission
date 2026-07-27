# Custom map builder (`apps/web/src/features/builder/`, lazy-loaded)

App-wide context: `apps/web/CLAUDE.md`. Server side: `apps/server/src/maps/CLAUDE.md`; content
model + validators: `packages/map-data/CLAUDE.md`.

Feature-gated: authoring requires the per-account **`mapBuilder`** feature (granted from the
maintainer dashboard; carried on `PublicUser.features`, checked via `useHasFeature` from
`store/session.ts`). Without it the AppHeader entries hide, `/maps`+`/maps/:id/edit` redirect home
(App.tsx effect — cosmetic; the server 403s regardless), and the room-settings custom-map option
disappears; guests can still _play_ a custom-map game.

The authoring UI lives at `/maps` (list + clone-by-code) and `/maps/:id/edit` (staged editor: Crop →
Trim → Stops → Routes → Curves → Missions → Rules → Share; Trim lets you click individual land rings
— e.g. a stray outlying island — to delete them from the crop without re-drawing the whole bounding
box; Curves tunes each route's optional `bow` — the signed curve-apex deviation the shared geometry
renders — via a draggable apex handle + slider, with double pairs always bowing together). Its own
zustand store (`editor/store.ts`) with undo and debounced autosave; a single SVG canvas
(`editor/EditorCanvas.tsx`, react-zoom-pan-pinch + the existing `boardView.ts` pixel→board
projection) shared across stages, rendering through the shared `components/MapScene.tsx`.

**Every canvas must publish the live zoom** (`editor/ZoomVar.tsx`, the builder's ZoomTracker):
`--inv-scale`/`--marker-scale` counter-scale labels and grow markers, and `data-zoom` drives
game.css's label level-of-detail — which needs the authored tier, so `EditorCanvas` feeds
`cityTier` from the draft (unset ⇒ `minor`, as published content reads it) and only the
selected/highlighted station keeps its name through the thinning. `.editor-canvas-inner` carries
home defaults for both vars like `.board-viewport` does: undefined, every `calc(… * var(…))` in
game.css is invalid at computed-value time, so labels fall back to the inherited 16px **in board
units** and markers to `r: 0`.

Both vars are then trimmed to `EDITOR_MAP_WEIGHT` (0.72) — the **one deliberate departure** from
"previews exactly as it will play". The board pins glyphs to a constant on-screen size, so their
size tracks how big the surface is, not the zoom; those weights suit a player zoomed into a
corridor and bury the network when you sit zoomed out over the whole map to author it. Layout is
still exact; only the ink is lighter. Keep the CSS defaults above in step with the constant.

**Stops holds a selection of any size.** The store's `selection` stays the one-station case (the
inspector, the ember ring, every other stage); a group of two or more lives in `StopsStage` and
leaves the store selection null. Shift/ctrl-click, the multi-select switch (the touch path — the
builder runs in a WebView on mobile, where there are no modifier keys), or select-all build it;
`moveCities` then translates it as ONE undo step, by drag, by arrow key, or by the move button
landing the group's `selectionBounds` centre on the click. The dashed frame the canvas draws around
a ≥2 selection marks exactly that centre, so what you see and where it lands agree. A stage passing
`cityDrag` also takes station markers out of the canvas's pan gesture, so the press grabs the
station instead of the map.

A live `ValidationPanel` runs `@trm/map-data`'s `validate`/`validateGeography`/`validateForPlay`
client-side as you edit (map-data ships TS source, so it's directly importable — no server
round-trip needed to see errors). World cropping (`geo/world.ts`, `geo/projection.ts` —
equirectangular scaled by `cos(midLat)` — `geo/clip.ts` Sutherland–Hodgman, `geo/simplify.ts`
Douglas–Peucker) runs entirely client-side against a bundled Natural Earth 1:110m land dataset
(`geo/worldData.ts`, public domain); the result is rounded to 2 dp **before** it's ever hashed, so
re-publishing an untouched draft produces the same `contentHash`. Mission auto-generation calls
`@trm/map-data`'s `generateTickets` directly (seeded — same seed always reproduces the same list, so
"reroll" is just bumping the seed).

**This entire feature is one lazy route chunk (`App.tsx`) — it must never inflate the main bundle.**
