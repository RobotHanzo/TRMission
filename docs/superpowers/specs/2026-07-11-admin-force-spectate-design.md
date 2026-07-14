# Admin dashboard: force-spectate a live game

## Problem

Maintainers can already review a **finished** game via the dashboard's "View Replay" action (mints
a short-lived ticket, opens a ticket-only route in `apps/web` that replays the action log locally).
There is no equivalent for a game that is still **LIVE** — a maintainer who needs to observe an
in-progress game (dispute review, anti-cheat, support) has no way in, and a room's
`allowSpectating` setting (default `true`, host-configurable to `false`) can block even a
would-be legitimate spectator. This feature lets a permitted maintainer force their way into a
LIVE game as a spectator from the dashboard, regardless of `allowSpectating`.

## Why this is simpler than replay, not harder

A finished game has no live state to stream, so replay is a REST-only fetch of the historical
action log, replayed locally by the engine in the browser. A LIVE game already has a real-time
channel: the same ws-game-ticket + WebSocket path every real spectator uses
(`POST /rooms/:code/spectate` → `TokenService.signWsTicket({gameId, playerId, seat: -1})` →
`ClientHello` → `GameHub.onHello`'s `binding.seat < 0` branch → `redactFor(state, null)`
projection, `apps/server/src/ws/hub.ts:287-337`). "Force spectate" only needs a way to mint that
same kind of ticket while skipping the eligibility checks `LobbyService.spectateTicket`
(`apps/server/src/lobby/lobby.service.ts:411-429`) enforces (`allowSpectating`, not-already-seated,
account not disabled). **No change to the hub, the WebSocket protocol, or the redaction path is
needed at all** — this is the smallest possible surface for the capability.

## Non-goals

- No visible indicator to players/room members that a maintainer is watching. The admin viewer
  joins the same `spectators` set exactly like a real spectator (already silent today — no join
  announcement exists for any spectator). This is a deliberate scope cut, not an oversight: adding
  a "staff is observing" signal would be new player-facing UI, out of scope for this feature.
- No reconnect/re-mint path if the admin's socket drops after the ws ticket's short TTL expires.
  The admin re-opens a fresh Spectate link from the dashboard. (A roomCode-less viewer has the same
  limitation today — `GameScreen`'s reconnect effect can only re-mint via a room code it doesn't
  have here.)
- No new dashboard listing/filtering for "who has spectated live games" beyond what the existing
  audit log (`dashboardAudit`) and `game.spectators` array already provide.

## Server changes

### 1. New permission

`packages/shared/src/dashboard.ts`: add `'games.spectateLive'` to `DASHBOARD_PERMISSIONS` and to
`VIEWER_PERMISSIONS` (the same tier as `games.viewReplay`). Live-spectating is arguably
_lower_-sensitivity than replay: the spectator only ever receives a null-viewer redacted
projection (no hand, no tickets, ever), whereas a replay eventually discloses everything about a
finished game.

### 2. Mint endpoint

`apps/server/src/dashboard/dashboard-games.service.ts`: new method

```
mintSpectateTicket(actor: AuthUser, gameId: string): Promise<{ ticket: string; expiresIn: string }>
```

- 404 (`NotFoundException`) if the game doesn't exist.
- 409 (`ConflictException`) unless `game.status === 'LIVE'`.
- Audits `game.spectateLive` (`{ type: 'game', id: gameId }`) via `AuditService`, same shape as
  `mintReplayTicket`'s audit call.
- Returns `{ ticket: this.tokens.signWsTicket({ gameId, playerId: actor.userId, seat: -1 }),
expiresIn: env.wsTicketTtl }` — the _existing_ ws-game ticket, minted with the maintainer's own
  account id as the spectating `playerId`. No new ticket kind, no change to `TokenService` or the
  hub's ticket verifier.

`apps/server/src/dashboard/dashboard-games.controller.ts`: new route

```
POST /dashboard/games/:gameId/spectate-ticket
@RequirePermission('games.spectateLive')
```

mirroring the existing `replay-ticket` route's shape.

### 3. Roster endpoint

Display names never travel over the WS wire in this app (snapshots carry player ids only); every
screen fetches them separately. The ticket-only web screen has no dashboard session and no room
code to call the normal `GET /rooms/:code` route, so it needs its own ticket-authorized roster
fetch, parallel to how `/history/:gameId/admin-replay` serves `AdminReplayScreen`.

New `apps/server/src/history/admin-spectate.controller.ts` + `admin-spectate.guard.ts`:

```
GET /history/:gameId/admin-spectate?ticket=...
```

- Guard: `TokenService.verifyWsTicket(ticket)` must succeed, and the payload must satisfy
  `payload.gameId === params.gameId && payload.seat === -1`. Any failure → nondisclosing 404 (same
  posture as `AdminReplayTicketGuard`). No `AccessTokenGuard` — the ticket is the sole authority,
  exactly like the replay route.
- Handler returns `{ players: [{ id, seat, displayName?, isBot?, difficulty? }] }`, built the same
  way `DashboardGamesService.gameDetail` builds its `players` array (`game.config.players` +
  `HistoryRepo.displayNames` + `game.bots`) — no action log, no config, no seed: the live WS
  snapshot already carries all game state, this endpoint exists solely to resolve names.

Note this guard accepts _any_ valid spectator ws-game ticket for the matching game, not only ones
minted by the dashboard flow — that's fine: a normal spectator's own ticket would equally satisfy
`seat === -1`, and player display names are not hidden information.

## `apps/admin` changes

