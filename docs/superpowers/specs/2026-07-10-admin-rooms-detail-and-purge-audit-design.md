# Admin panel: room detail drawer + auto-purge no-op audit skip

Date: 2026-07-10
Area: `apps/server/src/dashboard`, `apps/admin`

Two independent revisions to the maintainer dashboard:

1. **Auto-purge no-op audit skip** — a background purge sweep that deletes nothing must not
   write a `purge.run` audit entry.
2. **Room detail drawer** — clicking a room row opens a detail drawer, the same interaction the
   Games view already has, populated with adequate room details.

---

## Part 1 — Auto-purge no-op audit skip

### Current behaviour

`PurgeService.runSweep(trigger, actor?)` ([`purge.service.ts`](../../../apps/server/src/dashboard/purge.service.ts))
always appends a `purge.run` audit entry at the end of a sweep, regardless of how many
rooms/games were deleted:

```ts
if (trigger === 'auto') {
  await this.audit.logSystem('purge.run', undefined, params);
} else {
  await this.audit.log(actor!, 'purge.run', undefined, params);
}
```

The auto sweep runs on a timer (`env.purgeIntervalMs`), so an idle deployment writes a stream of
0-rooms / 0-games audit entries. Those also surface in the Purge view's "recent runs" table,
which `PurgeService.status()` builds from the last 10 `purge.run` entries.

### Change

Skip the audit write for an **auto** sweep when it deleted nothing. Manual runs always log
(recording that an operator triggered a sweep, even a no-op — the operator sees the 0/0 result
directly from the endpoint response either way).

```ts
if (trigger === 'auto') {
  if (summary.roomsDeleted > 0 || summary.gamesDeleted > 0) {
    await this.audit.logSystem('purge.run', undefined, params);
  }
} else {
  await this.audit.log(actor!, 'purge.run', undefined, params);
}
```

`summary` already holds `roomsDeleted` / `gamesDeleted`; the guard reuses it. No other method
changes. `status().recentRuns` naturally stops showing empty auto sweeps.

### Tests

`apps/server/test/purge-scheduler.spec.ts` (unit-level, calls the service directly):

- `runSweep('auto')` against an empty DB writes **no** `purge.run` audit doc.
- `runSweep('manual', actor)` against an empty DB writes **exactly one** `purge.run` audit doc.
- A non-empty auto sweep still writes one (guard against over-suppression).

The existing `dashboard-purge.e2e.spec.ts` "exactly one `purge.run` audit entry" case deletes
2 rooms + 1 game, so it stays green unchanged.

---

## Part 2 — Room detail drawer

### Goal

Bring `RoomsView` to parity with `GamesView`: a room row is clickable and opens a `Drawer` that
fetches its own detail on mount. Inline Close/Delete buttons stay in the row (per decision), with
click-through suppressed, and are mirrored inside the drawer.

### Hidden-information rule

A room's `seed` (set once the room is `STARTED`) encodes deck order = every hidden hand, exactly
like a game's seed. The room detail **never** includes `seed` — the same rule the game detail
applies to a LIVE game's seed. Lobby preset-chat is also excluded (low value, keeps scope tight).

### Server

New endpoint on `DashboardGamesController`:

```
GET /api/v1/dashboard/rooms/:code    @RequirePermission('rooms.read')  -> DashboardRoomDetailSchema
```

backed by `DashboardGamesService.roomDetail(code)`, modelled on `gameDetail`:

- `this.rooms.get(code)` → 404 if missing.
- If `room.gameId` is set, one projected `games.findOne({ _id: gameId }, { projection: { status: 1 } })`
  to surface the linked game's current status.
- Host display name: read from the matching member entry (members already carry `displayName`);
  fall back to `hostId` when the host is no longer a member.

`RoomDetail` shape (all fields non-secret):

```ts
{
  code: string;
  hostId: string;
  hostName?: string;
  status: string;                         // LOBBY | STARTED | CLOSED
  visibility: string;                     // PUBLIC | INVITE_ONLY
  maxPlayers: number;
  createdAt: string;
  updatedAt: string;
  gameId?: string;
  gameStatus?: string;                    // linked game's status, if any
  members: {
    userId: string;
    displayName: string;
    seat: number;
    isBot: boolean;
    isGuest: boolean;
    ready: boolean;
    difficulty?: string;
  }[];
  spectators: { userId: string; displayName: string }[];
  settings: {
    map: { source: 'official' | 'custom'; id: string };  // mapId | customMapId
    allowSpectating: boolean;
    eventsMode: string;
    unlimitedStationBorrow: boolean;
    secondDrawAfterBlindRainbow: boolean;
    noUnfinishedTicketPenalty: boolean;
    doubleRouteSingleFor23: boolean;
  };
}
```

Zod `DashboardRoomDetailSchema` added to `dashboard.schemas.ts`; wired to the endpoint via
`apiSchema(...)` like the game detail.

### Client

- **`store/ui.ts`** — add `'rooms'` to the `openDetail` param type union and the `closeDetail`
  view guard (currently `'users' | 'games' | 'maps'`). `parsePath` already accepts a `rooms/:param`
  segment, so refresh/share reopens the drawer with no router change.
- **`net/rest.ts`** — add the `RoomDetail` interface and `getRoom: (code) => req<RoomDetail>('GET', ...)`.
- **`RoomsView.tsx`**:
  - Import `openDetail`/`closeDetail`/`param` from `useUi` (same as GamesView).
  - Rows get `className="clickable"` and `onClick={() => openDetail('rooms', r.code)}`.
  - Inline Close/Delete `onClick` handlers call `e.stopPropagation()` before `setClosing`/`setDeleting`.
  - New `RoomDrawer({ code, row, onClose, onRequestClose, onRequestDelete })`:
    - Fetches `api.getRoom(code)` on mount; renders sections: identity/status, linked game,
      members table, spectators, settings.
    - Reads live status from the passed-in `row` (so a close reflects immediately without refetch).
    - Its Close/Delete buttons call the parent's `setClosing`/`setDeleting` (via `onRequestClose`/
      `onRequestDelete`) so there is one implementation of the confirm + action flow.
    - Gated by `rooms.close` / `rooms.delete` and `row.status`, same as the inline buttons.
  - `del(code)` additionally calls `closeDetail()` when the deleted code is the open `param`.
  - Render `{param && <RoomDrawer .../>}` after the table, like GamesView.
- **i18n** (`i18n/index.ts`) — new `rooms.*` keys in **both** zh-Hant and en:
  detail title, host, members, seat, ready/not-ready, bot, guest, spectators, linked game,
  game status, settings, map (official/custom), allow spectating, events mode, and the four
  rule-variant flag labels, created/updated. Reuse `common.yes`/`common.no` for booleans where
  they exist.

### Tests

- **Server** (`dashboard-games.e2e.spec.ts`, rooms section): `GET /dashboard/rooms/:code` returns
  the detail fields, **omits `seed`**, 404s an unknown code, and 403s a caller without `rooms.read`.
- **Client** (`RoomsView.test.tsx`): clicking a row opens the drawer and renders detail (stub the
  `/dashboard/rooms/:code` detail route; mind that `stubFetch` matches by `url.includes` so the
  detail path must be registered so it doesn't collide with `/rooms/:code/close`). The existing
  inline close/delete tests stay green (stopPropagation means the inline click never opens the
  drawer).

### Scope guard

No changes to purge thresholds, the lobby service, room mutation logic, or the game detail. Room
`seed` and lobby preset-chat are intentionally excluded from the room detail.
