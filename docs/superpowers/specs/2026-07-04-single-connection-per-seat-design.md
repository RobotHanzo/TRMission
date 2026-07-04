# Single connection per seat — design

## Goal

A player can currently open the same room/game in two tabs (or two browsers/devices) at once.
Both sockets bind to the same seat in `GameHub.members`, but the map is overwritten, not merged
(`hub.ts:313`) — the older socket silently stops receiving broadcasts while staying open, able to
race in stale commands, with no signal to the user that anything happened.

Enforce one live connection per (room, seat): when a second `Hello` arrives for a seat that
already has a bound connection, terminate the older connection and show a blocking dialog on that
tab explaining it was disconnected because another connection took over. Scope is per room/seat
only — a player may still have two *different* rooms open in two tabs. Spectator connections
(seat `-1`) are unaffected; they already allow unlimited concurrent observers by design (a `Set`,
not a keyed map) and there's no gameplay-integrity reason to restrict them.

## Protocol change

Add one value to `RejectionCode` in `packages/proto/proto/trmission/v1/common.proto`, following
the existing low-range protocol-level codes (`UNAUTHENTICATED`, `BAD_SEQUENCE`, `MALFORMED`,
`NOT_IN_GAME`, `RATE_LIMITED`, `INTERNAL`):

```proto
REJECTION_CODE_SESSION_REPLACED = 7;
```

Regenerate via `yarn workspace @trm/proto generate` and thread the new value through wherever the
existing codes are enumerated 1:1 (`@trm/codec` enums, `@trm/shared` error taxonomy) per this
repo's standing convention for rejection codes. No new message type — this rides the existing
`Rejection` frame with a new `messageKey: 'errors:sessionReplaced'`, the same shape `evictMatch`
already uses for `errors:gameTerminated` (`hub.ts:167`).

## Server: forced-close capability

`Sink` (`connection.ts:9`) stays a pure one-way byte writer. `Connection` gains a second, optional
constructor argument and method:

```ts
export class Connection {
  constructor(
    readonly id: string,
    private readonly sink: Sink,
    private readonly closeFn?: (code: number, reason: string) => void,
  ) {}

  terminate(code: number, reason: string): void {
    this.closeFn?.(code, reason);
  }
}
```

`GameHub.openConnection` gains a matching optional third parameter, passed through to the
`Connection` constructor. `attachWsServer` (`ws-server.ts:17-19`) supplies the real close:

```ts
hub.openConnection(
  id,
  (bytes) => { if (socket.readyState === socket.OPEN) socket.send(bytes); },
  (code, reason) => socket.close(code, reason),
);
```

In-process test harnesses that call `hub.openConnection(id, sink)` directly (no real socket) keep
compiling and running unchanged — `closeFn` is optional, so `terminate()` is a no-op there.

## Server: kick-on-Hello logic

In `onHello` (`hub.ts:246-319`), immediately before the existing seat-binding line
(`this.members.get(binding.gameId)?.set(binding.playerId, conn)`, `hub.ts:313`), look up whatever
is currently bound to that seat:

```ts
const prev = this.members.get(binding.gameId)?.get(binding.playerId);
if (prev && prev !== conn) {
  prev.send(rejectionFrame(0, RejectionCode.SESSION_REPLACED, 'errors:sessionReplaced', 'connected elsewhere'));
  prev.terminate(4001, 'session_replaced');
}
```

`4001` is a dedicated custom WS close code (application range 4000–4999 per RFC 6455), used purely
as a "this was a deliberate session replacement" flag — the client never needs to parse the close
`reason` text as content.

Nothing else about `onHello` changes, and no changes are needed to `closeConnection` (`hub.ts:187-
197`): when `prev`'s transport-level `close` event fires asynchronously afterward, the existing
guard (`if (m?.get(player) === conn) m.delete(...)`) already no-ops correctly because `conn` (the
new one) has since replaced `prev` in `members`.

Spectator binding (`binding.seat < 0`, `hub.ts:274-296`) is untouched.

## Client: recognizing the forced close

`GameSocket.onclose` (`socket.ts:75-82`) currently ignores the `CloseEvent` entirely and always
schedules a reconnect unless the app itself already called `.close()`. It changes to inspect the
event:

```ts
ws.onclose = (ev: CloseEvent) => {
  this.stopHeartbeat();
  if (this.closed) return;
  if (ev.code === SESSION_REPLACED_CLOSE_CODE) {
    this.closed = true;
    this.handlers.onSessionReplaced?.();
    return;
  }
  this.handlers.onStatus?.('reconnecting');
  // ...existing backoff/reconnect
};
```

