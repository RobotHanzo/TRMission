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
- `store/session.ts` — auth: `playAsGuest` / `login` / `register` / `upgrade` / `loginWithGoogleCredential` / `logout`, plus
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

The REST client, `GameSocket`, `SandboxSocket`, and the game/chat/log/animations stores live in
**`@trm/client-core`** (shared with mobile); the app-side files are the web transport + re-export
shims:

- `net/rest.ts` — builds the shared client with the web `RestTransport`: same-origin base, access
  token in memory (inside the core), refresh token as an httpOnly cookie sent with
  `credentials: 'include'`. A 401 triggers **one** silent `/auth/refresh` + retry (single-flight).
- `net/socket.ts` — re-exports the shared protobuf WS client (`GameSocket`: heartbeat, backoff
  reconnect + per-attempt ticket re-mint, `ClientHello` handshake) plus web's `defaultWsUrl()`.
- `net/connection.ts` — bridges the socket to the game store.
- `net/google.ts` — loads Google Identity Services (GSI) once per page; `LoginScreen` uses it to
  render Google's own sign-in button + fire One Tap, falling back to the legacy redirect button if
  the script fails to load.

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
- `components/MapScene.tsx` — **the single map-scene component** (geography, railway network, city
  markers), purely presentational: content, game state, labels, class hooks, hit areas, and
  per-element event overlays all arrive as props. Every map surface renders THROUGH it —
  `components/Board.tsx` (which keeps only game orchestration: pan/zoom, camera follow, glow
  timers, controls; `viewBox` from the active catalog's `baseView`), the blurred login
  `components/MapBackdrop.tsx` (labels/interaction off, pinned `--inv-scale`), and the builder's
  `EditorCanvas` — so no surface can drift from the in-game map. Its dimension tokens come from
  `@trm/map-data`'s `mapCssVars()` (pinned as `--m-*` vars on the scene root; `game.css` resolves
  them — no dimension literal lives in CSS). Self-developed graphics only — **no copied artwork**;
  Lucide icons are UI chrome only. `components/Geography.tsx` exports `GeographyLayer`, which
  switches between the built-in Taiwan coastline and `CustomGeography` (a custom map's
  cropped-and-projected land rings, stored on `content.geography`, smoothed with the same
  Catmull-Rom rendering as the bundled map).
- `theme/colors.ts` — the 8 card colours (each with a colour-blind glyph) and `SEAT_COLORS` (abstract
  seat indices coloured here, distinct from card colours). The hexes are canonical in
  `@trm/map-data`'s render tokens (shared with the server's OG card); `theme/tokens-parity.test.ts`
  gates `tokens.css`'s `--tr-*` cartography palette against the same module. Respect the
  colour-blind setting.
- `i18n/index.ts` — react-i18next, zh-Hant primary + en fallback. UI strings live here; **city/ticket
  names are content** and resolve from the active catalog by id, not from these tables.

## Custom map builder (`features/builder/`, lazy-loaded)

Feature-gated: authoring requires the per-account **`mapBuilder`** feature (granted from the
maintainer dashboard; carried on `PublicUser.features`, checked via `useHasFeature` from
`store/session.ts`). Without it the AppHeader entries hide, `/maps`+`/maps/:id/edit` redirect home
(App.tsx effect — cosmetic; the server 403s regardless), and the room-settings custom-map option
disappears; guests can still _play_ a custom-map game. The authoring UI lives at `/maps` (list +
clone-by-code) and `/maps/:id/edit` (staged editor: Crop → Trim → Stops → Routes → Curves →
Missions → Rules → Share; Trim lets you click individual land rings — e.g. a stray outlying island —
to delete them from the crop without re-drawing the whole bounding box; Curves tunes each route's
optional `bow` — the signed curve-apex deviation the shared geometry renders — via a draggable apex
handle + slider, with double pairs always bowing together). Its own zustand store (`editor/store.ts`)
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
route chunk (`App.tsx`) — it must never inflate the main bundle.

- `game/` — view-only helpers (payment enumeration via the engine's `previewScore`/selectors, tunnel,
  cards, seat mapping). These mirror the server for optimistic preview but the server is authority.
