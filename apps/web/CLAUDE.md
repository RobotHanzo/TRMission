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
- `store/ui.ts` — view routing (`home`/`room`/`game`), locale, colour-blind toggle.

## Net layer

- `net/rest.ts` — typed REST client. Access token lives in memory; the refresh token is an httpOnly
  cookie sent with `credentials: 'include'`. A 401 triggers **one** silent `/auth/refresh` + retry.
- `net/socket.ts` — the protobuf WS client (`GameSocket`): `create`/`toBinary`/`fromBinary` from
  protobuf-es, heartbeat, backoff reconnect, `ClientHello` handshake with the ws-game ticket.
- `net/connection.ts` — bridges the socket to the game store.

The game flow: lobby `start`/`ticket` (REST) → `connectGame(ticket)` → socket sends `ClientHello`
→ server replies with a snapshot. Reconnect re-fetches a ticket and resyncs on a fresh snapshot.

## Rendering & content

- `components/Board.tsx` — one fluid SVG (viewBox) drawing all routes/cities from the content
  catalog; city coordinates come from `@trm/map-data` normalized x/y. Self-developed graphics only —
  **no copied artwork**; Lucide icons are UI chrome only.
- `theme/colors.ts` — the 8 card colours (each with a colour-blind glyph) and `SEAT_COLORS` (abstract
  seat indices coloured here, distinct from card colours). Respect the colour-blind setting.
- `i18n/index.ts` — react-i18next, zh-Hant primary + en fallback. UI strings live here; **city/ticket
  names are content** and resolve from the catalog by id (`game/content.ts`), not from these tables.
- `game/` — view-only helpers (payment enumeration via the engine's `previewScore`/selectors, tunnel,
  cards, seat mapping). These mirror the server for optimistic preview but the server is authority.

## Player identity

Snapshots carry player ids only (no display names). **Bots are detected by the `bot:` id prefix**
(`id.startsWith('bot:')`) to show a bot badge in trackers/scoreboard; human players render as
`P{seat+1}` / "you". Room member display names (incl. bot difficulty labels) come from the lobby
REST view, not the in-game snapshot.
