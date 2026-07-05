# Link-only room spectating — design

## Problem

A non-member who arrives at a `STARTED` room — whether by pasting the room code into the
home-page join box, or by opening a shared `/room/:code` link directly — currently always
dead-ends, regardless of whether the room allows spectating:

- **Home-page join box** (`HomeScreen.tsx` `join()`): unconditionally calls `api.joinRoom(code)`.
  For a started room this rejects with the server's literal `'game already started'` string,
  which is surfaced verbatim as the error.
- **Direct room link** (`RoomScreen.tsx` poll effect): if the viewer isn't a member and
  `room.status !== 'LOBBY'`, it calls `goHome()` unconditionally — no attempt to spectate, no
  message.

Spectating today only works through the public-rooms list's "Watch" button on the home screen,
and `RoomRepo.findPublic()` only ever returns `visibility: 'PUBLIC'` rooms. So an `INVITE_ONLY`
("link-only") room can never be spectated through its own code or link, even when its host has
`allowSpectating` turned on — the only two ways of reaching it both hit the dead ends above.

## Goal

Both entry points should fall through to spectating when the room is `STARTED`, the viewer isn't
seated, and `settings.allowSpectating` is true — regardless of whether the room's visibility is
`PUBLIC` or `INVITE_ONLY`. This is a pure client-side fix: the `POST /rooms/:code/spectate`
endpoint already exists and already enforces the `allowSpectating` gate server-side
(`LobbyService.spectateTicket`); nothing on the server changes.

When spectating is turned **off** for a started room, behavior for a non-member is unchanged:
silently redirect home (confirmed with the user — no new inline messaging for that case).

## Approach

### 1. `apps/web/src/screens/RoomScreen.tsx` (direct-link path)

In the poll effect, where a non-member currently hits:

```ts
if (r.status !== 'LOBBY') {
  active = false;
  goHome();
  return;
}
```

Branch on spectating before bailing:

```ts
if (r.status !== 'LOBBY') {
  if (r.status === 'STARTED' && r.gameId && r.settings.allowSpectating) {
    const tk = await api.spectate(code);
    if (!active) return;
    connectGame(tk.ticket);
    enterGame(tk.gameId, tk.ticket);
    return;
  }
  active = false;
  goHome();
  return;
}
```

This mirrors the existing member-reconnect branch further down (`api.getTicket` +
`connectGame`/`enterGame`), just sourcing the ticket from `api.spectate` instead. No change to
the `active`/polling bookkeeping pattern already used elsewhere in this effect. A thrown
`ApiError` (e.g. a race where spectating flips off between fetch and call) falls through to the
existing catch block, which already bounces home on 400/403/404.

### 2. `apps/web/src/screens/HomeScreen.tsx` (code-box path)

`join()` currently:

```ts
const join = async () => {
  setBusy(true);
  setErr(null);
  try {
    enterRoom((await api.joinRoom(code.trim().toUpperCase())).code);
  } catch (e) {
    setErr((e as Error).message);
  } finally {
    setBusy(false);
  }
};
```

Change to check the room's status first, so a started+spectatable room routes to spectating
instead of attempting (and failing) a join:

```ts
const join = async () => {
  setBusy(true);
  setErr(null);
  try {
    const target = code.trim().toUpperCase();
    const r = await api.getRoom(target);
    if (r.status === 'STARTED' && r.settings.allowSpectating) {
      const tk = await api.spectate(target);
      connectGame(tk.ticket);
      enterGame(tk.gameId, tk.ticket);
    } else {
      enterRoom((await api.joinRoom(target)).code);
    }
  } catch (e) {
    setErr((e as Error).message);
  } finally {
    setBusy(false);
  }
};
```

This mirrors the existing `watch()` handler already on this screen (used by the public-rooms
list's "Watch" button): no URL push, straight into the spectator game view. A `LOBBY` room (or a
`STARTED` room with spectating off) falls through to today's `joinRoom` + `enterRoom` flow and
today's error surfacing, unchanged.

## Non-goals

- No server changes — the `allowSpectating` gate on `POST /rooms/:code/spectate` is untouched.
- No change to the silent-redirect-home behavior when spectating is disabled.
- Not fixing the un-localized raw server error strings (e.g. `'game already started'`) surfaced
  verbatim by `ApiError` — a pre-existing, separate i18n gap outside this fix's scope.
- No change to the member-reconnect path, the public-rooms list, or the `spectate` REST endpoint
  itself.

## Tests to update

- `apps/web/src/screens/RoomScreen.test.tsx`: the existing case "does not try to join a game
  already in progress that it is not part of" asserts a bare bounce-home for a non-member on a
  `STARTED` room — give it an explicit `allowSpectating: false` room to keep asserting that.
  Add a new case with `allowSpectating: true` asserting `api.spectate` is called and the screen
  ends up in the game view (`connectGame`/`enterGame`).
- `apps/web/src/screens/HomeScreen.test.tsx`: add a case for the code-box join path where
  `getRoom` resolves a `STARTED` + `allowSpectating: true` room, asserting `api.spectate` is
  called instead of `api.joinRoom`.