`SocketHandlers` gets a new optional `onSessionReplaced?(): void`. `net/connection.ts` wires it to
a new store action, e.g. `useGame.getState().setSessionReplaced(true)` — a separate boolean from
the existing transient `rejection` toast state (`RejectionInfo`), since that pipe stays reserved
for in-game action-rejected hints and shouldn't collide with a terminal, blocking condition.

## UI: the dialog

A new blocking modal, gated on the `sessionReplaced` store flag, rendered at the game-screen level
(alongside `GameStage`/`GameScreen`), copying the existing "kicked from room" dialog in
`RoomScreen.tsx` (`:425-442`) — same `modal-backdrop`/`modal` classes, `role="alertdialog"`,
`aria-modal`, non-dismissible except via its one button. New i18n keys (zh-Hant + en):
`sessionReplacedTitle`, `sessionReplacedBody`, `sessionReplacedAck`. The acknowledgement button
calls `disconnectGame()` (`net/connection.ts:35-38`) and navigates to the lobby/home view, the
same outcome as `RoomScreen`'s kicked-dialog `goHome`.

## Edge cases

- **Page refresh / same-tab reconnect**: the browser tears down the old physical socket on unload
  before or concurrently with the new `Hello` arriving, so the kick logic fires against an
  already-dying or already-gone connection — harmless; `prev.send`/`prev.terminate` on a closed
  socket is a safe no-op (`ws-server.ts`'s send already guards on `readyState`; `socket.close()` on
  an already-closed/closing socket is a no-op per the `ws` library).
- **Two tabs opening at nearly the same instant**: the hub processes `Hello`s serially (no
  concurrent mutation of `members`), so whichever is processed second deterministically kicks the
  first.
- **Spectators**: fully unaffected — the `spectators` `Set` path (`hub.ts:277-282`) is untouched,
  so unlimited concurrent observers remain allowed.
- **Bots**: bots are ordinary seated players driven server-side and don't go through the WS
  `Hello`/ticket path at all (per `apps/server/CLAUDE.md`), so this logic never applies to them.

## Implementation surface

- `packages/proto/proto/trmission/v1/common.proto` — new `RejectionCode` value; regenerate.
- Wherever `RejectionCode` is mirrored 1:1 (codec enums, `@trm/shared` error taxonomy).
- `apps/server/src/ws/connection.ts` — `Connection.terminate` + optional `closeFn` param.
- `apps/server/src/ws/ws-server.ts` — pass the real `socket.close` as `closeFn`.
- `apps/server/src/ws/hub.ts` — `GameHub.openConnection` optional third param; kick-on-`Hello`
  check in `onHello`.
- `apps/web/src/net/socket.ts` — `onclose` reads the close code; new `onSessionReplaced` handler;
  dedicated close-code constant shared between client and server (or duplicated with a comment
  tying them together, decided at plan time).
- `apps/web/src/net/connection.ts` — wire `onSessionReplaced` to the store.
- `apps/web/src/store/game.ts` — new `sessionReplaced` flag + setter.
- New dialog component/markup (wherever `GameScreen`/`GameStage` renders overlays) + i18n keys.
- **Tests:**
  - Server e2e: two real connections `Hello`ing for the same seat — the older one receives the
    `SESSION_REPLACED` rejection and its socket closes with code `4001`; the newer one keeps
    playing normally. A same-connection re-`Hello` (reconnect scenario) does *not* kick itself.
  - Client: `GameSocket` test — a close with code `4001` triggers `onSessionReplaced` and does not
    schedule a reconnect; any other close code still reconnects as before.
  - Web component test — the dialog renders when the store flag is set, and its button navigates
    home.

## Out of scope

- No change to cross-room behavior — a player may still hold two different rooms open in two
  tabs simultaneously.
- No change to spectator connection limits.
- No visual redesign of the existing `.modal*` family — the new dialog reuses it as-is.

## Success criteria

- Opening the same room/seat in a second tab (or device) terminates the first tab's connection.
- The terminated tab shows a blocking "disconnected elsewhere" dialog; acknowledging it returns to
  the lobby/home.
- The new, surviving connection plays normally with no interruption.
- A normal page refresh/reconnect for the *same* tab does not trigger the dialog.
- Opening two different rooms in two different tabs is unaffected.
- `yarn workspace @trm/server test`, `yarn workspace @trm/web test`, `yarn lint`, and `yarn
  typecheck` pass.
