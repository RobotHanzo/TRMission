# Room rematch ("Play Again") — design

## Goal

Rooms and games are separate entities, but today a room can never play a second game: once the
host starts (`RoomRepo.markStarted`), `RoomDoc.status` goes `LOBBY → STARTED` and there is no path
back. When the underlying game reaches `GAME_OVER`, `hub.ts`'s `applyPrepared` marks the `games`
doc `COMPLETED` via `store.recordCompletion` but never touches the room — the room is left
permanently `STARTED`, pointing at a finished game, with no way for the same table to start a new
one without creating a brand-new room and re-sharing the code.

Add a **rematch** flow: at game-over, any seated player can cast an advisory "I want to play
again" vote; the host sees the tally but is not gated by it, and a host-only **Play Again** action
resets the room back to `LOBBY` (same members, same host, same settings, ready flags cleared) so
the table can immediately re-ready and start a new game under the same room code. Everyone else is
carried back into the room automatically, the same way starting a game already carries everyone
from the room into it.

## Backend

### Data model (`apps/server/src/lobby/room.repo.ts`)

`RoomMember` gains one optional field:

```ts
export interface RoomMember {
  userId: string;
  displayName: string;
  isGuest: boolean;
  seat: number;
  ready: boolean;
  isBot?: boolean;
  difficulty?: BotDifficulty;
  /** Advisory "I want to play again" vote, meaningful only while status === 'STARTED'.
   *  Cleared (false) whenever a game starts or a rematch resets the room. */
  wantsRematch?: boolean;
}
```

No change to `RoomDoc` itself — `gameId`/`seed` are simply `$unset` on rematch, same fields
`markStarted` already sets.

### `RoomRepo` — two new methods

```ts
/** Any seated member (host or not) records their rematch preference. Bots can't call this —
 *  there's no bot auth — so their wantsRematch stays whatever it was set to (never, in practice). */
async setRematchVote(code: string, userId: string, vote: boolean): Promise<RoomDoc | 'not_found' | 'not_member'> {
  const room = await this.col.findOne({ _id: code });
  if (!room) return 'not_found';
  if (!room.members.some((m) => m.userId === userId)) return 'not_member';
  await this.col.updateOne(
    { _id: code, 'members.userId': userId },
    { $set: { 'members.$.wantsRematch': vote, updatedAt: new Date() } },
  );
  return (await this.col.findOne({ _id: code })) ?? 'not_found';
}

/** Host-only: flip a finished room back to LOBBY. CAS on the exact gameId being rematched so a
 *  stale/duplicate call (double-click, or a call racing a second rematch) is a clean no-op rather
 *  than clobbering a room that's already moved on. Mirrors markStarted's CAS shape. */
async resetToLobby(code: string, hostId: string, expectedGameId: string): Promise<boolean> {
  const room = await this.col.findOne({ _id: code });
  if (!room) return false;
  const members = room.members.map((m) => ({
    ...m,
    ready: m.isBot ? true : false,
    wantsRematch: false,
  }));
  const res = await this.col.updateOne(
    { _id: code, hostId, status: 'STARTED', gameId: expectedGameId },
    { $set: { status: 'LOBBY', members, updatedAt: new Date() }, $unset: { gameId: '', seed: '' } },
  );
  return res.modifiedCount === 1;
}
```

### `LobbyService`

```ts
async voteRematch(code: string, user: AuthUser, vote: boolean): Promise<RoomView> {
  const r = await this.rooms.setRematchVote(code, user.userId, vote);
  if (r === 'not_found') throw new NotFoundException('room not found');
  if (r === 'not_member') throw new ForbiddenException('not a member of this room');
  return toView(r);
}

/** Host-only: reset a finished game's room back to LOBBY for another round. */
async rematch(code: string, user: AuthUser): Promise<RoomView> {
  const room = await this.require(code);
  if (room.hostId !== user.userId) throw new ForbiddenException('only the host can rematch');
  if (room.status !== 'STARTED' || !room.gameId) throw new BadRequestException('no game to rematch');
  if (!(await this.hub.isGameOver(room.gameId))) {
    throw new BadRequestException('game is still in progress');
  }
  if (!(await this.rooms.resetToLobby(code, user.userId, room.gameId))) {
    throw new BadRequestException('could not rematch (already rematched?)');
  }
  return this.get(code);
}
```

`isGameOver` is a new `GameHub` method — the server never trusts the client to only call
`rematch` at the right time, so this must be checked authoritatively, not inferred from the fact
that the button only renders at `GAME_OVER` client-side:

