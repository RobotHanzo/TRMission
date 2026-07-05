# Unified map rendering — design

Date: 2026-07-03
Status: approved

## Problem

The map is rendered by four independent implementations that share the pure geometry math
(`@trm/map-data/src/geometry.ts`) but each hand-roll the scene on top of it:

| Surface                                  | File                                                    | Today                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-game board (game / replay / tutorial) | `apps/web/src/components/Board.tsx`                     | The "main version": React SVG, CSS-class styled, full feature set                                                                                                   |
| Login backdrop                           | `apps/web/src/components/MapBackdrop.tsx`               | Re-implements the route/city loops inline (does not even use `RouteShape`)                                                                                          |
| Map-builder canvas                       | `apps/web/src/features/builder/editor/EditorCanvas.tsx` | Duplicates the route-group / city-marker loops with editor states bolted on                                                                                         |
| OG social card                           | `apps/server/src/og/map-svg.ts`                         | Full re-implementation in string-built SVG; every colour, stroke width and car dimension hand-copied from `game.css` / `tokens.css` / `theme/colors.ts` as literals |

Two further surfaces are fine as-is: `Specimens.tsx` (already unified through the shared
`RouteShape` + `straightRouteGeometry`) and `RoutePreview.tsx` (deliberately schematic —
a different visual language, explicitly **out of scope** per the user).

The duplication that bites:

1. The **scene loops** (route group scaffolding — kind classes, counter-scaled `perp`
   translate, `RouteShape`, hit path — and city markers — dot/hub, island ring, label)
   are written three times in the web app.
2. The **visual constants** exist in three places: `game.css` (dimensions as
   `calc(Npx * var(--inv-scale))` literals), `tokens.css` (cartography palette, light +
   dark), and `og/map-svg.ts` (both, copied as literals, documented as "mirrors
   game.css… so the card reads exactly like the in-game map" — drift by design).

## Goal

The in-game map becomes the single rendering source of truth. The backdrop, editor
canvas, and OG card become configured variations of it. **No visual or behavioural
change to any surface.**

## Decisions (user-approved)

- **OG card**: shared-tokens approach. The card keeps its string-SVG pipeline (resvg has
  no `var()`/`calc()` support, so the live CSS cannot drive it), but every visual
  constant imports from one shared token module. No React/SSR on the server.
- **RoutePreview** (mission-card miniature): out of scope, stays schematic.

## Design

### 1. Shared cartography tokens — `packages/map-data/src/render-tokens.ts` (new)

`@trm/map-data` already hosts everything render-shared (geometry math,
`TAIWAN_LAND_PATH`, `TAIWAN_GRATICULE`, `TAIWAN_BASE_VIEW`); this adds the visual
constants. The module is pure data — it never touches the content tables, so
`CONTENT_HASH` is unaffected.

- **`MAP_DIMS`** (board units): roadbed width (2.8), car slot height/rx/stroke
  (1.44 / 0.42 / 0.3), owned-slot stroke, tunnel-glow width (6), tie rect (8 × 0.28),
  ferry line width/dash, ferry pip radius/stroke (0.7 / 0.25), ferry-loco stroke,
  hit-path width (4.2), glyph-badge radius/stroke, city dot/island radii (1.15 / 1.4),
  city marker stroke (0.4), hub rect (2.5 × 1.6, rx 0.8), graticule weight/dash
  (0.32 / 0.9 1.7), land stroke (0.45), land-surf width/opacity (2.4 / 0.6), relief
  opacities/ridge stroke/dash.
- **`MAP_PALETTE`** — cartography colours, light **and** dark themes: sea, sea-line,
  land, coast, relief, surface, ink, blue. (Dark is included so the parity test covers
  both; the OG card uses light only.)
- **Route-colour hexes + livery rainbow** — `ROUTE_COLOR_HEX` (8 colours + GRAY) and
  `LIVERY_COLORS` (6 liveries in spectrum order) become canonical here. The web's
  `theme/colors.ts` keeps `CARD_COLOR_TOKENS` (glyphs / ink / zh names are web
  concerns) but sources each `hex` from the shared module. The OG renderer imports them
  directly, deleting its literal copies. `SEAT_COLORS` stays web-side (the OG map card
  never draws ownership).

Web consumption of dimensions: a **`mapCssVars()`** helper returns them as CSS custom
properties (`{'--m-bed-w': '2.8', …}`). `MapScene` pins them on its `<svg>` root;
`Specimens.tsx`'s standalone specimen SVGs spread the same helper. `game.css` switches
its dimension literals to `var(--m-*)` (e.g.
`stroke-width: calc(var(--m-bed-w) * 1px * var(--inv-scale))`), so after this change
there is **no dimension literal left in CSS to drift**. Derived halves (e.g. slot
`y = −height/2`) are computed in `calc()`, not stored twice.

Colour seam: CSS theming (`[data-theme='dark']`, `prefers-color-scheme`) must stay in
CSS, so `tokens.css` keeps its `--tr-*` definitions. The drift gate is a **parity
test**: import `tokens.css` with Vite's `?raw`, parse the `--tr-*` cartography values
for both themes, assert equality with `MAP_PALETTE`.

### 2. `MapScene` — the single map component (`apps/web/src/components/MapScene.tsx`)

Extracted from `Board.tsx`'s SVG body. Purely presentational: no store reads, no i18n,
no content singletons — everything arrives by props. Owns the `<svg class="board">`
root (viewBox, role/aria, token vars, `FerryLocoGradientDef`) and renders the full
scene in board order:

1. Geography layer — official Taiwan (coast / relief / islands / graticule / compass)
   or a custom map's smoothed land rings, from an explicit `geography` prop (the
   current `GeographyLayer`/`Geography`/`CustomGeography` components are reused, with
   the `ACTIVE_GEOGRAPHY` singleton read lifted to the callers).
