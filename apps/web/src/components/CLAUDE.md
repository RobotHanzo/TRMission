# Components (`apps/web/src/components/`)

App-wide context: `apps/web/CLAUDE.md`. Presentational React + SVG; game truth arrives as props
from the store mirror, never computed here.

## The map scene

`MapScene.tsx` is **the single map-scene component** (geography, railway network, city markers),
purely presentational: content, game state, labels, class hooks, hit areas, and per-element event
overlays all arrive as props. Every map surface renders THROUGH it — `Board.tsx` (which keeps only
game orchestration: pan/zoom, camera follow, glow timers, controls; `viewBox` from the active
catalog's `baseView`), the blurred login `MapBackdrop.tsx` (labels/interaction off, pinned
`--inv-scale`), and the builder's `EditorCanvas` — so no surface can drift from the in-game map.

Its dimension tokens come from `@trm/map-data`'s `mapCssVars()` (pinned as `--m-*` vars on the scene
root; `game.css` resolves them — no dimension literal lives in CSS). Self-developed graphics only —
**no copied artwork**; Lucide icons are UI chrome only.

`Geography.tsx` exports `GeographyLayer`, which switches between the built-in Taiwan coastline and
`CustomGeography` (a custom map's cropped-and-projected land rings, stored on `content.geography`,
smoothed with the same Catmull-Rom rendering as the bundled map).

## Player-facing chrome

`SeatAvatar.tsx` renders the resolvers from `../game/playerName.ts` ringed in the player's seat
colour (identity rules: `../game/CLAUDE.md`).

`PlayerActionDialog.tsx` is the report/block surface (the 7 `REPORT_CATEGORIES` from `@trm/shared`),
opened from the player card's report action and from a chat line's flag button. **Never offer it for
yourself or a `bot:` id** — gate the call site with `canModerate`. Reports POST `/reports/player`
with the `gameId`/`roomCode` the reporter is looking at, read from `../store/ui.ts`; that context is
display-only for moderators and never an authorization input. Blocking doctrine:
`../store/CLAUDE.md`.

`AppStoreBadge.tsx` is the "Download on the App Store" lockup on the landing hero and footer. The
four SVGs in `../assets/app-store/` are **Apple's own artwork, unmodified** — the deliberate
exception to the no-copied-artwork rule above. The only choices it makes are the language and the
black/white lockup (dark theme takes the white one); never recolour, filter, or scale it
non-uniformly. Its target is `APP_STORE_URL` (`@trm/client-core/links`) — the `/ios` vanity redirect
in `apps/web/nginx.conf`, so the storefront and app id rotate there, not in client code.

`AppErrorBoundary.tsx` wraps `<App/>` in `main.tsx`. Without it an uncaught render throw blanks the
page. Inline styles + strings read defensively off the i18n singleton, because the crash screen has
to survive the stylesheet or i18n being the thing that broke.

**Any new UI that renders `you.hand`, kept/offered missions, or anything derived from them must
carry `SECRET_CLASS`** — see `../observability/CLAUDE.md`.