`GamesView.tsx`: a "Spectate" button next to "View Replay," visible when `status === 'LIVE'` and
the viewer holds `games.spectateLive` (mirrors the existing `canViewReplay &&
status COMPLETED|TERMINATED` gate). On click: `api.mintSpectateTicket(gameId)` →
`window.open(`${webOrigin()}/admin-spectate/:gameId?ticket=...`)`, identical pattern to `viewReplay`.
A 409 (game no longer LIVE, e.g. it just ended) surfaces as a toast the same way the replay
mint's errors do today.

## `apps/web` changes

### Routing (`store/ui.ts`)

- New `View` member `'adminSpectate'`.
- `ADMIN_SPECTATE_PATH = /^\/admin-spectate\/([^/]+)$/` and `adminSpectateFromPath()`, parsing
  `{ id, ticket }` from the URL — parity with `adminReplayFromPath`.
- New state fields `adminSpectateGameId` / `adminSpectateTicket`.
- Wired into `syncFromUrl` right alongside the existing `adminReplay` branch: **never auth-gated**,
  reachable from a fresh tab with no prior session, `disconnectGame()` first like every other
  routing branch.

### `screens/AdminSpectateScreen.tsx` (new)

Parallels `AdminReplayScreen.tsx`'s shape but drives a live connection instead of a local replay:

1. Reads `adminSpectateGameId` / `adminSpectateTicket` from the ui store; if either is missing,
   shows the same `history.loadFailed` error card the replay screen uses for that case.
2. Fetches `GET /history/:gameId/admin-spectate?ticket=` and calls `setMembers` on the roster store
   with the returned players — same idiom as `AdminReplayScreen`'s roster effect — so the board,
   trackers, and scoreboard show real names/bot badges instead of `P{seat+1}`.
3. Calls `connectGame(ticket)` directly (no `roomCode` argument — there is no room-based reconnect
   path here, see Non-goals).
4. Renders `GameStage` with `snapshot` from the game store and `commands={getSocket()}`, omitting
   `isHost` / `rematchMembers` / `onVoteRematch` / `onPlayAgain` (all optional on `GameStageProps`,
   same as the tutorial/replay/sandbox contexts today).
5. `onLeave`: calls `disconnectGame()` and swaps to a small local "you stopped spectating" notice —
   it must **not** call the app's normal `goHome()`/home-view navigation, since this route may be
   opened with no authenticated session at all and the home view assumes one.

### `App.tsx`

Add the `'adminSpectate'` branch to the view switch (renders `AdminSpectateScreen`), alongside the
existing `'adminReplay'` branch. Include it in the `isGameLike` background/layout check next to
`'game'`/`'adminReplay'` if that check currently covers `'adminReplay'` (it does, per
`App.tsx:88-92`) — a live board should get the same layout treatment a replay board does.

## Data flow (end to end)

```
Maintainer (dashboard session, games.spectateLive)
  → POST /dashboard/games/:gameId/spectate-ticket
  → { ticket }
  → window.open(web:/admin-spectate/:gameId?ticket=...)        [new tab, no auth]
  → GET /history/:gameId/admin-spectate?ticket=...  → { players }   [seeds roster]
  → WebSocket ClientHello with the SAME ticket        [unchanged hub path]
  → GameHub.onHello: binding.seat === -1 branch, redactFor(state, null)
  → live snapshots stream in exactly as to a real spectator
```

## Error handling

| Condition                                         | Behavior                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Game not LIVE at mint time                        | 409 from `mintSpectateTicket`, toast in `GamesView`                               |
| Game unknown                                      | 404 from `mintSpectateTicket`                                                     |
| Game ends while admin is watching                 | Normal game-over frames fire; no special-casing (identical to any real spectator) |
| Expired/invalid ticket at `ClientHello`           | Existing `UNAUTHENTICATED` rejection path, unchanged                              |
| Expired/invalid/mismatched ticket at roster fetch | Nondisclosing 404 from the new guard                                              |
| Socket drop after ws-ticket TTL                   | No re-mint from this screen; admin opens a fresh link                             |

## Testing

- **Server**: unit tests for `mintSpectateTicket` (404 unknown game, 409 non-LIVE, permission
  enforcement, audit entry written); guard tests for the roster endpoint (bad signature, wrong
  `gameId`, `seat !== -1` all → 404); an e2e that a room with `allowSpectating: false` is still
  joinable end-to-end via a dashboard-minted ticket (mint → `ClientHello` → receives a projected
  snapshot).
- **Web**: a routing test for `adminSpectateFromPath` + its `syncFromUrl` branch (parity with the
  existing adminReplay routing test); an `AdminSpectateScreen` test mocking the roster fetch and
  socket connect, asserting `setMembers` is called and `GameStage` renders with the live snapshot.

## Self-review notes

- Scope is a single cohesive slice (one permission, one mint endpoint, one roster endpoint, one web
  route/screen) — not decomposed further.
- No TBDs: ticket claims, permission tier, endpoint shapes, and screen behavior are all pinned to
  concrete existing mechanisms (`TokenService.signWsTicket`/`verifyWsTicket`, the `viewer` role
  tier, `AdminReplayScreen`'s roster idiom).
- Internal consistency checked: the mint endpoint never touches `LobbyService`/`allowSpectating` at
  all (bypass is structural, not a flag check), and the roster guard's permissiveness (any valid
  spectator ticket, not dashboard-exclusive) is called out explicitly since it's the one place a
  reader might expect stricter gating and there isn't any needed.
