# URL routing for reload-safe room/game state

**Date:** 2026-06-28
**Status:** Approved (design)
**Area:** `apps/web`

## Problem

The web client tracks navigation with an in-memory `view: 'home' | 'room' | 'game'`
field in the `useUi` zustand store. The browser URL is always `/`, so a page reload
drops the user back to the home screen — even when they were waiting in a lobby or
playing a game. The session itself already survives reload (`restore()` re-auths from
the httpOnly refresh cookie, for guests and registered users alike), but the room/game
location is lost.

## Goal

A hard reload while waiting in a lobby **or** while in a game restores the user to that
same state. Back/forward navigation behaves consistently.

## Key facts that shape the design

- **The room code is the only durable handle.** `api.getTicket(code)` (POST
  `/rooms/:code/ticket`) re-mints a short-lived ws-game ticket, and `api.getRoom(code)`
  reports `status` (`LOBBY` / `STARTED` / `CLOSED`) plus `gameId`. There is no
  game-id-keyed reconnection endpoint, so reconnection — lobby and in-game alike — keys
  off the room code. The `gameId`/`ticket` held in the store are ephemeral.
- **`RoomScreen` already performs the lobby→game transition.** Its poll loop fetches the
  room every 2s (and immediately on mount); when `status === 'STARTED'` it calls
  `getTicket` → `connectGame` → `enterGame`. Reload reuses this verbatim.
- **The session already survives reload.** `App` calls `restore()` on mount; `booting`
  gates first render. Guests persist via the same refresh cookie as registered users.
- **SPA fallback is already configured.** nginx serves `try_files $uri $uri/ /index.html`
  and the Vite dev server does history fallback by default, so clean path URLs work on a
  hard reload with no deployment change.
- **Import graph is safe for centralizing teardown.** `game.ts` does not import `ui.ts`,
  and `connection.ts` imports only `game.ts`. So `ui.ts` may import `disconnectGame` from
  `net/connection` (`ui → connection → game`, no cycle). `ui.ts` must **not** import
  `session.ts` (`session.ts` already imports `ui.ts`); the `authed` decision is passed in
  from `App`.

## Decisions

- **No router library.** Two routes (`/`, `/room/:code`) bound by hand to the History
  API inside the existing `useUi` store. Adding react-router for two routes runs against
  the repo's minimal-dependency grain.
- **Single `/room/:code` path** for both lobby and in-game. The URL does not change when
  the game starts; `RoomScreen`'s existing auto-transition covers both fresh starts and
  reloads.
- **Room code is the path param** (not `gameId`), because reconnection requires the code.

## URL scheme

| State                 | URL          |
| --------------------- | ------------ |
| Home                  | `/`          |
| Lobby **and** in-game | `/room/ABCD` |

## Changes

### `store/ui.ts` — the store becomes URL-aware

The store remains the in-memory mirror; navigation actions additionally write the URL,
and a new reader applies the URL to state. Small private helpers:

- `roomCodeFromPath(): string | null` — match `^/room/([^/]+)$` against
  `window.location.pathname`; return the decoded, upper-cased code or `null`.
- `pushPath(path)` / `replacePath(path)` — call `history.pushState` / `replaceState`,
  each guarded by `window.location.pathname !== path` to avoid duplicate history entries.

Action behaviour:

- `enterRoom(code)` → `pushPath('/room/CODE')`, then `set({ view: 'room', roomCode })`.
- `goHome()` → `disconnectGame()`, `pushPath('/')`, then
  `set({ view: 'home', roomCode: null, gameId: null, ticket: null })`. This centralizes
  socket teardown (previously only `GameScreen.leave()` disconnected; logout and the
  back button leaked the socket).
- `enterGame(gameId, ticket)` → `set({ view: 'game', gameId, ticket })` only. The URL is
  already `/room/CODE` and `roomCode` is already set, so no push.
- `syncFromUrl(authed: boolean)` (new) — parse the path:
  - no code → `disconnectGame()`, `set` home.
  - code + `authed` → `set({ view: 'room', roomCode })` (no push — the URL is already
    correct; `RoomScreen` then polls and auto-connects if `STARTED`).
  - code + not `authed` → `replacePath('/')`, `disconnectGame()`, `set` home.

### `App.tsx` — bootstrap + back/forward

Two effects (in addition to the existing `restore()` effect):

1. **Initial bootstrap** — a one-shot (guarded by a `useRef`) that, once `booting` is
   false, runs `syncFromUrl(!!user)`. This is what turns a hard reload of `/room/ABCD`
   into the correct view.
2. **popstate listener** — `window.addEventListener('popstate', …)` calling
   `syncFromUrl(!!useSession.getState().user)`, so the view tracks back/forward and the
   socket is dropped when navigating home.

`App` owns the `authed` argument (it can read both stores), keeping `ui.ts` free of any
`session.ts` import.

### `screens/RoomScreen.tsx` — dead-room escape

The loading/error card (`if (!room) return <div className="card">{err ?? t('connecting')}</div>`)
currently offers no way out, which a reload to a stale/closed-room URL can now reach.
Add a "back home" affordance, and route home when `getRoom` reports the room is gone
(not-found / `CLOSED`).

### `screens/GameScreen.tsx` & `components/AppHeader.tsx` — lean on `goHome`

`GameScreen.leave()` can drop its explicit `disconnectGame()` and just call `goHome()`
(now idempotent and disconnect-owning). `AppHeader.onLogout` keeps calling `goHome()`,
which now also tears down any live socket.

## Reload data flow (in-game)

```
reload /room/ABCD
  → restore()                       (re-auth from refresh cookie; guests included)
  → booting=false → syncFromUrl(true)
  → view = 'room'
  → RoomScreen mounts, first poll runs immediately
  → getRoom(ABCD) → STARTED
  → getTicket(ABCD) → connectGame(ticket) → enterGame(gameId, ticket)
  → GameScreen renders on first snapshot
```

A brief "connecting" card shows, identical to a normal game start.

## Edge cases

- **Dead / closed / unknown room on reload** — `RoomScreen` routes home (and shows a
  back-home affordance) instead of trapping the user on the error card.
- **Logged-out hit on `/room/CODE`** (cookie cleared) — URL replaced to `/`, AuthPanel
  shown. Resume-after-login is intentionally **out of scope** (YAGNI; persistent guest
  and registered sessions cover the real reload case).
- **Link-sharing to _join_ a room** — out of scope; reload restores existing members
  only (joining a room one isn't in needs `joinRoom`, not `getRoom`).

## Testing

- New `store/ui.test.ts`:
  - `enterRoom('ABCD')` sets view `room` and pushes `/room/ABCD`.
  - `goHome()` sets view `home`, pushes `/`, and disconnects.
  - `syncFromUrl(true)` on `/room/ABCD` → view `room`, `roomCode === 'ABCD'`.
  - `syncFromUrl(false)` on `/room/ABCD` → view `home`, URL replaced to `/`.
  - `syncFromUrl(true)` on `/` → view `home`.
  - (jsdom supports `history.pushState`/`replaceState` and `location.pathname`.)
- Existing `HomeScreen.test.tsx` and `Board.test.tsx` must stay green.

## Out of scope

- Router library adoption.
- Distinct in-game URL (`/game/:code`).
- Joining a room via a shared link.
- Resuming an intended room after logging in.