- `features/replay/` + `screens/ReplayScreen.tsx` — client-side replay of finished games. Browsing
  your own replays needs the **`replayReview`** feature (HistoryScreen hides the watch button
  without it; a member's 403 renders `history.replayDisabled`), but `/replay/:gameId` stays
  reachable — `link`-visibility replays load for anyone holding the URL. Fetches
  `/history/:id/replay` (config + action log), runs the real engine locally and projects through
  `redactFor(viewer)`/`viewToSnapshot` into isolated sandbox stores (`SandboxProvider`, which also
  isolates the log store), rendered by the standard `GameStage sandbox`. Perspective switching
  re-projects the same step for another seat; seeks rebuild silently (no animations), forward
  steps animate.

## Error reporting (`observability/`, issue #44)

- `components/AppErrorBoundary.tsx` wraps `<App/>` in `main.tsx`. Without it an uncaught render
  throw blanks the page. Inline styles + strings read defensively off the i18n singleton, because
  the crash screen has to survive the stylesheet or i18n being the thing that broke.
- **`observability/report.ts` is the only observability module the app graph may import.** It holds
  no `@sentry/*` import and dynamically imports `observability/sentry.ts` only after seeing a
  `VITE_SENTRY_DSN`. Vite inlines that build-time var, so a DSN-less build makes the whole import
  dead code and the ~92 kB gzipped SDK **is not in the bundle at all**; a configured build fetches
  it in an async chunk instead of blocking boot. A static `@sentry/react` import from a component
  or store silently undoes both — don't add one.
- `observability/sentry.ts` — the SDK setup (`start()`), reached only through the façade. Browser
  tracing + Session Replay. Replays of ordinary sessions default to **off**
  (`VITE_SENTRY_REPLAY_SAMPLE_RATE=0`); only an erroring session's buffered replay is kept. The
  trade-off of lazy loading: errors thrown in the first tick or two of boot are dropped, not queued
  (a queue would be one more place for game state to sit).
- **`observability/secrets.ts`'s `SECRET_CLASS` is load-bearing — and it is now the ONLY replay
  masking on this surface.** `maskAllText`/`maskAllInputs`/`blockAllMedia` are off (a replay of grey
  boxes says only that something broke, which the error already said). Session Replay records the
  live DOM, and a maintainer reviewing a replay may be seated at the same table, so `PlayerHand`,
  `TicketPanel`, `TicketChooser` and `PaymentModal`'s option list carry the class and are `block`ed
  outright — an unmasked hand is a live anti-cheat leak, and text masking never covered it anyway
  (the secret is the card colours and route shapes). **Any new UI that renders `you.hand`,
  kept/offered missions, or anything derived from them must carry it too.**
- Everything on the wire to Sentry goes through `@trm/shared`'s `scrubTelemetryEvent`, the same
  denylist the server and mobile use — game secrets, credentials and ad identifiers only.
  Identifiers are sent on purpose: `sendDefaultPii: true`, and `App.tsx` attaches
  `{ id, email, username }` as the Sentry user so a report says which account hit it.
- `lib/preloadRecovery.ts` (installed from `main.tsx`) answers Vite's `vite:preloadError`: every
  route is a lazy chunk, so a tab left open across a redeploy asks for asset hashes that no longer
  exist and crashes the root boundary. It reloads once per minute-window to pick up the new
  `index.html`; beyond that it lets the error through, because reloading is no longer the fix.
  `preventDefault()` and the reload are a pair — cancelling without reloading hands `React.lazy`
  an undefined module. nginx backs this up: `/assets/` 404s instead of falling through to the SPA
  shell, so a stale asset can't be answered with `index.html` at 200.
- Source maps upload only when `SENTRY_AUTH_TOKEN` is set at build time (`vite.config.ts`); they
  are deleted right after upload and never served.

## Player identity

Snapshots carry player ids only (no display names). **Bots are detected by the `bot:` id prefix**
(`id.startsWith('bot:')`) to show a bot glyph in trackers/scoreboard; human players render as
`P{seat+1}` / "you". Room member display names, pictures (`avatarUrl`), and bot difficulty labels
come from the lobby REST view, not the in-game snapshot. `game/playerName.ts` owns both resolvers
(`usePlayerName` / `usePlayerAvatar`); `components/SeatAvatar.tsx` renders the result ringed in the
player's seat colour.

## Moderation (`store/moderation.ts`, Apple 1.2 / Play UGC)

The account's block list mirrored locally — the store itself is `@trm/client-core`'s
`createModerationStore` (shared with mobile), bound here to the web REST client. Hydrated on
sign-in/restore and `reset()` on sign-out (`store/session.ts`); optimistic block/unblock with
rollback via `PUT/DELETE /me/blocks/:userId`.

**Blocking is display-only.** `ChatPanel` filters a blocked author's messages (text AND presets),
and `usePlayerName`/`usePlayerAvatar` mask their display name back to `P{seat+1}` and suppress
their picture — both are UGC, so masking one without the other leaks the identity back. Game
state, seating, and matchmaking are never touched: a blocked opponent stays at the table.

`components/PlayerActionDialog.tsx` is the report/block surface (the 7 `REPORT_CATEGORIES` from
`@trm/shared`), opened from the player card's report action and from a chat line's flag button.
**Never offer it for yourself or a `bot:` id** — gate the call site with `canModerate`. Reports
POST `/reports/player` with the `gameId`/`roomCode` the reporter is looking at, read from
`store/ui.ts`; that context is display-only for moderators and never an authorization input.