```ts
// apps/server/src/ws/hub.ts
async isGameOver(gameId: string): Promise<boolean> {
  const match = this.registry.get(gameId);
  if (match) return match.session.phase === 'GAME_OVER';
  // Not in the in-memory registry (e.g. a deploy/restart happened between game-over and the
  // rematch click) — fall back to the durable status recordCompletion already wrote.
  const status = await this.store?.getStatus(gameId);
  return status === 'COMPLETED';
}
```

This needs one new one-line method on `GameStorePort` / `MongoGameStore`:
`getStatus(gameId): Promise<GameDoc['status'] | undefined>` (a plain `findOne` with a `status`
projection, same style as the existing `games` collection reads in `history.repo.ts`).

### Endpoints (`lobby.controller.ts`, `lobby.schemas.ts`)

```ts
export const RematchVoteSchema = z.object({ wantsRematch: z.boolean() });
export class RematchVoteDto extends createZodDto(RematchVoteSchema) {}
```

- `POST /rooms/:code/rematch-vote` `{ wantsRematch }` → `LobbyService.voteRematch` → `RoomView`
- `POST /rooms/:code/rematch` (no body) → `LobbyService.rematch` → `RoomView`

Same `AccessTokenGuard`, same `@HttpCode(200)` + `RoomViewSchema` response shape as `ready`/`start`.

`RoomMemberSchema` gains `wantsRematch: z.boolean().optional()`.

## Frontend

### `net/rest.ts`

```ts
export interface RoomMember {
  // ...existing fields
  wantsRematch?: boolean;
}
// ...
voteRematch: (code: string, wantsRematch: boolean) =>
  req<RoomView>('POST', `/rooms/${code}/rematch-vote`, { wantsRematch }),
rematch: (code: string) => req<RoomView>('POST', `/rooms/${code}/rematch`),
```

### `GameScreen.tsx` — polling the room during game-over

Today `GameScreen` fetches the room's members exactly once (for display names). It now also polls
while the game is over, reusing the exact interval-poll shape `RoomScreen` already uses for the
lobby:

```ts
const enterRoom = useUi((s) => s.enterRoom);
const phase = snapshot?.turn.phase;

useEffect(() => {
  if (!roomCode || phase !== Phase.GAME_OVER || !snapshot?.you) return; // spectators excluded
  let active = true;
  const poll = async () => {
    try {
      const r = await api.getRoom(roomCode);
      if (!active) return;
      if (r.status === 'LOBBY') {
        active = false;
        enterRoom(roomCode); // carries this client back into the reset room, same as `start`
        // carries everyone else back the same way
        return;
      }
      setRoster(r.members); // keeps the vote tally + host id fresh on the ScoreBoard
    } catch {
      // transient — next tick retries; this is a convenience poll, not a critical path
    }
  };
  void poll();
  const id = setInterval(() => {
    if (!active) return clearInterval(id);
    void poll();
  }, 2000);
  return () => {
    active = false;
    clearInterval(id);
  };
}, [roomCode, phase, snapshot?.you, enterRoom, setRoster]);
```

Excluding spectators (`!snapshot?.you`) here is what stops a spectator from ever being silently
carried into the reset lobby — `RoomScreen`'s poll would otherwise auto-join any non-member
landing on a `LOBBY` room, which is correct for a shared invite link but wrong for someone who was
only ever watching.

This poll only ever _reads_, and only ever navigates on the one `LOBBY` transition — it can't loop
with `RoomScreen`'s own poll (which only auto-enters the game on `STARTED`+`gameId`), since by
construction this effect never fires `enterRoom` until the room has already left `STARTED`.

### `ScoreBoard.tsx` — vote + host action

New props, all optional so sandbox/tutorial/replay callers can omit them entirely (see Out of
scope):

```ts
export function ScoreBoard({
  snapshot,
  onLeave,
  isHost,
  members,        // RoomMember[] from the roster store — used for the vote tally
  onVote,         // (wantsRematch: boolean) => void
  onPlayAgain,    // () => void — host only
}: {
  snapshot: GameSnapshot;
  onLeave(): void;
  isHost?: boolean;
  members?: RoomMember[];
  onVote?(wantsRematch: boolean): void;
  onPlayAgain?(): void;
}) { ... }
```

