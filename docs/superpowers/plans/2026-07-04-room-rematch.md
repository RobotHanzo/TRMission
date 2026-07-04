# Room Rematch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a room play a second (and third, ...) game without recreating it — a host-only "Play
Again" action resets a finished room from `STARTED` back to `LOBBY` (same members/host/settings,
ready flags cleared), with other seated players able to cast an advisory "I want a rematch" vote
that the host sees but is never gated by.

**Architecture:** Two new host/member REST actions on the existing lobby control plane
(`POST /rooms/:code/rematch-vote`, `POST /rooms/:code/rematch`), backed by a CAS-guarded
`RoomRepo.resetToLobby` and a server-authoritative `GameHub.isGameOver` check (never trust the
client to only call rematch once the game has actually ended). On the client, `GameScreen` polls
the room during `GAME_OVER` (mirroring `RoomScreen`'s existing poll-based lobby) and auto-navigates
back into the room the moment it observes `LOBBY`; `ScoreBoard` grows a vote toggle + host-only
"Play Again" button.

**Tech Stack:** NestJS + MongoDB (native driver) + Zod/nestjs-zod on the server; React + Zustand +
vitest/@testing-library/react on the client. No new dependencies.

## Global Constraints

- The 6th card colour is **PURPLE** everywhere (not relevant to this feature, but never reintroduce PINK if touching shared enums).
- Server is authoritative: never trust client-reported game state — `rematch` must verify game-over
  status itself (`GameHub.isGameOver`), not rely on the client only calling it post-`GAME_OVER`.
- `apps/server` runs on swc (`@swc-node/register` / `unplugin-swc`), never tsx/esbuild — irrelevant
  here since no runtime config changes, just flagging per project convention.
- All server tests are e2e-style (`apps/server/test/*.e2e.spec.ts`), booting the full Nest app
  against `mongodb-memory-server` via `createTestApp()` — there is no repo/service unit-test
  convention in this codebase; follow the existing pattern, don't invent a new one.
- Web tests use vitest + `@testing-library/react`; assert against the app's primary locale
  (zh-Hant) as the existing `ScoreBoard.test.tsx`/`GameScreen.test.tsx` do.
- i18n: Traditional Chinese is primary, English is the fallback — every new user-facing string
  needs both.

---

## Task 1: Rematch vote — data model, repo, service, endpoint

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts:37-46` (RoomMember interface), add method before the
  closing brace at `apps/server/src/lobby/room.repo.ts:353`
- Modify: `apps/server/src/lobby/lobby.schemas.ts`
- Modify: `apps/server/src/lobby/lobby.service.ts`
- Modify: `apps/server/src/lobby/lobby.controller.ts`
- Test/Create: `apps/server/test/lobby-rematch.e2e.spec.ts`

**Interfaces:**
- Consumes: existing `RoomRepo`/`LobbyService`/`LobbyController` patterns (`markStarted`, `ready`,
  `toView`), existing `createTestApp()` test harness.
- Produces: `RoomRepo.setRematchVote(code: string, userId: string, vote: boolean): Promise<RoomDoc | 'not_found' | 'not_member'>`,
  `LobbyService.voteRematch(code: string, user: AuthUser, vote: boolean): Promise<RoomView>`,
  `RoomMember.wantsRematch?: boolean` (consumed by Task 2's `resetToLobby` and by the web client in
  Tasks 3-5).

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/lobby-rematch.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);

afterAll(() => t.close());

describe('lobby: rematch vote', () => {
  it('lets a seated member cast and change an advisory rematch vote', async () => {
    const a = await guest('Ada');
    const b = await guest('Bo');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const voted = await request(server())
      .post(`/api/v1/rooms/${code}/rematch-vote`)
      .set(auth(b.token))
      .send({ wantsRematch: true })
      .expect(200);
    const bMember = voted.body.members.find((m: { userId: string }) => m.userId === b.id);
    expect(bMember.wantsRematch).toBe(true);

    const changed = await request(server())
      .post(`/api/v1/rooms/${code}/rematch-vote`)
      .set(auth(b.token))
      .send({ wantsRematch: false })
      .expect(200);
    expect(
      changed.body.members.find((m: { userId: string }) => m.userId === b.id).wantsRematch,
    ).toBe(false);
  });

  it('rejects a vote from someone who is not a member of the room', async () => {
    const a = await guest('Ada2');
    const outsider = await guest('Out');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .post(`/api/v1/rooms/${code}/rematch-vote`)
      .set(auth(outsider.token))
      .send({ wantsRematch: true })
      .expect(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run lobby-rematch`
Expected: FAIL — `POST /api/v1/rooms/:code/rematch-vote` doesn't exist yet (404).

- [ ] **Step 3: Add `wantsRematch` to `RoomMember` and `setRematchVote` to `RoomRepo`**

In `apps/server/src/lobby/room.repo.ts`, change the `RoomMember` interface (lines 37-46):

```ts
export interface RoomMember {
  userId: string;
  displayName: string;
  isGuest: boolean;
  seat: number;
  ready: boolean;
  /** Bot members are computer-controlled; they are always ready and never connect. */
  isBot?: boolean;
  difficulty?: BotDifficulty;
  /** Advisory "I want to play again" vote, meaningful only while status === 'STARTED'.
   *  Reset to false whenever a game starts or a rematch resets the room to LOBBY. */
  wantsRematch?: boolean;
}
```

Add this method right after `kick` (before the class's closing brace on line 353):

```ts
  /** Any seated member (not just the host) records their advisory rematch preference. */
  async setRematchVote(
    code: string,
    userId: string,
    vote: boolean,
  ): Promise<RoomDoc | 'not_found' | 'not_member'> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (!room.members.some((m) => m.userId === userId)) return 'not_member';
    await this.col.updateOne(
      { _id: code, 'members.userId': userId },
      { $set: { 'members.$.wantsRematch': vote, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }
```

- [ ] **Step 4: Add the schema**

In `apps/server/src/lobby/lobby.schemas.ts`, add `wantsRematch` to `RoomMemberSchema`:

```ts
export const RoomMemberSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
  seat: z.number(),
  ready: z.boolean(),
  isBot: z.boolean().optional(),
  difficulty: botDifficulty.optional(),
  wantsRematch: z.boolean().optional(),
});
```

And add a new schema + DTO (near `ReadySchema`/`ReadyDto`):

```ts
export const RematchVoteSchema = z.object({ wantsRematch: z.boolean() });
export class RematchVoteDto extends createZodDto(RematchVoteSchema) {}
```

- [ ] **Step 5: Add `LobbyService.voteRematch`**

In `apps/server/src/lobby/lobby.service.ts`, add this method (e.g. right after `ready`):

```ts
  /** Any seated member casts (or changes) their advisory rematch vote. */
  async voteRematch(code: string, user: AuthUser, vote: boolean): Promise<RoomView> {
    const r = await this.rooms.setRematchVote(code, user.userId, vote);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'not_member') throw new ForbiddenException('not a member of this room');
    return toView(r);
  }
```

- [ ] **Step 6: Add the controller route**

In `apps/server/src/lobby/lobby.controller.ts`, add `RematchVoteDto`, `RematchVoteSchema` to the
import from `./lobby.schemas`, then add this route right after `ready` (before `addBot`):

```ts
  @Post(':code/rematch-vote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cast (or change) your advisory "play again" vote' })
  @ApiBody({ schema: apiSchema(RematchVoteSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  rematchVote(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() body: RematchVoteDto,
  ) {
    return this.lobby.voteRematch(code.toUpperCase(), user, body.wantsRematch);
  }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run lobby-rematch`
Expected: PASS (2 tests)

- [ ] **Step 8: Typecheck**

Run: `yarn workspace @trm/server typecheck`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/src/lobby/lobby.schemas.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/lobby.controller.ts apps/server/test/lobby-rematch.e2e.spec.ts
git commit -m "feat(server): add advisory rematch vote endpoint"
```

---

## Task 2: Host rematch action — reset a finished room back to LOBBY

**Files:**
- Modify: `apps/server/src/persistence/types.ts:101-123` (`GameStorePort` interface)
- Modify: `apps/server/src/persistence/game-store.ts:111-148` (add method after `recordCompletion`)
- Modify: `apps/server/src/ws/hub.ts:161-178` (add method after `evictMatch`)
- Modify: `apps/server/src/lobby/room.repo.ts` (add `resetToLobby`, same file as Task 1)
- Modify: `apps/server/src/lobby/lobby.service.ts` (add `rematch`)
- Modify: `apps/server/src/lobby/lobby.controller.ts` (add route)
- Test: `apps/server/test/lobby-rematch.e2e.spec.ts` (append to the file from Task 1)

**Interfaces:**
- Consumes: `RoomRepo.setRematchVote`/`wantsRematch` from Task 1; existing `GameRegistry`,
  `GameSession.phase`, `MongoGameStore` collections.
- Produces: `GameStorePort.getStatus(gameId: string): Promise<GameDoc['status'] | undefined>`,
  `GameHub.isGameOver(gameId: string): Promise<boolean>`,
  `RoomRepo.resetToLobby(code: string, hostId: string, expectedGameId: string): Promise<boolean>`,
  `LobbyService.rematch(code: string, user: AuthUser): Promise<RoomView>`.

- [ ] **Step 1: Write the failing e2e tests**

Append to `apps/server/test/lobby-rematch.e2e.spec.ts`. First, add these imports at the top of the
file (alongside the existing ones):

```ts
import type { PlayerId } from '@trm/shared';
import type { ServerEnvelope } from '@trm/proto';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { encodeClient, decodeServer, actionToCommand, pickAction } from './helpers';
```

`ServerEnvelope`/`decodeServer` aren't used by the test bodies below but match the existing import
block shape in `lobby.e2e.spec.ts`; if your editor/lint flags an unused import, drop
`decodeServer`/`ServerEnvelope` — they aren't required for this file.

Then append:

```ts
describe('lobby: host rematch', () => {
  it('rejects rematch from a non-host, and before/while the game is unfinished', async () => {
    const a = await guest('Host1');
    const b = await guest('Guest1');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    // Still LOBBY — nothing to rematch.
    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(a.token)).expect(400);

    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(a.token))
      .send({ ready: true })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(b.token))
      .send({ ready: true })
      .expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);

    // A non-host can't rematch, even mid-game.
    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(b.token)).expect(403);
    // The game is still LIVE — the host can't rematch yet either.
    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(a.token)).expect(400);
  });

  it('plays a game to completion, rematches, and starts a fresh game in the same room', async () => {
    const a = await guest('Host2');
    const b = await guest('Guest2');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(a.token))
      .send({ ready: true })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(b.token))
      .send({ ready: true })
      .expect(200);
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);
    const gameId: string = started.body.gameId;
    const bTicket = (
      await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(b.token)).expect(200)
    ).body.ticket;

    const hub = t.app.get(GameHub);
    const session = t.app.get(GameRegistry).get(gameId)!.session;
    const board = session.board;
    const conns: Record<string, { connId: string; ticket: string; seq: number }> = {
      [a.id]: { connId: 'rematch-a', ticket: started.body.ticket, seq: 0 },
      [b.id]: { connId: 'rematch-b', ticket: bTicket, seq: 0 },
    };
    for (const c of Object.values(conns)) {
      hub.openConnection(c.connId, () => {});
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, { case: 'hello', value: { ticket: c.ticket, protocolVersion: 1 } }),
      );
    }

    let guard = 0;
    while (session.phase !== 'GAME_OVER') {
      if (++guard > 5000) throw new Error('game did not terminate');
      const state = session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? session.turnOrder.find((p) => session.hasPendingOffer(p))
          : session.currentPlayer;
      if (!actor) throw new Error('no actor');
      const c = conns[actor as string];
      if (!c) throw new Error(`unknown actor ${actor}`);
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, actionToCommand(pickAction(board, state, actor as PlayerId))),
      );
    }

    const rematched = await request(server())
      .post(`/api/v1/rooms/${code}/rematch`)
      .set(auth(a.token))
      .expect(200);
    expect(rematched.body.status).toBe('LOBBY');
    expect(rematched.body.gameId).toBeUndefined();
    expect(rematched.body.members.every((m: { ready: boolean }) => m.ready === false)).toBe(true);

    // A second rematch call is a clean no-op-turned-400, not a crash.
    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(a.token)).expect(400);

    // The same room code plays a brand-new game.
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(a.token))
      .send({ ready: true })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(b.token))
      .send({ ready: true })
      .expect(200);
    const restarted = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);
    expect(restarted.body.gameId).toBeTruthy();
    expect(restarted.body.gameId).not.toBe(gameId);
  });

  it('falls back to the durable game status when the match is no longer resident (e.g. after a restart)', async () => {
    const a = await guest('Host3');
    const b = await guest('Guest3');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(a.token))
      .send({ ready: true })
      .expect(200);
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(b.token))
      .send({ ready: true })
      .expect(200);
    const started = await request(server())
      .post(`/api/v1/rooms/${code}/start`)
      .set(auth(a.token))
      .expect(200);
    const gameId: string = started.body.gameId;
    const bTicket = (
      await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(b.token)).expect(200)
    ).body.ticket;

    const hub = t.app.get(GameHub);
    const registry = t.app.get(GameRegistry);
    const session = registry.get(gameId)!.session;
    const board = session.board;
    const conns: Record<string, { connId: string; ticket: string; seq: number }> = {
      [a.id]: { connId: 'restart-a', ticket: started.body.ticket, seq: 0 },
      [b.id]: { connId: 'restart-b', ticket: bTicket, seq: 0 },
    };
    for (const c of Object.values(conns)) {
      hub.openConnection(c.connId, () => {});
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, { case: 'hello', value: { ticket: c.ticket, protocolVersion: 1 } }),
      );
    }
    let guard = 0;
    while (session.phase !== 'GAME_OVER') {
      if (++guard > 5000) throw new Error('game did not terminate');
      const state = session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? session.turnOrder.find((p) => session.hasPendingOffer(p))
          : session.currentPlayer;
      if (!actor) throw new Error('no actor');
      const c = conns[actor as string];
      if (!c) throw new Error(`unknown actor ${actor}`);
      await hub.receive(
        c.connId,
        encodeClient(++c.seq, actionToCommand(pickAction(board, state, actor as PlayerId))),
      );
    }

    // Simulate a server restart wiping the in-memory registry. recordCompletion already
    // persisted status: 'COMPLETED' to Mongo during the loop above, so isGameOver's store
    // fallback must still let this rematch succeed.
    registry.remove(gameId);

    await request(server()).post(`/api/v1/rooms/${code}/rematch`).set(auth(a.token)).expect(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run lobby-rematch`
Expected: FAIL — `POST /api/v1/rooms/:code/rematch` doesn't exist yet (404).

- [ ] **Step 3: Add `getStatus` to `GameStorePort` and `MongoGameStore`**

In `apps/server/src/persistence/types.ts`, add to the `GameStorePort` interface (right after
`recordCompletion`):

```ts
  /** Current status of a game, or undefined if unknown. Used by rematch to confirm a game has
   *  actually finished even across a server restart (the hub's in-memory registry is the fast
   *  path; this is the durable fallback). */
  getStatus(gameId: string): Promise<GameDoc['status'] | undefined>;
```

In `apps/server/src/persistence/game-store.ts`, implement it right after `recordCompletion` (before
`addSpectator`):

```ts
  async getStatus(gameId: string): Promise<GameDoc['status'] | undefined> {
    const game = await this.games.findOne({ _id: gameId }, { projection: { status: 1 } });
    return game?.status;
  }
```

- [ ] **Step 4: Add `GameHub.isGameOver`**

In `apps/server/src/ws/hub.ts`, add this method right after `evictMatch` (before `openConnection`):

```ts
  /**
   * Whether a game has actually finished — checked authoritatively server-side before rematch is
   * allowed to reset a room, never inferred from client UI state. The in-memory registry is the
   * fast path (a completed match stays resident until evictMatch removes it, which never happens
   * on natural completion); the store is a durable fallback for the rare case where the server
   * restarted between game-over and the rematch call.
   */
  async isGameOver(gameId: string): Promise<boolean> {
    const match = this.registry.get(gameId);
    if (match) return match.session.phase === 'GAME_OVER';
    const status = await this.store?.getStatus(gameId);
    return status === 'COMPLETED';
  }
```

- [ ] **Step 5: Add `RoomRepo.resetToLobby`**

In `apps/server/src/lobby/room.repo.ts`, add this method right after `setRematchVote`:

```ts
  /** Host-only: flip a finished room back to LOBBY for another round. CAS on the exact gameId
   *  being rematched so a stale/duplicate call is a clean no-op rather than clobbering a room
   *  that's already moved on to a different game. */
  async resetToLobby(code: string, hostId: string, expectedGameId: string): Promise<boolean> {
    const room = await this.col.findOne({
      _id: code,
      hostId,
      status: 'STARTED',
      gameId: expectedGameId,
    });
    if (!room) return false;
    const members = room.members.map((m) => ({
      ...m,
      ready: m.isBot === true,
      wantsRematch: false,
    }));
    const res = await this.col.updateOne(
      { _id: code, hostId, status: 'STARTED', gameId: expectedGameId },
      { $set: { status: 'LOBBY', members, updatedAt: new Date() }, $unset: { gameId: '', seed: '' } },
    );
    return res.modifiedCount === 1;
  }
```

- [ ] **Step 6: Add `LobbyService.rematch`**

In `apps/server/src/lobby/lobby.service.ts`, add this method (e.g. right after `start`):

```ts
  /** Host-only: reset a finished game's room back to LOBBY for another round. */
  async rematch(code: string, user: AuthUser): Promise<RoomView> {
    const room = await this.require(code);
    if (room.hostId !== user.userId) throw new ForbiddenException('only the host can rematch');
    if (room.status !== 'STARTED' || !room.gameId) {
      throw new BadRequestException('no game to rematch');
    }
    if (!(await this.hub.isGameOver(room.gameId))) {
      throw new BadRequestException('game is still in progress');
    }
    if (!(await this.rooms.resetToLobby(code, user.userId, room.gameId))) {
      throw new BadRequestException('could not rematch (already rematched?)');
    }
    return this.get(code);
  }
```

- [ ] **Step 7: Add the controller route**

In `apps/server/src/lobby/lobby.controller.ts`, add right after `start` (before `ticket`):

```ts
  @Post(':code/rematch')
  @HttpCode(200)
  @ApiOperation({ summary: "Host resets a finished room back to LOBBY for another round" })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  rematch(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.lobby.rematch(code.toUpperCase(), user);
  }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `yarn workspace @trm/server test --run lobby-rematch`
Expected: PASS (5 tests total — 2 from Task 1, 3 from this task)

- [ ] **Step 9: Typecheck and lint**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/persistence/types.ts apps/server/src/persistence/game-store.ts apps/server/src/ws/hub.ts apps/server/src/lobby/room.repo.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/lobby.controller.ts apps/server/test/lobby-rematch.e2e.spec.ts
git commit -m "feat(server): let the host reset a finished room back to LOBBY"
```

---

## Task 3: Web REST client — rematch endpoints

**Files:**
- Modify: `apps/web/src/net/rest.ts:39-47` (`RoomMember`), `:285-304` (room API methods)
- Modify: `apps/web/src/net/rest.test.ts:36-71` (existing describe block)

**Interfaces:**
- Consumes: nothing new (existing `req` helper, `RoomView`).
- Produces: `RoomMember.wantsRematch?: boolean`,
  `api.voteRematch(code: string, wantsRematch: boolean): Promise<RoomView>`,
  `api.rematch(code: string): Promise<RoomView>` (consumed by Tasks 4-5).

- [ ] **Step 1: Write the failing tests**

Append to the `'rest client: per-game settings + spectating'` describe block in
`apps/web/src/net/rest.test.ts` (after the "POSTs a spectate request" test):

```ts
  it('POSTs a rematch vote', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(res(200, { code: 'ABCDEF', members: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await api.voteRematch('ABCDEF', true);
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe('/api/v1/rooms/ABCDEF/rematch-vote');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ wantsRematch: true });
  });

  it('POSTs a rematch request', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(res(200, { code: 'ABCDEF', members: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await api.rematch('ABCDEF');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/rooms/ABCDEF/rematch',
      expect.objectContaining({ method: 'POST' }),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run rest.test`
Expected: FAIL — `api.voteRematch is not a function` / `api.rematch is not a function`

- [ ] **Step 3: Add the field and methods**

In `apps/web/src/net/rest.ts`, update `RoomMember` (lines 39-47):

```ts
export interface RoomMember {
  userId: string;
  displayName: string;
  isGuest: boolean;
  seat: number;
  ready: boolean;
  isBot?: boolean;
  difficulty?: BotDifficulty;
  wantsRematch?: boolean;
}
```

Add these two methods right after `spectate` (line 304):

```ts
  voteRematch: (code: string, wantsRematch: boolean) =>
    req<RoomView>('POST', `/rooms/${code}/rematch-vote`, { wantsRematch }),
  rematch: (code: string) => req<RoomView>('POST', `/rooms/${code}/rematch`),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run rest.test`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/net/rest.test.ts
git commit -m "feat(web): add rematch vote/action REST client methods"
```

---

## Task 4: ScoreBoard — vote toggle + host "Play Again" button

This task is self-contained (no dependency on `GameScreen`): all four new `ScoreBoard`/`GameStage`
props are optional, so `GameScreen` (unchanged until Task 5) keeps calling `<GameStage>` without
them and everything still typechecks.

**Files:**
- Modify: `apps/web/src/components/ScoreBoard.tsx` (props + new UI block)
- Modify: `apps/web/src/screens/GameStage.tsx:54-71` (props interface), `:73-82` (destructure),
  `:475` (ScoreBoard call site)
- Modify: `apps/web/src/i18n/index.ts` (new keys, zh-Hant block near line 197, en block near line
  613)
- Modify: `apps/web/src/components/ScoreBoard.test.tsx` (append new tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GameStageProps.isHost?: boolean`, `GameStageProps.rematchMembers?: RoomMember[]`,
  `GameStageProps.onVoteRematch?(wantsRematch: boolean): void`, `GameStageProps.onPlayAgain?(): void`
  — consumed by Task 5 when wiring `GameScreen`.

- [ ] **Step 1: Write the failing tests**

Add this import to the top of `apps/web/src/components/ScoreBoard.test.tsx`:

```ts
import type { RoomMember } from '../net/rest';
```

Add this helper and describe block at the end of the file:

```tsx
const member = (over: Partial<RoomMember> = {}): RoomMember => ({
  userId: 'p0',
  displayName: 'Host',
  isGuest: false,
  seat: 0,
  ready: false,
  ...over,
});

describe('ScoreBoard rematch', () => {
  beforeEach(() => {
    useAnimations.getState().reset();
    void i18n.changeLanguage('zh-Hant');
  });

  it('lets a viewer toggle their rematch vote', () => {
    const onVote = vi.fn();
    const members = [member({ userId: 'p0' }), member({ userId: 'bot:1', isBot: true, ready: true })];
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} members={members} onVote={onVote} />);
    fireEvent.click(screen.getByRole('button', { name: /想再玩一局/ }));
    expect(onVote).toHaveBeenCalledWith(true);
  });

  it('shows the tally excluding bots', () => {
    const members = [
      member({ userId: 'p0', wantsRematch: true }),
      member({ userId: 'bot:1', isBot: true, ready: true }),
    ];
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} members={members} onVote={() => {}} />);
    expect(screen.getByText('1/1 人想再玩一局')).toBeInTheDocument();
  });

  it('only shows Play Again to the host', () => {
    const members = [member({ userId: 'p0' })];
    const onPlayAgain = vi.fn();
    const { rerender } = render(
      <ScoreBoard
        snapshot={snap}
        onLeave={() => {}}
        members={members}
        onVote={() => {}}
        onPlayAgain={onPlayAgain}
        isHost={false}
      />,
    );
    expect(screen.queryByRole('button', { name: '再玩一局' })).not.toBeInTheDocument();

    rerender(
      <ScoreBoard
        snapshot={snap}
        onLeave={() => {}}
        members={members}
        onVote={() => {}}
        onPlayAgain={onPlayAgain}
        isHost={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '再玩一局' }));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });

  it('renders no rematch controls when members/callbacks are not provided (sandbox/replay)', () => {
    render(<ScoreBoard snapshot={snap} onLeave={() => {}} />);
    expect(screen.queryByRole('button', { name: /想再玩一局/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run ScoreBoard.test`
Expected: FAIL — `ScoreBoard` doesn't accept `members`/`onVote`/`onPlayAgain`/`isHost` yet.

- [ ] **Step 3: Add the new props and UI to `ScoreBoard.tsx`**

Add this import near the top of `apps/web/src/components/ScoreBoard.tsx` (alongside the other
type-only imports):

```ts
import type { RoomMember } from '../net/rest';
```

Change the function signature (currently
`export function ScoreBoard({ snapshot, onLeave }: { snapshot: GameSnapshot; onLeave(): void }) {`)
to:

```tsx
export function ScoreBoard({
  snapshot,
  onLeave,
  isHost,
  members,
  onVote,
  onPlayAgain,
}: {
  snapshot: GameSnapshot;
  onLeave(): void;
  isHost?: boolean;
  members?: RoomMember[];
  onVote?(wantsRematch: boolean): void;
  onPlayAgain?(): void;
}) {
```

Right after the `dismissed` early-return block (i.e. right before the existing
`const modalPlayer = ticketModal && ...` line), add:

```tsx
  const myVote = members?.find((m) => m.userId === snapshot.you?.playerId)?.wantsRematch ?? false;
  const humanMembers = members?.filter((m) => !m.isBot) ?? [];
  const rematchCount = humanMembers.filter((m) => m.wantsRematch).length;
```

Right before the existing `<div className="scoreboard-actions">` block, add:

```tsx
        {members && snapshot.you && (onVote || onPlayAgain) && (
          <div className="row between rematch-row">
            <span className="muted">
              {t('rematchTally', { count: rematchCount, total: humanMembers.length })}
            </span>
            <div className="row">
              {onVote && (
                <button className={myVote ? 'success' : ''} onClick={() => onVote(!myVote)}>
                  🔁 {t('wantRematch')}
                </button>
              )}
              {isHost && onPlayAgain && (
                <button className="primary" onClick={onPlayAgain}>
                  {t('playAgain')}
                </button>
              )}
            </div>
          </div>
        )}
```

- [ ] **Step 4: Thread the props through `GameStage.tsx`**

In `apps/web/src/screens/GameStage.tsx`, add `RoomMember` to the type-only imports (near the top,
alongside `RouteDef`):

```ts
import type { RoomMember } from '../net/rest';
```

Add four new optional fields to `GameStageProps` (lines 54-71), right after `onLeave: () => void;`:

```ts
  /** Room membership + advisory rematch votes, for the post-game-over ScoreBoard. Undefined in
   *  sandbox/tutorial/replay contexts, where there's no room to rematch. */
  isHost?: boolean;
  rematchMembers?: RoomMember[];
  onVoteRematch?(wantsRematch: boolean): void;
  onPlayAgain?(): void;
```

Add the same four names to the destructured parameters (lines 73-82), right after `onLeave,`:

```ts
  isHost,
  rematchMembers,
  onVoteRematch,
  onPlayAgain,
```

Change line 475 from:

```tsx
      {phase === Phase.GAME_OVER && <ScoreBoard snapshot={snapshot} onLeave={onLeave} />}
```

to:

```tsx
      {phase === Phase.GAME_OVER && (
        <ScoreBoard
          snapshot={snapshot}
          onLeave={onLeave}
          isHost={isHost}
          members={rematchMembers}
          onVote={onVoteRematch}
          onPlayAgain={onPlayAgain}
        />
      )}
```

- [ ] **Step 5: Add i18n keys**

In `apps/web/src/i18n/index.ts`, in the zh-Hant block, right after `leaveConfirmBody: '確定要離開嗎？',`
(around line 197), add:

```ts
      playAgain: '再玩一局',
      wantRematch: '想再玩一局',
      rematchTally: '{{count}}/{{total}} 人想再玩一局',
```

In the English block, right after `leaveConfirmBody: 'Are you sure you want to leave?',` (around
line 613), add:

```ts
      playAgain: 'Play Again',
      wantRematch: 'Want a rematch',
      rematchTally: '{{count}}/{{total}} want a rematch',
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run ScoreBoard.test`
Expected: PASS (all tests, including the 4 pre-existing ones — unaffected since the new props are
optional and the whole new block is gated on `members` being present)

- [ ] **Step 7: Full workspace typecheck and lint**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint`
Expected: no errors — `GameScreen.tsx` is unchanged this task and still compiles fine, since every
new `GameStageProps` field is optional.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ScoreBoard.tsx apps/web/src/components/ScoreBoard.test.tsx apps/web/src/screens/GameStage.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web): add rematch vote toggle + host Play Again button to ScoreBoard"
```

---

## Task 5: GameScreen — poll for rematch, auto-redirect to the reset room

**Files:**
- Modify: `apps/web/src/screens/GameScreen.tsx` (full file, currently 89 lines)
- Modify: `apps/web/src/screens/GameScreen.test.tsx` (append new tests + mock updates)

**Interfaces:**
- Consumes: `GameStageProps.isHost`/`rematchMembers`/`onVoteRematch`/`onPlayAgain` from Task 4;
  `api.getRoom` (existing), `api.voteRematch`/`api.rematch` from Task 3; `useUi().enterRoom`
  (existing, currently unused by `GameScreen`); `useSession().user` (existing store, not yet
  imported by `GameScreen`).
- Produces: none for later tasks — Task 6 is verification only.

- [ ] **Step 1: Write the failing tests**

Add this import to the top of `apps/web/src/screens/GameScreen.test.tsx` (alongside the existing
ones):

```ts
import { api } from '../net/rest';
```

Update the existing `vi.mock('../net/rest', ...)` factory to include the two new methods (needed
because the real component now references them even though these particular tests don't assert on
them):

```ts
vi.mock('../net/rest', () => ({
  setOnTokenChange: vi.fn(),
  setAccessToken: vi.fn(),
  api: {
    getRoom: vi.fn(() => Promise.resolve({ members: [] })),
    voteRematch: vi.fn(() => Promise.resolve({ members: [] })),
    rematch: vi.fn(() => Promise.resolve({ members: [] })),
  },
}));
```

Then append this new describe block at the end of the file:

```ts
// A live (non-spectator, non-game-over) snapshot, for isolating the phase gate.
const liveSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
    you: { playerId: 'p0' },
  });

// A finished game seen by a spectator (no `you`) — must never be auto-joined into a reset lobby.
const gameOverSpectatorSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.GAME_OVER,
    players: [
      { id: 'p0', seat: 0, routePoints: 10 },
      { id: 'p1', seat: 1, routePoints: 5 },
    ],
    finalScores: {
      players: [
        {
          playerId: 'p0',
          routePoints: 10,
          ticketNet: 0,
          ticketsCompleted: 0,
          stationsUsed: 0,
          unusedStations: 3,
          stationBonus: 0,
          longestTrailLength: 0,
          longestBonus: 0,
          total: 10,
          keptTicketIds: [],
          completedTicketIds: [],
          longestTrailRouteIds: [],
        },
        {
          playerId: 'p1',
          routePoints: 5,
          ticketNet: 0,
          ticketsCompleted: 0,
          stationsUsed: 0,
          unusedStations: 3,
          stationBonus: 0,
          longestTrailLength: 0,
          longestBonus: 0,
          total: 5,
          keptTicketIds: [],
          completedTicketIds: [],
          longestTrailRouteIds: [],
        },
      ],
      ranking: [{ playerIds: ['p0'] }, { playerIds: ['p1'] }],
    },
  });

describe('GameScreen rematch redirect', () => {
  afterEach(() => vi.restoreAllMocks());

  it('polls the room after game-over and enters the room once it resets to LOBBY', async () => {
    vi.useFakeTimers();
    try {
      useUi.setState({ view: 'game', ticket: 'tkt', roomCode: 'ABCD', gameId: 'g1' });
      useGame.setState({ snapshot: gameOverSnap(), rejection: null });
      let status: 'STARTED' | 'LOBBY' = 'STARTED';
      vi.mocked(api.getRoom).mockImplementation(() =>
        Promise.resolve({ hostId: 'p0', status, members: [] } as never),
      );
      render(<GameScreen />);
      await vi.advanceTimersByTimeAsync(100); // settle the initial fetches
      expect(useUi.getState().view).toBe('game');
      status = 'LOBBY'; // the host has rematched
      await vi.advanceTimersByTimeAsync(2000); // next poll tick observes it
      expect(useUi.getState().view).toBe('room');
      expect(useUi.getState().roomCode).toBe('ABCD');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not run the rematch poll while the game is still live', async () => {
    vi.useFakeTimers();
    try {
      useUi.setState({ view: 'game', ticket: 'tkt', roomCode: 'ABCD', gameId: 'g1' });
      useGame.setState({ snapshot: liveSnap(), rejection: null });
      vi.mocked(api.getRoom).mockClear();
      vi.mocked(api.getRoom).mockResolvedValue({ hostId: 'p0', status: 'LOBBY', members: [] } as never);
      render(<GameScreen />);
      await vi.advanceTimersByTimeAsync(5000);
      // Only the pre-existing one-shot roster effect fires — the game-over poll never starts.
      expect(vi.mocked(api.getRoom)).toHaveBeenCalledTimes(1);
      expect(useUi.getState().view).toBe('game');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not redirect a spectator watching a finished game', async () => {
    vi.useFakeTimers();
    try {
      useUi.setState({ view: 'game', ticket: 'tkt', roomCode: 'ABCD', gameId: 'g1' });
      useGame.setState({ snapshot: gameOverSpectatorSnap(), rejection: null });
      vi.mocked(api.getRoom).mockResolvedValue({ hostId: 'p0', status: 'LOBBY', members: [] } as never);
      render(<GameScreen />);
      await vi.advanceTimersByTimeAsync(4000);
      expect(useUi.getState().view).toBe('game');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run GameScreen.test`
Expected: FAIL — the first test times out/never reaches `view: 'room'` (no poll effect exists yet).

- [ ] **Step 3: Implement the poll + redirect in `GameScreen.tsx`**

Replace the full contents of `apps/web/src/screens/GameScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phase } from '@trm/proto';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { useRoster } from '../store/roster';
import { api, type RoomView } from '../net/rest';
import { connectGame, getSocket } from '../net/connection';
import { useActiveContent } from '../game/useActiveContent';
import { GameStage } from './GameStage';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useConfirmAction } from '../hooks/useConfirmAction';

/**
 * Live-game shell: owns the socket connect + roster fetch, then delegates the board + HUD to the
 * presentational `GameStage` (shared with the tutorial / encyclopedia sandbox).
 */
export function GameScreen() {
  const { t } = useTranslation();
  const ticket = useUi((s) => s.ticket);
  const roomCode = useUi((s) => s.roomCode);
  const goHome = useUi((s) => s.goHome);
  const enterRoom = useUi((s) => s.enterRoom);
  const user = useSession((s) => s.user);

  const snapshot = useGame((s) => s.snapshot);
  const setRoster = useRoster((s) => s.setMembers);
  const contentStatus = useActiveContent(snapshot?.contentHash);
  const [room, setRoom] = useState<RoomView | null>(null);

  useEffect(() => {
    if (ticket && !getSocket()) connectGame(ticket);
  }, [ticket]);
  // Pull the room's members (real account names / bot labels) so the trackers, scoreboard and turn
  // banner can show them instead of "P{seat+1}". Snapshots carry ids only — names are lobby data.
  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    api
      .getRoom(roomCode)
      .then((r) => {
        if (!cancelled) {
          setRoster(r.members);
          setRoom(r);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomCode, setRoster]);

  // Once the game is over, poll the room every 2s: refresh the rematch vote tally, and the moment
  // the host resets it to LOBBY, carry this client back into the room — the same way starting a
  // game already carries everyone from the room into it. Spectators are excluded: they were never
  // room members, and RoomScreen's own poll would otherwise auto-join a non-member landing on a
  // LOBBY room, which is right for an invite link but wrong for someone who was only ever watching.
  const phase = snapshot?.phase;
  const isSpectator = !snapshot?.you;
  useEffect(() => {
    if (!roomCode || phase !== Phase.GAME_OVER || isSpectator) return;
    let active = true;
    const poll = async () => {
      try {
        const r = await api.getRoom(roomCode);
        if (!active) return;
        if (r.status === 'LOBBY') {
          active = false;
          enterRoom(roomCode);
          return;
        }
        setRoster(r.members);
        setRoom(r);
      } catch {
        // transient — next tick retries; this is a convenience poll, not a critical path
      }
    };
    void poll();
    const id = setInterval(() => {
      if (!active) {
        clearInterval(id);
        return;
      }
      void poll();
    }, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [roomCode, phase, isSpectator, enterRoom, setRoster]);

  const {
    open: leaveOpen,
    request: requestLeave,
    confirm: confirmLeave,
    cancel: cancelLeave,
  } = useConfirmAction();

  // goHome tears down the socket. Nothing is at stake before the first snapshot arrives, so only
  // confirm once there's an actual game (live play, or the post-game-over ScoreBoard) to abandon.
  const leave = () => {
    if (snapshot) requestLeave(goHome);
    else goHome();
  };

  const voteRematch = async (wantsRematch: boolean) => {
    if (!roomCode) return;
    try {
      const r = await api.voteRematch(roomCode, wantsRematch);
      setRoster(r.members);
      setRoom(r);
    } catch {
      // transient — the next poll tick resyncs
    }
  };

  const playAgain = async () => {
    if (!roomCode) return;
    try {
      await api.rematch(roomCode);
      enterRoom(roomCode);
    } catch {
      // e.g. a race with another rematch call — the button stays put for a retry
    }
  };

  if (!snapshot || contentStatus === 'loading') {
    return (
      <div className="card">
        {t('connecting')} · <button onClick={leave}>{t('back')}</button>
      </div>
    );
  }
  if (contentStatus === 'error') {
    return (
      <div className="card">
        {t('history.unknownMap')} · <button onClick={leave}>{t('back')}</button>
      </div>
    );
  }

  return (
    <>
      <GameStage
        snapshot={snapshot}
        commands={getSocket()}
        onLeave={leave}
        isHost={room?.hostId === user?.id}
        rematchMembers={room?.members}
        onVoteRematch={voteRematch}
        onPlayAgain={playAgain}
      />
      {leaveOpen && (
        <ConfirmDialog
          title={t('leaveConfirmTitle')}
          message={t('leaveConfirmBody')}
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run GameScreen.test`
Expected: PASS (all tests, including the 3 new rematch-redirect ones)

- [ ] **Step 5: Typecheck and lint**

Run: `yarn workspace @trm/web typecheck && yarn workspace @trm/web lint`
Expected: no errors — `GameStageProps` already has `isHost`/`rematchMembers`/`onVoteRematch`/
`onPlayAgain` from Task 4, so this wiring typechecks cleanly.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/GameScreen.tsx apps/web/src/screens/GameScreen.test.tsx
git commit -m "feat(web): poll the room post-game-over and auto-return on rematch"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite**

Run: `yarn workspace @trm/server test`
Expected: PASS, including the new `lobby-rematch.e2e.spec.ts` and all pre-existing lobby/history/
dashboard specs (confirms `resetToLobby`/`closeByGameId`/`findActiveByMember` didn't regress).

- [ ] **Step 2: Run the full web test suite**

Run: `yarn workspace @trm/web test`
Expected: PASS, including `ScoreBoard.test.tsx`, `GameScreen.test.tsx`, `RoomScreen.test.tsx`,
`rest.test.ts`.

- [ ] **Step 3: Full typecheck, lint, and build**

Run: `yarn typecheck && yarn lint && yarn build`
Expected: no errors

- [ ] **Step 4: Manual smoke test**

Per project convention, start the dev stack and drive the actual feature in a browser rather than
relying on tests alone:

```bash
docker compose up -d mongo
yarn workspace @trm/server dev
yarn workspace @trm/web dev
```

With two browser windows (or one regular + one incognito) as two different guests:
1. Create a room in window A, join it from window B, add 0 bots (2 humans is enough), ready up
   both, start.
2. Play the game to completion (or use bots: add 2 EASY bots instead of a second human, ready up,
   start, and just wait — bots play themselves).
3. On the `ScoreBoard`, confirm: the non-host sees a "想再玩一局" (want rematch) toggle and a tally;
   the host additionally sees a "再玩一局" (Play Again) button.
4. Click the vote toggle as the non-host; confirm the host's tally updates within ~2s.
5. Click "Play Again" as the host; confirm both windows land back on the `RoomScreen` for the same
   room code, with ready flags cleared, and the host can start a brand-new game.
6. Confirm a spectator (open the room's public link in a third window while `allowSpectating` is
   on, watch to game-over) is NOT carried into the reset lobby when the host rematches.

- [ ] **Step 5: Stop the dev stack**

```bash
docker compose down
```

(No commit for this task — it's verification-only. If step 4 surfaces a bug, fix it as part of
whichever earlier task owns the broken behavior, with its own test-first cycle, then re-run this
task.)
