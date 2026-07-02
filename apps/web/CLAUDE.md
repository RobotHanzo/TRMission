# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`apps/web` is the React + Vite + TypeScript client: an interactive SVG Taiwan board, a protobuf
WebSocket client, REST auth/lobby, and i18n (zh-Hant primary + en). It renders the server's
authoritative snapshot and never computes game truth itself.

```bash
yarn workspace @trm/web dev       # vite on :5173 (proxies /api + /ws → :3001)
yarn workspace @trm/web build     # vite build
yarn workspace @trm/web test      # vitest + @testing-library/react
```

**Pin:** Vite is held at **^5** for vitest 2 compatibility — do not bump to Vite 6.

## State model: snapshot is authoritative

The server sends a fully-projected `GameSnapshot` (already redacted for this viewer); the client
mirrors it and ignores any snapshot with an older `stateVersion`. There is no client-side game logic
that can disagree with the server.

- `store/game.ts` — the authoritative mirror (`snapshot`, recent events, socket status, rejection).
- `store/session.ts` — auth: `playAsGuest` / `login` / `register` / `upgrade` / `logout`, plus
  `restore()` which the app calls on mount to resume a session from the httpOnly refresh cookie
  (works for guests and registered users alike). The in-memory access token is restored via the
  401→refresh path; `booting` gates first render.
- `store/ui.ts` — view routing (`home`/`room`/`game`/`login`/`loginCallback`/`history`/`replay` ⇄
  `/`, `/room/:code`, `/login`, `/login/callback`, `/history`, `/replay/:gameId`), locale,
  colour-blind toggle. Login is its own route: `syncFromUrl`
  gates unauthenticated visitors to `/login?redirect=<original>` and `navigateAfterAuth()` resumes
  that target on success (replaces the old implicit "keep the URL + resume" effect). OAuth lands on
  `/login/callback`, where the refresh cookie set by the server callback drives the normal
  `restore()` path (no token ever in the URL).

## Net layer

- `net/rest.ts` — typed REST client. Access token lives in memory; the refresh token is an httpOnly
  cookie sent with `credentials: 'include'`. A 401 triggers **one** silent `/auth/refresh` + retry.
- `net/socket.ts` — the protobuf WS client (`GameSocket`): `create`/`toBinary`/`fromBinary` from
  protobuf-es, heartbeat, backoff reconnect, `ClientHello` handshake with the ws-game ticket.
- `net/connection.ts` — bridges the socket to the game store.

The game flow: lobby `start`/`ticket` (REST) → `connectGame(ticket)` → socket sends `ClientHello`
→ server replies with a snapshot. Reconnect re-fetches a ticket and resyncs on a fresh snapshot.

## Rendering & content

- The client is **not** hardcoded to Taiwan: `game/catalog.ts` builds a `ContentCatalog` (content +
  id maps + geometry + display names) from whatever `GameContent` the active game/replay/editor is
  using, and `game/contentCache.ts` resolves a `contentHash` to one — bundled official maps resolve
  synchronously, anything else (a custom map) fetches `GET /api/v1/maps/content/:hash` and caches by
  hash (never a single "current content" singleton, so a stale in-flight fetch for a hash you've
  since navigated away from can't clobber the active catalog). `useActiveContent(hash)` is the hook
  screens gate rendering on; `GameScreen`/`ReplayScreen` show a loading veil until it's `'ready'`.
- `components/Board.tsx` — one fluid SVG (`viewBox` from the active catalog's `baseView`, not a
  constant) drawing all routes/cities from the content catalog; city coordinates come from the
  catalog's normalized x/y. Self-developed graphics only — **no copied artwork**; Lucide icons are UI
  chrome only. `components/Geography.tsx` exports `GeographyLayer`, which switches between the
  built-in Taiwan coastline and `CustomGeography` (a custom map's cropped-and-projected land rings,
  stored on `content.geography`, smoothed with the same Catmull-Rom rendering as the bundled map) —
  also used by `components/MapBackdrop.tsx`, the blurred non-interactive backdrop on `LoginScreen`
  (pins `--inv-scale` since there's no live `.board-viewport` there).
- `theme/colors.ts` — the 8 card colours (each with a colour-blind glyph) and `SEAT_COLORS` (abstract
  seat indices coloured here, distinct from card colours). Respect the colour-blind setting.
- `i18n/index.ts` — react-i18next, zh-Hant primary + en fallback. UI strings live here; **city/ticket
  names are content** and resolve from the active catalog by id, not from these tables.

## Custom map builder (`features/builder/`, lazy-loaded)

Registered-users-only (guests can play a custom map, not author one) authoring UI at `/maps` (list +
clone-by-code) and `/maps/:id/edit` (staged editor: Crop → Trim → Stops → Routes → Missions → Rules →
Share; Trim lets you click individual land rings — e.g. a stray outlying island — to delete them
from the crop without re-drawing the whole bounding box). Its own zustand store (`editor/store.ts`)
with undo and debounced autosave; a single SVG
canvas (`editor/EditorCanvas.tsx`, react-zoom-pan-pinch + the existing `boardView.ts` pixel→board
projection) shared across stages; a live `ValidationPanel` runs `@trm/map-data`'s
`validate`/`validateGeography`/`validateForPlay` client-side as you edit (map-data ships TS source,
so it's directly importable — no server round-trip needed to see errors). World cropping
(`geo/world.ts`, `geo/projection.ts` — equirectangular scaled by `cos(midLat)` — `geo/clip.ts`
Sutherland–Hodgman, `geo/simplify.ts` Douglas–Peucker) runs entirely client-side against a bundled
Natural Earth 1:110m land dataset (`geo/worldData.ts`, public domain); the result is rounded to 2 dp
**before** it's ever hashed, so re-publishing an untouched draft produces the same `contentHash`.
Mission auto-generation calls `@trm/map-data`'s `generateTickets` directly (seeded — same seed always
reproduces the same list, so "reroll" is just bumping the seed). This entire feature is one lazy
route chunk (`App.tsx`) — it must never inflate the main bundle; re-check chunk sizes after touching
anything under `features/builder/`.
- `game/` — view-only helpers (payment enumeration via the engine's `previewScore`/selectors, tunnel,
  cards, seat mapping). These mirror the server for optimistic preview but the server is authority.
- `features/replay/` + `screens/ReplayScreen.tsx` — client-side replay of finished games: fetches
  `/history/:id/replay` (config + action log), runs the real engine locally and projects through
  `redactFor(viewer)`/`viewToSnapshot` into isolated sandbox stores (`SandboxProvider`, which also
  isolates the log store), rendered by the standard `GameStage sandbox`. Perspective switching
  re-projects the same step for another seat; seeks rebuild silently (no animations), forward
  steps animate.

## Player identity

Snapshots carry player ids only (no display names). **Bots are detected by the `bot:` id prefix**
(`id.startsWith('bot:')`) to show a bot badge in trackers/scoreboard; human players render as
`P{seat+1}` / "you". Room member display names (incl. bot difficulty labels) come from the lobby
REST view, not the in-game snapshot.
