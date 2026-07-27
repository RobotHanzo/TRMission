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
