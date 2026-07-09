# Room ownership, spectating & lobby free-text chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prohibit room owners from spectating, make an owner's leave prompt a transfer-or-close choice, fix the client bug where self-demoting to spectator looks like a kick, add free-text lobby chat (parity with in-game), and stop spectating from resetting the auto-purge clock.

**Architecture:** Server stays authoritative — every rule is enforced in `apps/server/src/lobby` (repo → service → controller) and `apps/server/src/persistence`; the React client (`apps/web`) mirrors it. No engine, proto/wire, or shared-package changes. Chat gains an optional `text` alongside `presetId` (exactly one set; legacy rows keep `presetId`).

**Tech Stack:** NestJS + Mongo (native driver) + zod/nestjs-zod DTOs; React + Vite + vitest + @testing-library/react; react-i18next (zh-Hant primary + en).

## Global Constraints

- **Commit messages** end with the two footer lines the repo requires:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01KNkxci4yqBBz5RSGUZu7oC`.
- **Stage only files this task changed** — never `git add -A`/`git add .` (other sessions share this worktree).
- The 6th card colour is **PURPLE**; seat colours are abstract indices — irrelevant here but do not regress.
- Server runs on **swc** (not tsx). Do not touch runtime config.
- `apps/web` pins **Vite ^5** — do not bump.
- Run server tests with `yarn workspace @trm/server test --run <substr>` and web with `yarn workspace @trm/web test --run <substr>` (vitest substring match on file path).
- **In-game (protobuf) chat is out of scope** — it already supports free text.
- After all tasks, run `graphify update .` to refresh the knowledge graph (AST-only, no API cost).

---

### Task 1: Spectating is not auto-purge activity (game + record paths)

**Files:**
- Modify: `apps/server/src/persistence/game-store.ts` (`addSpectator`, ~L156-161)
- Modify: `apps/server/src/lobby/room.repo.ts` (`recordSpectator`, ~L540-545)
- Test: `apps/server/test/spectators.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MongoGameStore.addSpectator(gameId, userId)` and `RoomRepo.recordSpectator(code, spectator)` no longer bump `updatedAt` (same signatures).

- [ ] **Step 1: Write the failing test** — append inside the `describe('spectator persistence', …)` block in `apps/server/test/spectators.spec.ts`:

```ts
  it('addSpectator does not bump the game updatedAt (spectating is not activity)', async () => {
    const board = taiwanBoard();
    const config: GameConfig = { seed: 'spect-nobump', players, contentHash: CONTENT_HASH };
    const genesis = initGame(board, config);
    await store.createGame('gs-nobump', config, genesis, stateDigest(genesis));
    const before = await db.collection<GameDoc>('games').findOne({ _id: 'gs-nobump' });
    await new Promise((r) => setTimeout(r, 5));
    await store.addSpectator('gs-nobump', 'watcher');
    const after = await db.collection<GameDoc>('games').findOne({ _id: 'gs-nobump' });
    expect(after?.spectators).toEqual(['watcher']);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run spectators`
Expected: FAIL — `after.updatedAt` is newer than `before.updatedAt`.

- [ ] **Step 3: Drop the `updatedAt` bump from `addSpectator`** in `apps/server/src/persistence/game-store.ts`:

```ts
  async addSpectator(gameId: string, userId: string): Promise<void> {
    await this.games.updateOne({ _id: gameId }, { $addToSet: { spectators: userId } });
  }
```

- [ ] **Step 4: Drop the `updatedAt` bump from `recordSpectator`** in `apps/server/src/lobby/room.repo.ts`:

```ts
  async recordSpectator(code: string, spectator: RoomSpectator): Promise<void> {
    await this.col.updateOne(
      { _id: code, 'spectators.userId': { $ne: spectator.userId } },
      { $push: { spectators: spectator } },
    );
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run spectators`
Expected: PASS (all spectator specs, including the new one).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/persistence/game-store.ts apps/server/src/lobby/room.repo.ts apps/server/test/spectators.spec.ts
git commit -m "fix(server): spectating no longer bumps a game's purge clock"
```

---

### Task 2: Owners cannot spectate

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts` (`BecomeSpectatorResult` type ~L99-105, `becomeSpectator` ~L480-507)
- Modify: `apps/server/src/lobby/lobby.service.ts` (`becomeSpectator` ~L194-204, `spectateTicket` ~L354-369)
- Test: `apps/server/test/lobby.e2e.spec.ts`

**Interfaces:**
- Consumes: `RoomRepo.becomeSpectator` from Task 1's file.
- Produces: `becomeSpectator` returns a new `'is_host'` result; `LobbyService.spectateTicket` throws `403` for a seated member.

- [ ] **Step 1: Write the failing tests** — append this `describe` block to `apps/server/test/lobby.e2e.spec.ts`:

```ts
describe('lobby: host cannot spectate', () => {
  it('rejects the host demoting to spectator, but lets a non-host demote', async () => {
    const a = await guest('Ada');
    const b = await guest('Ben');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(a.token)).expect(400); // host
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200); // non-host
  });

  it('rejects a seated player minting a spectate ticket for their own game', async () => {
    const a = await guest('Cid');
    const b = await guest('Dot');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/ready`).set(auth(a.token)).send({ ready: true }).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/ready`).set(auth(b.token)).send({ ready: true }).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/spectate`).set(auth(a.token)).expect(403);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/server test --run lobby.e2e`
Expected: FAIL — host `/watch` returns 200, host `/spectate` returns 200.

- [ ] **Step 3: Add `'is_host'` to the result type** in `apps/server/src/lobby/room.repo.ts`:

```ts
export type BecomeSpectatorResult =
  | RoomDoc
  | 'not_found'
  | 'started'
  | 'not_member'
  | 'is_host'
  | 'only_member'
  | 'spectating_disabled';
```

- [ ] **Step 4: Guard the host and simplify `becomeSpectator`** in `apps/server/src/lobby/room.repo.ts` (host can never demote, so the old host-transfer branch and the `updatedAt` bump both go):

```ts
  async becomeSpectator(code: string, userId: string): Promise<BecomeSpectatorResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    const leaving = room.members.find((m) => m.userId === userId);
    if (!leaving) return 'not_member';
    if (room.hostId === userId) return 'is_host';
    if (room.members.length <= 1) return 'only_member';
    const settings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
    if (!settings.allowSpectating) return 'spectating_disabled';

    const remaining = room.members
      .filter((m) => m.userId !== userId)
      .map((m, i) => ({ ...m, seat: i }));
    const spectator: RoomSpectator = {
      userId: leaving.userId,
      displayName: leaving.displayName,
      isGuest: leaving.isGuest,
    };
    await this.col.updateOne(
      { _id: code },
      { $set: { members: remaining }, $push: { spectators: spectator } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }
```

- [ ] **Step 5: Map `'is_host'` in the service** — in `apps/server/src/lobby/lobby.service.ts` `becomeSpectator`, add after the `not_member` line:

```ts
    if (r === 'is_host') throw new BadRequestException('the host cannot spectate');
```

- [ ] **Step 6: Reject seated players from `spectateTicket`** — in `apps/server/src/lobby/lobby.service.ts`, add right after the `if (!room.gameId) throw …` line inside `spectateTicket`:

```ts
    if (this.seatOf(room, user.userId) >= 0) {
      throw new ForbiddenException('players cannot spectate their own game');
    }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run lobby.e2e`
Expected: PASS (new block + existing lobby specs, including the existing non-host `/watch` demote test).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/src/lobby/lobby.service.ts apps/server/test/lobby.e2e.spec.ts
git commit -m "feat(server): prohibit room owners from spectating"
```

---

### Task 3: Ownership transfer, room close, and a bot-safe host leave

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts` (add result types after `BecomePlayerResult` ~L106; `leave` ~L236-265; add `transferHost` + `closeRoom` methods)
- Modify: `apps/server/src/lobby/lobby.service.ts` (add `transferOwnership` + `closeRoom` after `leave` ~L177)
- Modify: `apps/server/src/lobby/lobby.controller.ts` (add two routes after `leave` ~L70)
- Test: `apps/server/test/lobby.e2e.spec.ts`

**Interfaces:**
- Produces:
  - `RoomRepo.transferHost(code, hostId, targetId): Promise<RoomDoc | 'not_found' | 'forbidden' | 'started' | 'invalid'>`
  - `RoomRepo.closeRoom(code, hostId): Promise<RoomDoc | 'not_found' | 'forbidden' | 'started'>`
  - `LobbyService.transferOwnership(code, user, targetId): Promise<RoomView>`; `LobbyService.closeRoom(code, user): Promise<RoomView>`
  - Routes `POST /api/v1/rooms/:code/transfer/:userId` and `POST /api/v1/rooms/:code/close`.
  - `RoomRepo.leave`: a host leaving now transfers to the first non-bot member, or closes the room if only bots remain.

- [ ] **Step 1: Write the failing tests** — append this `describe` block to `apps/server/test/lobby.e2e.spec.ts`:

```ts
describe('lobby: ownership transfer, close, and bot-safe leave', () => {
  it('transfers ownership to a seated member, keeping the old host seated', async () => {
    const a = await guest('Eve');
    const b = await guest('Fox');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    const res = await request(server()).post(`/api/v1/rooms/${code}/transfer/${b.id}`).set(auth(a.token)).expect(200);
    expect(res.body.hostId).toBe(b.id);
    expect(res.body.members.map((m: { userId: string }) => m.userId)).toContain(a.id);
  });

  it('rejects transfer by a non-host and to an invalid target', async () => {
    const a = await guest('Gil');
    const b = await guest('Hal');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/transfer/${a.id}`).set(auth(b.token)).expect(403);
    await request(server()).post(`/api/v1/rooms/${code}/transfer/nobody`).set(auth(a.token)).expect(400);
  });

  it('lets the host close the room for everyone', async () => {
    const a = await guest('Ivy');
    const b = await guest('Jon');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/close`).set(auth(b.token)).expect(403); // non-host
    const res = await request(server()).post(`/api/v1/rooms/${code}/close`).set(auth(a.token)).expect(200);
    expect(res.body.status).toBe('CLOSED');
  });

  it('closes the room when the host leaves with only bots remaining', async () => {
    const a = await guest('Kim');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/bots`).set(auth(a.token)).send({ difficulty: 'EASY' }).expect(200);
    const left = await request(server()).post(`/api/v1/rooms/${code}/leave`).set(auth(a.token)).expect(200);
    expect(left.body.status).toBe('CLOSED');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/server test --run lobby.e2e`
Expected: FAIL — the `transfer`/`close` routes 404, and the bots-only leave transfers host to the bot instead of closing.

- [ ] **Step 3: Add result types** in `apps/server/src/lobby/room.repo.ts` after `export type BecomePlayerResult = …;`:

```ts
export type TransferHostResult = RoomDoc | 'not_found' | 'forbidden' | 'started' | 'invalid';
export type CloseRoomResult = RoomDoc | 'not_found' | 'forbidden' | 'started';
```

- [ ] **Step 4: Make the host leave bot-safe** — replace the `else` branch of `leave` in `apps/server/src/lobby/room.repo.ts` (the block that currently computes `hostId` and `$set`s `members, hostId, updatedAt`) with:

```ts
    } else if (room.hostId === userId) {
      const nextHuman = remaining.find((m) => !m.isBot);
      if (!nextHuman) {
        // Host leaving a room with only bots left — close it (there is no such thing as a bot host).
        await this.col.updateOne(
          { _id: code },
          { $set: { status: 'CLOSED', members: [], updatedAt: new Date() } },
        );
      } else {
        await this.col.updateOne(
          { _id: code },
          { $set: { members: remaining, hostId: nextHuman.userId, updatedAt: new Date() } },
        );
      }
    } else {
      await this.col.updateOne(
        { _id: code },
        { $set: { members: remaining, updatedAt: new Date() } },
      );
    }
```

- [ ] **Step 5: Add `transferHost` + `closeRoom` methods** to `apps/server/src/lobby/room.repo.ts` (place them just after `becomeSpectator`):

```ts
  /** Host-only, LOBBY-only: hand ownership to another seated, non-bot member. */
  async transferHost(code: string, hostId: string, targetId: string): Promise<TransferHostResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';
    const target = room.members.find((m) => m.userId === targetId);
    if (!target || target.isBot || targetId === hostId) return 'invalid';
    await this.col.updateOne(
      { _id: code, hostId, status: 'LOBBY' },
      { $set: { hostId: targetId, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Host-only, LOBBY-only: close the room for everyone. CAS on LOBBY so a concurrent start wins. */
  async closeRoom(code: string, hostId: string): Promise<CloseRoomResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';
    await this.col.updateOne(
      { _id: code, hostId, status: 'LOBBY' },
      { $set: { status: 'CLOSED', updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }
```

- [ ] **Step 6: Add service methods** to `apps/server/src/lobby/lobby.service.ts` (after `leave`):

```ts
  /** Host-only: hand ownership to another seated member (they stay seated). */
  async transferOwnership(code: string, user: AuthUser, targetId: string): Promise<RoomView> {
    const r = await this.rooms.transferHost(code, user.userId, targetId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'forbidden') throw new ForbiddenException('only the host can transfer ownership');
    if (r === 'invalid') throw new BadRequestException('cannot transfer to that player');
    return toView(r);
  }

  /** Host-only: close the whole room. */
  async closeRoom(code: string, user: AuthUser): Promise<RoomView> {
    const r = await this.rooms.closeRoom(code, user.userId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'forbidden') throw new ForbiddenException('only the host can close the room');
    return toView(r);
  }
```

- [ ] **Step 7: Add controller routes** to `apps/server/src/lobby/lobby.controller.ts` (after the `leave` handler):

```ts
  @Post(':code/transfer/:userId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Host hands ownership to another seated member (LOBBY only)' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  transfer(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('userId') userId: string,
  ) {
    return this.lobby.transferOwnership(code.toUpperCase(), user, userId);
  }

  @Post(':code/close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Host closes the room for everyone (LOBBY only)' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  close(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.lobby.closeRoom(code.toUpperCase(), user);
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run lobby.e2e`
Expected: PASS (new block + existing specs; the existing "demoted spectator leave" and "host kicks a player" specs still pass).

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/lobby.controller.ts apps/server/test/lobby.e2e.spec.ts
git commit -m "feat(server): owner transfer/close endpoints + bot-safe host leave"
```

---

### Task 4: Lobby free-text chat (server)

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts` (`RoomChatEntry` ~L57-61, add `ROOM_CHAT_MAX_LEN`, `sendChat` ~L426-448)
- Modify: `apps/server/src/lobby/lobby.schemas.ts` (`ChatSchema` ~L11, `RoomChatEntrySchema` ~L47-51)
- Modify: `apps/server/src/lobby/lobby.service.ts` (`sendChat` ~L217-223, imports)
- Modify: `apps/server/src/lobby/lobby.controller.ts` (`sendChat` handler ~L115-117)
- Test: `apps/server/test/lobby.e2e.spec.ts`

**Interfaces:**
- Consumes: `RoomRepo` from Task 1–3's file.
- Produces:
  - `RoomChatEntry = { userId: string; ts: number; presetId?: string; text?: string }`; `export const ROOM_CHAT_MAX_LEN = 2048`.
  - `RoomRepo.sendChat(code, userId, entry: { presetId: ChatPresetId } | { text: string })`.
  - `LobbyService.sendChat(code, user, payload: { presetId?: ChatPresetId; text?: string })`.

- [ ] **Step 1: Write the failing test** — append to `apps/server/test/lobby.e2e.spec.ts`:

```ts
describe('lobby: free-text chat', () => {
  it('accepts free text, still accepts presets, and rejects empty / both / neither', async () => {
    const a = await guest('Lee');
    const room = await request(server()).post('/api/v1/rooms').set(auth(a.token)).send({}).expect(201);
    const code: string = room.body.code;
    const sent = await request(server())
      .post(`/api/v1/rooms/${code}/chat`).set(auth(a.token)).send({ text: 'hello there' }).expect(200);
    const last = sent.body.chat[sent.body.chat.length - 1];
    expect(last.text).toBe('hello there');
    expect(last.presetId).toBeUndefined();
    await request(server()).post(`/api/v1/rooms/${code}/chat`).set(auth(a.token)).send({ presetId: 'THANKS' }).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/chat`).set(auth(a.token)).send({ text: '   ' }).expect(400);
    await request(server()).post(`/api/v1/rooms/${code}/chat`).set(auth(a.token)).send({}).expect(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run lobby.e2e`
Expected: FAIL — `{ text }` is rejected by the current preset-only `ChatSchema` (400) so the first request never reaches 200.

- [ ] **Step 3: Widen the entry type + add the length cap** in `apps/server/src/lobby/room.repo.ts`. Replace the `RoomChatEntry` interface:

```ts
export interface RoomChatEntry {
  userId: string;
  ts: number;
  /** Exactly one of presetId / text is set. Legacy rows carry presetId. */
  presetId?: string;
  text?: string;
}
```

Add next to the other chat constants (near `ROOM_CHAT_CAP`):

```ts
export const ROOM_CHAT_MAX_LEN = 2048;
```

- [ ] **Step 4: Accept either shape in the repo `sendChat`** — replace its signature and push in `apps/server/src/lobby/room.repo.ts`:

```ts
  async sendChat(
    code: string,
    userId: string,
    entry: { presetId: ChatPresetId } | { text: string },
  ): Promise<SendChatResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    const isParticipant =
      room.members.some((m) => m.userId === userId) ||
      (room.spectators?.some((s) => s.userId === userId) ?? false);
    if (!isParticipant) return 'not_member';

    const now = Date.now();
    const recent = (room.chat ?? []).filter(
      (c) => c.userId === userId && now - c.ts < ROOM_CHAT_RATE_WINDOW_MS,
    );
    if (recent.length >= ROOM_CHAT_RATE_MAX) return 'rate_limited';

    await this.col.updateOne(
      { _id: code },
      {
        $push: { chat: { $each: [{ userId, ...entry, ts: now }], $slice: -ROOM_CHAT_CAP } },
        $set: { updatedAt: new Date() },
      },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }
```

- [ ] **Step 5: Widen the DTO + view schema** in `apps/server/src/lobby/lobby.schemas.ts`. Add the import and replace both schemas:

```ts
import { ROOM_CHAT_MAX_LEN } from './room.repo';
```

```ts
export const ChatSchema = z.object({
  presetId: z.enum(CHAT_PRESET_IDS).optional(),
  text: z.string().max(ROOM_CHAT_MAX_LEN).optional(),
});
```

```ts
export const RoomChatEntrySchema = z.object({
  userId: z.string(),
  ts: z.number(),
  presetId: z.string().optional(),
  text: z.string().optional(),
});
```

- [ ] **Step 6: Validate "exactly one" in the service** — replace `sendChat` in `apps/server/src/lobby/lobby.service.ts` (and add `ROOM_CHAT_MAX_LEN` to the existing `./room.repo` import list):

```ts
  /** Any room member sends a preset OR a free-text chat message (exactly one). */
  async sendChat(
    code: string,
    user: AuthUser,
    payload: { presetId?: ChatPresetId; text?: string },
  ): Promise<RoomView> {
    const hasPreset = payload.presetId !== undefined;
    const hasText = payload.text !== undefined;
    if (hasPreset === hasText) throw new BadRequestException('send exactly one of preset or text');
    let entry: { presetId: ChatPresetId } | { text: string };
    if (hasPreset) {
      entry = { presetId: payload.presetId! };
    } else {
      const text = payload.text!.trim();
      if (text.length === 0) throw new BadRequestException('empty chat message');
      if (text.length > ROOM_CHAT_MAX_LEN) throw new BadRequestException('chat too long');
      entry = { text };
    }
    const r = await this.rooms.sendChat(code, user.userId, entry);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'not_member') throw new ForbiddenException('not a member of this room');
    if (r === 'rate_limited') throw new BadRequestException('sending chat too fast');
    return toView(r);
  }
```

- [ ] **Step 7: Pass both fields from the controller** — in `apps/server/src/lobby/lobby.controller.ts`:

```ts
  sendChat(@CurrentUser() user: AuthUser, @Param('code') code: string, @Body() body: ChatDto) {
    return this.lobby.sendChat(code.toUpperCase(), user, {
      presetId: body.presetId,
      text: body.text,
    });
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `yarn workspace @trm/server test --run lobby.e2e`
Expected: PASS.

- [ ] **Step 9: Typecheck the server workspace**

Run: `yarn workspace @trm/server typecheck`
Expected: PASS (confirms the widened DTO/entry types line up).

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/src/lobby/lobby.schemas.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/lobby.controller.ts apps/server/test/lobby.e2e.spec.ts
git commit -m "feat(server): free-text lobby chat alongside presets"
```

---

### Task 5: Web — fix "spectate acts as a kick" + hide Watch from the host

**Files:**
- Modify: `apps/web/src/screens/RoomScreen.tsx` (poll branch ~L110-141; the seated-member button row ~L479-493)
- Test: `apps/web/src/screens/RoomScreen.test.tsx`

**Interfaces:**
- Consumes: existing `api.getRoom`, `useUi`, `useSession`.
- Produces: no exported changes — behavioural fix only.

- [ ] **Step 1: Add the failing tests + fix the now-invalid only-member test** in `apps/web/src/screens/RoomScreen.test.tsx`.

Replace the existing test `it('disables Spectate when the viewer is the only member', …)` (in `describe('RoomScreen spectating', …)`) with:

```ts
  it('hides Spectate from the host who is the only member', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [member('u-me')] }));
    render(<RoomScreen />);
    await screen.findByRole('button', { name: '我準備好了' });
    expect(screen.queryByRole('button', { name: '觀戰' })).toBeNull();
  });

  it('hides Spectate from the host even with other members present', async () => {
    const meHost = { userId: 'u-me', displayName: 'Me', isGuest: true, seat: 0, ready: false };
    const g1 = { userId: 'g1', displayName: 'g1', isGuest: false, seat: 1, ready: false };
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [meHost, g1] }));
    render(<RoomScreen />);
    await screen.findByText('g1');
    expect(screen.queryByRole('button', { name: '觀戰' })).toBeNull();
  });

  it('does not raise the kicked modal when the viewer demotes themselves to spectator', async () => {
    vi.useFakeTimers();
    try {
      mocked.getRoom
        .mockResolvedValueOnce(room({ members: [member('host'), member('u-me')] }))
        .mockResolvedValue(
          room({
            members: [member('host')],
            spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
          }),
        );
      render(<RoomScreen />);
      await vi.advanceTimersByTimeAsync(100); // first poll: seated
      await vi.advanceTimersByTimeAsync(2100); // next poll: now a spectator — must NOT look like a kick
      expect(useUi.getState().view).toBe('room');
      expect(screen.queryByRole('button', { name: '返回首頁' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: FAIL — the host still shows a 觀戰 button and the self-demote poll raises the kicked modal (`返回首頁` present).

- [ ] **Step 3: Reorder the poll's non-member branch** in `apps/web/src/screens/RoomScreen.tsx` — replace the whole `if (!r.members.some((m) => m.userId === user?.id)) { … }` block (currently lines ~110-141) with:

```tsx
        if (!r.members.some((m) => m.userId === user?.id)) {
          // Spectators (arrived watching OR demoted themselves from a seat) are legitimately
          // absent from `members`; only vanishing from BOTH lists is a kick.
          const amSpectator = r.spectators.some((s) => s.userId === user?.id);
          if (wasPresent && !amSpectator) {
            active = false;
            if (r.status === 'LOBBY') setKicked(true);
            else goHome();
            return;
          }
          if (r.status !== 'LOBBY') {
            // A started game we aren't seated in can't be joined — spectate if allowed (this
            // carries a demoted lobby spectator into watching once the game starts); else bail home.
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
          // A lobby non-member who isn't a spectator joins a seat once; a demoted spectator
          // falls through to keep watching the lobby (never auto-rejoined onto a seat).
          if (!amSpectator) {
            r = await api.joinRoom(code);
            if (!active) return;
          }
        }
```

- [ ] **Step 4: Hide the Watch button from the host** in `apps/web/src/screens/RoomScreen.tsx` — replace the `{me && ( … ready + watch … )}` block (~L480-493) with a ready button for all seated members and a Watch button only for non-hosts:

```tsx
          {me && (
            <button className={me.ready ? 'danger' : 'success'} onClick={toggleReady}>
              {me.ready ? t('cancelReady') : t('markReady')}
            </button>
          )}
          {me && !isHost && (
            <button
              onClick={() => void becomeSpectator()}
              disabled={room.members.length <= 1}
              title={room.members.length <= 1 ? t('spectateDisabledOnlyMember') : undefined}
            >
              {t('watch')}
            </button>
          )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS (new tests + existing RoomScreen specs — note the existing "does not re-join a lobby spectator on subsequent polls" and "shows an enabled Spectate button …" specs still pass, since that viewer is a non-host).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx
git commit -m "fix(web): self-demote to spectator no longer reads as a kick; hide Watch from host"
```

---

### Task 6: Web — free-text lobby chat input

**Files:**
- Modify: `apps/web/src/net/rest.ts` (`RoomChatEntry` ~L68-72, `sendRoomChat` ~L340-341)
- Modify: `apps/web/src/screens/RoomScreen.tsx` (`sendChat` ~L240; `chatDraft` state near ~L64; chat panel render ~L552-575)
- Test: `apps/web/src/screens/RoomScreen.test.tsx` (update the existing preset test + `baseRoom` chat type; add a free-text test)

**Interfaces:**
- Consumes: server free-text chat from Task 4.
- Produces: `api.sendRoomChat(code, payload: { presetId: string } | { text: string })`; `RoomChatEntry` gains optional `text`, `presetId` optional.

- [ ] **Step 1: Update tests** in `apps/web/src/screens/RoomScreen.test.tsx`.

(a) In `baseRoom`, widen the `chat` field type:

```ts
  chat: [] as { userId: string; presetId?: string; text?: string; ts: number }[],
```

(b) In `describe('RoomScreen preset chat', …)`, update the first test's assertion from `toHaveBeenCalledWith('ABCD', 'GOOD_LUCK')` to:

```ts
    expect(api.sendRoomChat).toHaveBeenCalledWith('ABCD', { presetId: 'GOOD_LUCK' });
```

(c) Append a free-text test to the same `describe`:

```ts
  it('sends a free-text message from the input box and renders it', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    (api.sendRoomChat as ReturnType<typeof vi.fn>).mockResolvedValue(
      room({ members: [member('host'), member('u-me')], chat: [{ userId: 'u-me', text: 'gg wp', ts: 1 }] }),
    );
    const { container } = render(<RoomScreen />);
    const input = await screen.findByPlaceholderText('輸入訊息…');
    fireEvent.change(input, { target: { value: 'gg wp' } });
    fireEvent.click(screen.getByRole('button', { name: '傳送' }));
    expect(api.sendRoomChat).toHaveBeenCalledWith('ABCD', { text: 'gg wp' });
    await waitFor(() =>
      expect(container.querySelector('.chat-messages .chat-msg')?.textContent).toContain('gg wp'),
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: FAIL — no `輸入訊息…` input exists yet, and the preset call is still `('ABCD', 'GOOD_LUCK')`.

- [ ] **Step 3: Update the REST client** in `apps/web/src/net/rest.ts`. Replace the `RoomChatEntry` interface:

```ts
export interface RoomChatEntry {
  userId: string;
  ts: number;
  presetId?: string;
  text?: string;
}
```

Replace `sendRoomChat`:

```ts
  sendRoomChat: (code: string, payload: { presetId: string } | { text: string }) =>
    req<RoomView>('POST', `/rooms/${code}/chat`, payload),
```

- [ ] **Step 4: Wire the input in `RoomScreen`** in `apps/web/src/screens/RoomScreen.tsx`.

(a) Add draft state next to the other `useState` calls (near `const [room, setRoom] = useState…`):

```tsx
  const [chatDraft, setChatDraft] = useState('');
```

(b) Change the preset sender to send the object shape (~L240):

```tsx
  const sendChat = (presetId: string) => void guard(api.sendRoomChat(code, { presetId }));
```

(c) In the chat panel, render `text` when present and add the input form. Replace the `.chat-messages` map line that renders the preset with:

```tsx
                  <span className="chat-text">
                    {c.text ?? t(chatPresetKey(c.presetId ?? ''))}
                  </span>
```

and, immediately after the closing `</div>` of `.chat-presets` (before `</section>`), add:

```tsx
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              const text = chatDraft.trim();
              if (!text) return;
              setChatDraft('');
              void guard(api.sendRoomChat(code, { text }));
            }}
          >
            <input
              type="text"
              maxLength={2048}
              value={chatDraft}
              placeholder={t('chat.placeholder')}
              onChange={(e) => setChatDraft(e.target.value)}
            />
            <button type="submit" disabled={chatDraft.trim().length === 0}>
              {t('chat.send')}
            </button>
          </form>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx
git commit -m "feat(web): free-text input in the lobby chat"
```

---

### Task 7: Web — owner leave (transfer-or-close) dialog

**Files:**
- Create: `apps/web/src/components/OwnerLeaveDialog.tsx`
- Modify: `apps/web/src/net/rest.ts` (add `transferOwnership`, `closeRoom` near `watchRoom` ~L336-337)
- Modify: `apps/web/src/i18n/index.ts` (add 7 keys to zh after `leaveConfirmBody` ~L211, and the same to en after `leaveConfirmBody` ~L727)
- Modify: `apps/web/src/screens/RoomScreen.tsx` (import dialog; `otherHumans`; a second `useConfirmAction`; leave handlers; render)
- Test: `apps/web/src/screens/RoomScreen.test.tsx` (add `transferOwnership`/`closeRoom` to the mock; two new tests)

**Interfaces:**
- Consumes: server transfer/close from Task 3; `RoomMember` type from `net/rest`.
- Produces: `OwnerLeaveDialog` component; `api.transferOwnership(code, userId)`, `api.closeRoom(code)`.

- [ ] **Step 1: Write the failing tests** in `apps/web/src/screens/RoomScreen.test.tsx`.

(a) Add `transferOwnership` and `closeRoom` to the `api` object inside the `vi.mock('../net/rest', …)` factory (alongside `sendRoomChat`):

```ts
      transferOwnership: vi.fn(),
      closeRoom: vi.fn(),
```

(b) Append this `describe` block:

```ts
describe('RoomScreen owner leave', () => {
  const meHost = { userId: 'u-me', displayName: 'Me', isGuest: true, seat: 0, ready: false };
  const human = { userId: 'g1', displayName: 'Guest', isGuest: true, seat: 1, ready: false };

  it('prompts to transfer or close, then transfers ownership and leaves', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [meHost, human] }));
    (api.transferOwnership as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (api.leaveRoom as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<RoomScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '離開房間' }));
    fireEvent.click(screen.getByRole('button', { name: '移轉並離開' }));
    await waitFor(() => expect(api.transferOwnership).toHaveBeenCalledWith('ABCD', 'g1'));
    await waitFor(() => expect(api.leaveRoom).toHaveBeenCalledWith('ABCD'));
    expect(useUi.getState().view).toBe('home');
  });

  it('closes the room when the owner leaves with only bots present', async () => {
    const bot = { userId: 'bot:1', displayName: 'Bot-EASY', isGuest: false, seat: 1, ready: true, isBot: true };
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [meHost, bot] }));
    (api.closeRoom as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<RoomScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '離開房間' }));
    fireEvent.click(screen.getByRole('button', { name: '確認' })); // close-room confirmation
    await waitFor(() => expect(api.closeRoom).toHaveBeenCalledWith('ABCD'));
    expect(useUi.getState().view).toBe('home');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: FAIL — clicking Leave as host still opens the plain leave confirm; `移轉並離開` button not found.

- [ ] **Step 3: Add REST methods** in `apps/web/src/net/rest.ts` (next to `watchRoom`/`rejoinRoom`):

```ts
  transferOwnership: (code: string, userId: string) =>
    req<RoomView>('POST', `/rooms/${code}/transfer/${encodeURIComponent(userId)}`),
  closeRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/close`),
```

- [ ] **Step 4: Add i18n keys.** In `apps/web/src/i18n/index.ts`, after the zh `leaveConfirmBody: '確定要離開嗎？',` line insert:

```ts
      ownerLeaveTitle: '離開房間',
      ownerLeaveBody: '你是房主。請先將房主移轉給其他玩家再離開，或直接關閉整個房間。',
      selectNewOwner: '選擇新房主',
      transferAndLeave: '移轉並離開',
      closeRoom: '關閉房間',
      closeRoomConfirmTitle: '關閉房間？',
      closeRoomConfirmBody: '這會將所有人移出並關閉房間，確定嗎？',
```

After the en `leaveConfirmBody: 'Are you sure you want to leave?',` line insert:

```ts
      ownerLeaveTitle: 'Leave room',
      ownerLeaveBody:
        "You're the room owner. Transfer ownership to another player before leaving, or close the whole room.",
      selectNewOwner: 'Choose a new owner',
      transferAndLeave: 'Transfer & leave',
      closeRoom: 'Close room',
      closeRoomConfirmTitle: 'Close room?',
      closeRoomConfirmBody: 'This removes everyone and closes the room. Are you sure?',
```

- [ ] **Step 5: Create the dialog** at `apps/web/src/components/OwnerLeaveDialog.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomMember } from '../net/rest';

interface OwnerLeaveDialogProps {
  candidates: RoomMember[];
  onTransfer: (userId: string) => void;
  onClose: () => void;
  onCancel: () => void;
}

/** Shown when the room owner leaves with other human players present: hand ownership to a
 *  chosen member (then leave), or close the whole room for everyone. */
export function OwnerLeaveDialog({
  candidates,
  onTransfer,
  onClose,
  onCancel,
}: OwnerLeaveDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>(candidates[0]?.userId ?? '');

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-leave-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="owner-leave-title">{t('ownerLeaveTitle')}</h3>
        <p>{t('ownerLeaveBody')}</p>
        <fieldset className="stack">
          <legend>{t('selectNewOwner')}</legend>
          {candidates.map((m) => (
            <label key={m.userId} className="row">
              <input
                type="radio"
                name="new-owner"
                value={m.userId}
                checked={selected === m.userId}
                onChange={() => setSelected(m.userId)}
              />
              <span>{m.displayName}</span>
            </label>
          ))}
        </fieldset>
        <div className="row">
          <button type="button" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="button" className="danger" onClick={onClose}>
            {t('closeRoom')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!selected}
            onClick={() => onTransfer(selected)}
          >
            {t('transferAndLeave')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire the leave flow in `RoomScreen`** in `apps/web/src/screens/RoomScreen.tsx`.

(a) Add the import (next to the `ConfirmDialog` import):

```tsx
import { OwnerLeaveDialog } from '../components/OwnerLeaveDialog';
```

(b) Add a second confirm-action and dialog-open state near the existing `useConfirmAction()` destructure:

```tsx
  const {
    open: closeOpen,
    request: requestClose,
    confirm: confirmClose,
    cancel: cancelClose,
  } = useConfirmAction();
  const [ownerLeaveOpen, setOwnerLeaveOpen] = useState(false);
```

(c) Add derived list + handlers near the existing `leave` function:

```tsx
  const otherHumans = room.members.filter((m) => m.userId !== user?.id && !m.isBot);
  const closeAndGoHome = async () => {
    await api.closeRoom(code).catch(() => undefined);
    goHome();
  };
  const transferAndLeave = async (targetId: string) => {
    setOwnerLeaveOpen(false);
    await api.transferOwnership(code, targetId).catch(() => undefined);
    await api.leaveRoom(code).catch(() => undefined);
    goHome();
  };
  const onLeaveClick = () => {
    if (!isHost) {
      requestLeave(() => void leave());
    } else if (otherHumans.length === 0) {
      requestClose(() => void closeAndGoHome());
    } else {
      setOwnerLeaveOpen(true);
    }
  };
```

(d) Point the Leave button at `onLeaveClick` — replace the existing leave button:

```tsx
          <button onClick={onLeaveClick}>{t('leave')}</button>
```

(e) Render the two new dialogs next to the existing `{leaveOpen && (<ConfirmDialog … />)}` block:

```tsx
        {closeOpen && (
          <ConfirmDialog
            title={t('closeRoomConfirmTitle')}
            message={t('closeRoomConfirmBody')}
            onConfirm={confirmClose}
            onCancel={cancelClose}
          />
        )}
        {ownerLeaveOpen && (
          <OwnerLeaveDialog
            candidates={otherHumans}
            onTransfer={(id) => void transferAndLeave(id)}
            onClose={() => void closeAndGoHome()}
            onCancel={() => setOwnerLeaveOpen(false)}
          />
        )}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS (new owner-leave block + existing non-host leave-confirmation specs).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/OwnerLeaveDialog.tsx apps/web/src/net/rest.ts apps/web/src/i18n/index.ts apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx
git commit -m "feat(web): owner leave prompts to transfer ownership or close the room"
```

---

### Task 8: Full verification + graph refresh

**Files:** none (verification only).

- [ ] **Step 1: Typecheck everything**

Run: `yarn typecheck`
Expected: PASS across all workspaces.

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: PASS (no new errors).

- [ ] **Step 3: Full test suite**

Run: `yarn test`
Expected: PASS across all workspaces.

- [ ] **Step 4: Format gate**

Run: `yarn format:check`
Expected: PASS. If it fails, run `yarn format` and re-check, then include the reformat in the final commit.

- [ ] **Step 5: Refresh the knowledge graph**

Run: `graphify update .`
Expected: completes (AST-only, no API cost). Do not commit `graphify-out/` unless your session is the one that owns those changes.

- [ ] **Step 6: Commit any format-only fixups** (only if Step 4 required a reformat)

```bash
git add <reformatted files>
git commit -m "style: prettier formatting"
```

---

## Self-Review notes

- **Spec coverage:** Part 1 → Task 2 (+ Task 5 UI hide); Part 2 → Task 3 (+ Task 7 UI); Part 3 → Task 5 poll fix; Part 4 → Task 4 (server) + Task 6 (web); Part 5 → Task 1 (game/record) + Task 2 (`becomeSpectator` drops `updatedAt`). All five parts covered.
- **Type consistency:** `becomeSpectator` result `'is_host'` defined (Task 2) and consumed (Task 2 service). `transferHost`/`closeRoom` result unions defined (Task 3) and consumed by the service (Task 3). `RoomChatEntry`/`sendChat({ presetId } | { text })` defined in Task 4 and mirrored on the web in Task 6. `api.transferOwnership`/`api.closeRoom`/`api.sendRoomChat` shapes match between `net/rest.ts` and the RoomScreen call sites.
- **No placeholders:** every code and test step is complete; no TBD/TODO.