`GameStage` threads these through unchanged from `GameScreen` (`sandbox`/tutorial/replay callers
simply don't pass them). The whole vote/rematch block in `scoreboard-actions` renders only when
`onVote`/`onPlayAgain` are present — otherwise it's exactly today's leave-only footer. In the
live-game case:

- Every human, non-spectator viewer sees a toggle button, "🔁 {{t('wantRematch')}}", whose pressed
  state reflects their own `members[you].wantsRematch`, calling `onVote(!current)`.
- Everyone sees a muted tally computed client-side from `members` excluding bots: `t('rematchTally', { count, total })` → "2/3 want a rematch".
- The host additionally sees a **Play Again** button (`onPlayAgain`) — not disabled by the tally;
  the host's call is final regardless of the vote count, matching the "host makes the final call"
  requirement.

`onVote` calls `api.voteRematch(code, vote)` then `setRoster(result.members)`. `onPlayAgain` calls
`api.rematch(code)` then `enterRoom(code)` immediately — the host doesn't wait for its own next
poll tick to land back in the room.

## Edge cases

- **Host leaves without rematching**: the room stays `STARTED` pointing at the finished game,
  exactly like today's (pre-existing, unfixed) behavior — except now it's escapable: revisiting the
  room code/link reconnects to the finished game (the match is still in the in-memory registry) and
  re-shows the `ScoreBoard`, from which `rematch` can still be called. No change needed to
  `findActiveByMember` for this to work.
- **Dashboard game→room backlink**: `RoomDoc` only ever remembers its _current_ `gameId`, so once a
  room rematches, `RoomRepo.findByGameId(oldGameId)` stops resolving for that earlier game —
  `DashboardGamesService.gameDetail`'s `roomCode` field silently disappears for it. The game itself
  stays fully viewable via history/replay; only the "which room was this played from" convenience
  link is lost. Not fixed here (would need a rooms↔games join collection) — flagging in case it
  matters for moderation workflows.
- **Members who never come back**: `wantsRematch`/`ready` reset on rematch, but the members array
  itself is untouched — someone who left for good still occupies a seat until the host kicks them,
  same as the existing lobby (no presence tracking exists to distinguish "away" from "here").
- **Double rematch race**: two rapid `rematch` calls (e.g. accidental double-click) — the second's
  CAS in `resetToLobby` fails to match (`status` is no longer `STARTED`) and `LobbyService.rematch`
  surfaces `BadRequestException('could not rematch (already rematched?)')`, same pattern as
  `start`'s `markStarted` race handling.
- **Server restart between game-over and rematch**: covered by `GameHub.isGameOver`'s DB fallback —
  without it, a restart would make `rematch` permanently unreachable (registry empty) even though
  the game genuinely finished.

## Out of scope

- No change to `tutorial` / `replay` / sandbox `GameStage` callers — the new `ScoreBoard` props are
  optional (see above), so these call sites are simply left passing none of them.
- No rooms↔games history join table (see Edge cases).
- No change to how `leave`/`kick` behave on a `STARTED` room.
- No presence/online tracking.

## Testing plan

**Server** (`apps/server`):

- `RoomRepo.resetToLobby` — happy path clears `gameId`/`seed`, resets `ready`/`wantsRematch`, keeps
  bots ready; CAS fails on wrong host / wrong gameId / already-LOBBY (double call).
- `RoomRepo.setRematchVote` — sets the right member, `not_found`/`not_member` cases.
- `LobbyService.rematch` — 403 non-host, 400 when not STARTED, 400 when `hub.isGameOver` is false,
  success path returns a `LOBBY` `RoomView` with `gameId` absent.
- `GameHub.isGameOver` — true via registry `GAME_OVER`, true via store fallback when not in
  registry, false for a LIVE game.
- e2e: play a bot game to completion, call rematch, `start` again on the same room code succeeds
  with a fresh `gameId`.

**Web** (`apps/web`):

- `ScoreBoard.test.tsx` — vote toggle calls `onVote`; tally renders correctly excluding bots;
  Play Again button only rendered/enabled for the host; clicking it calls `onPlayAgain`.
- `GameScreen.test.tsx` — polls the room only at `GAME_OVER`, not during live play; calls
  `enterRoom` on seeing `LOBBY`; does not poll/redirect for a spectator (`!snapshot.you`).
- `useReplayPlayer`/tutorial `GameStage` usage unaffected (regression check — no new required
  props break existing sandbox render).

## Success criteria

- After a game ends, any player can toggle a "want to rematch" vote and see a live tally.
- The host can click **Play Again** at any time post-game-over (regardless of the tally) and every
  other seated player is automatically carried back into the same room code, now in `LOBBY`, with
  the same settings and members, all ready flags cleared.
- A spectator watching the finished game is never auto-joined into the reset lobby.
- Starting a new game from the rematched room produces a fresh `gameId`/`seed`; the previous game
  remains fully intact in history/replay.
- `yarn workspace @trm/server test`, `yarn workspace @trm/web test`, `yarn lint`, and
  `yarn typecheck` pass.