2. Route loop — group with kind classes (`tunnel`/`ferry`), counter-scaled `perp`
   translate, seat CSS var, `RouteShape`, optional hit path (+ title), optional
   colour-blind glyph badge.
3. City loop — dot vs hub marker, island ring, buildable state, station overlay,
   just-built ring, ticket-target halo, label + LOD tier classes.
4. `children` — overlay layers (Board's ticket sweeps and longest-trail reveal render
   here, keeping animation-store coupling out of MapScene).

Props (final names pinned during implementation; shape approved):

```
content:      cities, routes, geometry, hubs, geography?
game state:   owned?, stations?, glowingRoutes?, glowingStations?, highlightCities?, canAct?
editor state: selectedRoute?, selectedCity?, alwaysHitRoutes?
labels:       cityLabel?(city) → string | null   (omitted = no labels), cityTier?
interaction:  onRouteClick?, onCityClick?, onBackgroundClick?
misc:         colorBlind?, svgRef?, preserveAspectRatio?, className?, style?, children
```

The DOM (classes, structure, attribute placement) comes out byte-equivalent to today's
Board rendering, so `game.css` and existing tests keep working.

### 3. Consumers become thin

- **`Board.tsx`** keeps only game orchestration: `TransformWrapper` pan/zoom, camera
  sync/follow, glow arming/expiry timers, `MapControls`, framers — and renders
  `<MapScene>` with full game props plus sweep/reveal layers as children.
- **`MapBackdrop.tsx`** → `<MapScene>` with labels/interaction off, pinned
  `--inv-scale`, `preserveAspectRatio="xMidYMid slice"`. Its hand-rolled loops are
  deleted.
- **`EditorCanvas.tsx`** → `<MapScene>` with draft content, selection/highlight
  states, always-hit routes, `nameZh` labels, background-click → board-point mapping
  kept caller-side (it owns the svg ref via `svgRef`).
- **`Specimens.tsx`** — unchanged apart from spreading `mapCssVars()`.

### 4. OG card consumes tokens

`og/map-svg.ts` keeps its string pipeline and its thumbnail-only options — contain-fit,
route/city decluttering (these must never reach the live board) — but imports every
colour and dimension from `render-tokens.ts`. Its intentional thumbnail deviations
(thin ties: 3.6 vs the board's 8; slimmer tunnel glow: 2.4 vs 6) become named,
commented derivations (e.g. `MAP_DIMS.tieW * OG_TIE_SCALE`) instead of unexplained
magic numbers. `card-svg.ts` chrome (fonts, panel layout) is untouched.

## Error handling

No new runtime failure modes: the token module is static data; `MapScene` renders the
same guards Board has today (missing geometry for a route id → skip). The parity test
and the CSS-var switch turn silent visual drift into loud CI failures.

## Testing & validation

- Existing suites pass unchanged: `Board.test.tsx`, builder/editor tests,
  `og.e2e.spec.ts`, plus full `yarn typecheck` / `lint` / `test`.
- New: tokens-parity test (`tokens.css` ⇄ `MAP_PALETTE`, both themes).
- If an OG literal is found to have **already** drifted from the CSS value it claims to
  mirror, flag it in the summary rather than silently changing the card's look.
- Visual verification before commit: run the web app; check board, login backdrop,
  builder canvas; render the OG map/site PNGs.

## Out of scope

- `RoutePreview.tsx` (mission-card miniature) — deliberately schematic.
- Dark-theme OG cards, any visual redesign, any behaviour change.
- Server-side React/SSR rendering of the card (rejected: React in NestJS + resvg CSS
  limitations for modest payoff on a ~500 px thumbnail).
