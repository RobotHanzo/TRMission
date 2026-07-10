# Design: "Practice with bots" welcome-screen option

**Date:** 2026-07-10
**Status:** Approved (design), pending implementation plan

## Goal

Add a third option to the first-entry `WelcomeScreen` (shown only to brand-new accounts with 0
completed games): **"Practice with bots"**. Clicking it starts a game *immediately* — you plus one
EASY bot and one MEDIUM bot, on the default map with default rules — and drops the player straight
onto the game board, skipping the lobby.

The welcome screen currently has exactly two options: **Learn to play** (opens the tutorial) and
**Jump right in** (dismisses the welcome screen to reveal the homepage). The new option sits between
them.

## Decisions (locked with the user)

1. **Destination:** straight into the live game board (not the pre-filled lobby). "For playing
   immediately."
2. **Implementation:** a new *atomic* server endpoint (`POST /rooms/practice`), not a client-side
   chain of the existing endpoints. Rationale: one round-trip, no orphan room on partial failure,
   reusable and independently testable.

## Existing mechanics this builds on

- `WelcomeScreen` (`apps/web/src/screens/WelcomeScreen.tsx`) renders from `HomeScreen` when the
  signed-in account has no completed games as a player. Its actions today are plain navigations
  (`onStartTutorial`, `onContinue`).
- Starting a game with bots is already a sequence of discrete, host-only REST calls:
  `createRoom` -> `addBot(EASY)` -> `addBot(MEDIUM)` -> `setReady(true)` -> `startRoom` ->
  `connectGame` + `enterGame`.
- Server start rules (`LobbyService.start`, `apps/server/src/lobby/lobby.service.ts`): only the
  host, room status `LOBBY`, `>= 2` members, and **all members ready**. Bots are inserted with
  `ready: true`; the human host defaults to `ready: false`, so the host must be marked ready before
  a start can succeed.
- The client's game view needs `roomCode` set (via `enterRoom`) before `enterGame`: `GameScreen`'s
  roster fetch and reconnect ticket path (`api.getTicket(roomCode)` in
  `apps/web/src/net/connection.ts`) both depend on it. This mirrors `HomeScreen.watch()`, which
  calls `enterRoom(code)` then `enterGame(...)`.

## Server changes (`apps/server`)

### 1. `LobbyService.startPractice(user)` — `lobby.service.ts`

Composes the **existing** validated service methods so no game-start logic is duplicated:

```
assertNotDisabled(user.userId)                 // fail fast before creating anything
const { code } = await this.create(user)       // default maxPlayers (5)
await this.addBot(code, user, 'EASY')
await this.addBot(code, user, 'MEDIUM')
await this.ready(code, user, true)             // host must be ready for start()
const ticket = await this.start(code, user)    // { gameId, ticket }
return { ...ticket, code }                      // { gameId, ticket, code }
```

- Default `maxPlayers` and `DEFAULT_ROOM_SETTINGS` are used untouched -> "default rules" / default
  (official Taiwan) map.
- Returning `code` is required: the client needs it for the `/room/:code` URL and the reconnect
  ticket path.
- `start()` already calls `assertNotDisabled`; calling it again at the top of `startPractice` is a
  cheap defensive measure so a disabled account can't create an orphan room + bots before failing.

### 2. `POST /rooms/practice` — `lobby.controller.ts`

New route placed right after `create` (a literal path segment; there is no `POST /rooms/:code`
route, so no `:code` collision). `@HttpCode(200)`, `@CurrentUser()`, returns the practice-result
schema. OpenAPI annotated like its siblings.

### 3. Schema — `lobby.schemas.ts`

```
export const PracticeResultSchema = TicketResultSchema.extend({ code: z.string() });
```

Used in the controller's `@ApiResponse`.

## Client changes (`apps/web`)

### 4. `api.startPractice()` — `net/rest.ts`

```
startPractice: () => req<PracticeResult>('POST', '/rooms/practice'),
```
`PracticeResult = TicketResult & { code: string }`.

### 5. `WelcomeScreen` — `screens/WelcomeScreen.tsx`

- New prop `onPractice: () => Promise<void>`.
- New card using the `Bot` lucide icon, placed as the **middle** card (Learn -> Practice -> Jump in).
- Local `busy` / `error` state: unlike the other two options (plain navigations), this triggers an
  async API call that can fail, so the card disables its button + shows a spinner label while in
  flight and renders an inline error on rejection.

### 6. `HomeScreen` — `screens/HomeScreen.tsx`

Supplies `onPractice`, mirroring `watch()`'s navigation:

```
const tk = await api.startPractice();
connectGame(tk.ticket, { roomCode: tk.code });
enterRoom(tk.code);            // roomCode + /room/:code URL (GameScreen roster fetch needs it)
enterGame(tk.gameId, tk.ticket);
```

On success the UI view switches to `game` and `WelcomeScreen` unmounts; on failure the handler
re-throws so `WelcomeScreen` surfaces the error and re-enables its button.

### 7. i18n — `i18n/index.ts`

Add under `home.welcome`, in **both** zh-Hant (primary) and en:

- `practiceTitle`
- `practiceDesc` — names the lineup (1 easy + 1 medium bot, default rules)
- `practiceCta`
- `practiceError` — shown on a failed start

### 8. CSS — `styles/home.css`

Bump `.welcome-options` `max-width` (~720 -> ~1040px) so three cards fit comfortably on desktop.
The existing `@media (max-width: 700px)` rule already switches `.welcome-options` to
`flex-direction: column`, so mobile stacking needs no change.

## Tests

- **Server e2e** — `apps/server/test/lobby-practice.e2e.spec.ts` (mirroring
  `lobby-bots.e2e.spec.ts`): a single `POST /rooms/practice` as a guest host returns `code`,
  `gameId`, and `ticket`; the resulting room is `STARTED` with exactly 3 members = 1 human + two
  bots whose difficulties sorted are `['EASY','MEDIUM']`.
- **Web** — extend the `HomeScreen` / `WelcomeScreen` tests: the third option renders on the welcome
  screen, and clicking it calls `api.startPractice` then navigates into the game view.

## Out of scope

- Configurable bot difficulties or counts (fixed 1 EASY + 1 MEDIUM per spec).
- Surfacing "Practice with bots" anywhere beyond the welcome screen. (Noted to the user: the welcome
  screen disappears after the first finished game; a home-screen entry point could be added later if
  desired, but is not part of this work.)
- Any change to default rules or the default map.
