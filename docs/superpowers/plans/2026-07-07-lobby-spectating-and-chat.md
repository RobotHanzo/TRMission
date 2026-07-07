# Lobby Spectating + Spectator Chat + Lobby Chat Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a seated lobby member demote to spectating (and rejoin later), let spectators chat in both the lobby and in-game, and restyle the lobby chat panel to visually match the in-game one.

**Architecture:** `RoomDoc` gains a `spectators` list that unifies the previously-disjoint pre-start (lobby demote) and post-start (spectate-ticket) spectating paths. Two new lobby REST endpoints (`watch`/`rejoin`) move a caller between `members` and `spectators`; existing `leave`/`kick`/lobby-chat widen to recognize spectators too. The in-game hub drops its seat-based chat exclusion and fans chat out to spectators as well. The web client's roster store learns about spectators so their chat messages render with a real name instead of "P1", and the lobby screen gains a Spectate/Join-as-player button pair plus a right-hand chat column that reuses the in-game `ChatPanel`'s CSS classes.

**Tech Stack:** NestJS + MongoDB (native driver) + zod (`apps/server`), React + Zustand + vitest/Testing-Library (`apps/web`), supertest for server e2e.

## Global Constraints

- No `.proto`/wire changes — `Chat`/`ChatBroadcast`/`ChatEntry`/`HistoryReplay` already carry what's needed.
- Lobby chat stays preset-only (no free text) — only *who* may send/receive widens, not *what*.
- Demoting requires `room.members.length > 1` and `settings.allowSpectating === true`.
- Never use `git add -A`/`git add .` — stage only the files each step actually touches.
- Server tests are integration-style (supertest against the full Nest app via `createTestApp()`, or direct `GameHub` instantiation for ws-level tests) — this codebase has no isolated `RoomRepo` unit tests; follow that convention rather than introducing a new one.

---

### Task 1: Lobby demote/rejoin endpoints (`watch` / `rejoin`)

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts`
- Modify: `apps/server/src/lobby/lobby.service.ts`
- Modify: `apps/server/src/lobby/lobby.controller.ts`
- Modify: `apps/server/src/lobby/lobby.schemas.ts`
- Test: `apps/server/test/lobby-demote.e2e.spec.ts` (new)

**Interfaces:**
- Produces: `RoomRepo.becomeSpectator(code: string, userId: string): Promise<RoomDoc | 'not_found' | 'started' | 'not_member' | 'only_member' | 'spectating_disabled'>`; `RoomRepo.becomePlayer(code: string, userId: string): Promise<RoomDoc | 'not_found' | 'started' | 'not_spectator' | 'full'>`; `RoomRepo.recordSpectator(code: string, spectator: RoomSpectator): Promise<void>` (idempotent add-if-absent, consumed by Task 4); `RoomDoc.spectators?: RoomSpectator[]`; `RoomView.spectators: RoomSpectator[]`; `POST /api/v1/rooms/:code/watch` and `POST /api/v1/rooms/:code/rejoin`, both returning `RoomView`.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/lobby-demote.e2e.spec.ts`:

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

describe('lobby: demote to spectator / rejoin as player', () => {
  it('lets a seated member demote, freeing and renumbering the seat', async () => {
    const a = await guest('Ada');
    const b = await guest('Bo');
    const c = await guest('Cy');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);

    const demoted = await request(server())
      .post(`/api/v1/rooms/${code}/watch`)
      .set(auth(b.token))
      .expect(200);
    expect(demoted.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id, c.id]);
    expect(demoted.body.members.map((m: { seat: number }) => m.seat)).toEqual([0, 1]);
    expect(demoted.body.spectators).toEqual([{ userId: b.id, displayName: 'Bo', isGuest: true }]);
  });

  it('transfers host when the host demotes', async () => {
    const a = await guest('Ada2');
    const b = await guest('Bo2');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const demoted = await request(server())
      .post(`/api/v1/rooms/${code}/watch`)
      .set(auth(a.token))
      .expect(200);
    expect(demoted.body.hostId).toBe(b.id);
    expect(demoted.body.members.map((m: { userId: string }) => m.userId)).toEqual([b.id]);
  });

  it("blocks demoting the room's only member", async () => {
    const a = await guest('Solo');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(a.token)).expect(400);
  });

  it('blocks demoting when the room disables spectating', async () => {
    const a = await guest('Ada3');
    const b = await guest('Bo3');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ allowSpectating: false })
      .expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(400);
  });

  it('blocks watch from a non-member, and rejoin from a non-spectator', async () => {
    const a = await guest('Ada4');
    const outsider = await guest('Out');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(outsider.token)).expect(403);
    await request(server())
      .post(`/api/v1/rooms/${code}/rejoin`)
      .set(auth(outsider.token))
      .expect(403);
  });

  it('lets a spectator rejoin an open seat', async () => {
    const a = await guest('Ada5');
    const b = await guest('Bo5');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200);

    const rejoined = await request(server())
      .post(`/api/v1/rooms/${code}/rejoin`)
      .set(auth(b.token))
      .expect(200);
    expect(rejoined.body.spectators).toEqual([]);
    expect(rejoined.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id, b.id]);
  });

  it('blocks rejoin once the freed seat has been retaken', async () => {
    const a = await guest('Ada6');
    const b = await guest('Bo6');
    const c = await guest('Cy6');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({ maxPlayers: 2 })
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);

    await request(server()).post(`/api/v1/rooms/${code}/rejoin`).set(auth(b.token)).expect(400);
  });

  it('blocks demote/rejoin once the game has started', async () => {
    const a = await guest('Ada7');
    const b = await guest('Bo7');
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
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);

    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/server test --run lobby-demote`
Expected: FAIL — `404`/`Cannot POST` on `/watch` and `/rejoin` (routes don't exist yet).

- [ ] **Step 3: Add the data model + repo methods**

In `apps/server/src/lobby/room.repo.ts`, add after the `RoomChatEntry` interface (right before `export interface RoomDoc`):

```ts
export interface RoomSpectator {
  userId: string;
  displayName: string;
  isGuest: boolean;
}
```

Add a field to `RoomDoc` (right after `chat?: RoomChatEntry[];`):

```ts
  /** Anyone watching this room's game — populated by a lobby demote (below) or by minting a
   *  post-start spectate ticket (`LobbyService.spectateTicket`). One list for both paths, so
   *  a spectator's identity is known regardless of how they came to be watching. */
  spectators?: RoomSpectator[];
```

Add new result types next to the existing ones (after `export type SendChatResult = ...`):

```ts
export type BecomeSpectatorResult =
  | RoomDoc
  | 'not_found'
  | 'started'
  | 'not_member'
  | 'only_member'
  | 'spectating_disabled';
export type BecomePlayerResult = RoomDoc | 'not_found' | 'started' | 'not_spectator' | 'full';
```

Add three new methods at the end of the class, right before the closing `}` (after `resetToLobby`):

```ts
  /** A seated member gives up their seat to watch instead: everything but their identity moves
   *  out of `members` into `spectators` — seats renumber and host transfers exactly like
   *  `leave()` already does. Blocked if they're the room's only member (nothing left to seat)
   *  or spectating is disabled (they'd be orphaned the moment the game actually starts). */
  async becomeSpectator(code: string, userId: string): Promise<BecomeSpectatorResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    const leaving = room.members.find((m) => m.userId === userId);
    if (!leaving) return 'not_member';
    if (room.members.length <= 1) return 'only_member';
    const settings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
    if (!settings.allowSpectating) return 'spectating_disabled';

    const remaining = room.members
      .filter((m) => m.userId !== userId)
      .map((m, i) => ({ ...m, seat: i }));
    const hostId = room.hostId === userId ? (remaining[0]?.userId ?? room.hostId) : room.hostId;
    const spectator: RoomSpectator = {
      userId: leaving.userId,
      displayName: leaving.displayName,
      isGuest: leaving.isGuest,
    };
    await this.col.updateOne(
      { _id: code },
      {
        $set: { members: remaining, hostId, updatedAt: new Date() },
        $push: { spectators: spectator },
      },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** A spectator takes an open seat back. Atomic seat-CAS retry loop, same shape as `join()`. */
  async becomePlayer(code: string, userId: string): Promise<BecomePlayerResult> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const room = await this.col.findOne({ _id: code });
      if (!room) return 'not_found';
      if (room.status !== 'LOBBY') return 'started';
      const spectator = room.spectators?.find((s) => s.userId === userId);
      if (!spectator) return 'not_spectator';
      if (room.members.length >= room.maxPlayers) return 'full';

      const seat = room.members.length;
      const member: RoomMember = { ...spectator, seat, ready: false };
      const res = await this.col.updateOne(
        { _id: code, status: 'LOBBY', members: { $size: seat }, 'spectators.userId': userId },
        {
          $push: { members: member },
          $pull: { spectators: { userId } },
          $set: { updatedAt: new Date() },
        },
      );
      if (res.modifiedCount === 1) {
        const updated = await this.col.findOne({ _id: code });
        if (updated) return updated;
      }
    }
    throw new Error('becomePlayer contention');
  }

  /** Idempotent: records a spectator identity if not already present. Called both indirectly
   *  (via `becomeSpectator`, above) and directly by `LobbyService.spectateTicket` (Task 4), so
   *  every path that watches a room's game ends up in the one list. */
  async recordSpectator(code: string, spectator: RoomSpectator): Promise<void> {
    await this.col.updateOne(
      { _id: code, 'spectators.userId': { $ne: spectator.userId } },
      { $push: { spectators: spectator }, $set: { updatedAt: new Date() } },
    );
  }
```

- [ ] **Step 4: Widen `LobbyService`**

In `apps/server/src/lobby/lobby.service.ts`, add `spectators` to the `RoomView` interface and `toView`:

```ts
export interface RoomView {
  code: string;
  hostId: string;
  status: RoomDoc['status'];
  maxPlayers: number;
  members: RoomMember[];
  spectators: RoomSpectator[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
  chat: RoomChatEntry[];
}
```

```ts
const toView = (r: RoomDoc): RoomView => {
  const settings = { ...DEFAULT_ROOM_SETTINGS, ...r.settings };
  const mapName = mapNameFor(settings.map);
  return {
    code: r._id,
    hostId: r.hostId,
    status: r.status,
    maxPlayers: r.maxPlayers,
    members: r.members,
    spectators: r.spectators ?? [],
    settings,
    ...(r.gameId ? { gameId: r.gameId } : {}),
    ...(mapName ? { mapName } : {}),
    chat: r.chat ?? [],
  };
};
```

Add `RoomSpectator` to the import from `./room.repo` (alongside `RoomChatEntry`):

```ts
import {
  RoomRepo,
  DEFAULT_ROOM_SETTINGS,
  type MapSelector,
  type RoomDoc,
  type RoomMember,
  type RoomSettings,
  type RoomSettingsPatch,
  type RoomChatEntry,
  type RoomSpectator,
} from './room.repo';
```

Add two new service methods, right after `voteRematch` (before `sendChat`):

```ts
  /** A seated member demotes to spectating. */
  async becomeSpectator(code: string, user: AuthUser): Promise<RoomView> {
    const r = await this.rooms.becomeSpectator(code, user.userId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'not_member') throw new ForbiddenException('not a member of this room');
    if (r === 'only_member') throw new BadRequestException('cannot spectate as the only member');
    if (r === 'spectating_disabled') {
      throw new BadRequestException('spectating is disabled for this room');
    }
    return toView(r);
  }

  /** A spectator takes an open seat. */
  async becomePlayer(code: string, user: AuthUser): Promise<RoomView> {
    const r = await this.rooms.becomePlayer(code, user.userId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'not_spectator') throw new ForbiddenException('not a spectator of this room');
    if (r === 'full') throw new BadRequestException('room is full');
    return toView(r);
  }
```

- [ ] **Step 5: Add the two controller routes**

In `apps/server/src/lobby/lobby.controller.ts`, add right after the `rematchVote` route (before `sendChat`):

```ts
  @Post(':code/watch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Seated member gives up their seat to spectate instead (LOBBY only)' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  watch(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.lobby.becomeSpectator(code.toUpperCase(), user);
  }

  @Post(':code/rejoin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Spectator takes an open seat to become a player (LOBBY only)' })
  @ApiResponse({ status: 200, schema: apiSchema(RoomViewSchema) })
  rejoin(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.lobby.becomePlayer(code.toUpperCase(), user);
  }
```

- [ ] **Step 6: Widen the zod schema**

In `apps/server/src/lobby/lobby.schemas.ts`, add after `RoomChatEntrySchema`:

```ts
export const RoomSpectatorSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
});
```

Add `spectators` to `RoomViewSchema`:

```ts
export const RoomViewSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  status: z.enum(['LOBBY', 'STARTED', 'CLOSED']),
  maxPlayers: z.number(),
  members: z.array(RoomMemberSchema),
  spectators: z.array(RoomSpectatorSchema),
  settings: GameSettingsSchema,
  gameId: z.string().optional(),
  /** Resolved display name for settings.map, when known (e.g. an official map). */
  mapName: z.object({ zh: z.string(), en: z.string() }).optional(),
  /** Capped, preset-only chat for the lobby (empty for a game already in progress). */
  chat: z.array(RoomChatEntrySchema),
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run lobby-demote`
Expected: PASS (8 tests)

- [ ] **Step 8: Typecheck the server workspace**

Run: `yarn workspace @trm/server typecheck`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/lobby.controller.ts apps/server/src/lobby/lobby.schemas.ts apps/server/test/lobby-demote.e2e.spec.ts
git commit -m "feat(server): let a lobby member demote to spectating and rejoin a seat"
```

---

### Task 2: Widen `leave`/`kick` to recognize spectators

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts`
- Modify: `apps/server/test/lobby.e2e.spec.ts`

**Interfaces:**
- Consumes: `RoomDoc.spectators` (Task 1).
- Produces: `RoomRepo.leave`/`RoomRepo.kick` now also remove a target from `spectators` when they aren't a seated member.

- [ ] **Step 1: Write the failing e2e tests**

In `apps/server/test/lobby.e2e.spec.ts`, add a new `describe` block at the end of the file (after the existing `'lobby → game → history (end to end)'` block):

```ts
describe('lobby: spectator leave + kick', () => {
  it('lets a demoted spectator leave without affecting the seated members', async () => {
    const a = await guest('Ivy');
    const b = await guest('Jax');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200);

    const left = await request(server())
      .post(`/api/v1/rooms/${code}/leave`)
      .set(auth(b.token))
      .expect(200);
    expect(left.body.spectators).toEqual([]);
    expect(left.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id]);
  });

  it('lets the host remove a spectator', async () => {
    const a = await guest('Kim');
    const b = await guest('Lee');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200);

    const kicked = await request(server())
      .post(`/api/v1/rooms/${code}/kick/${b.id}`)
      .set(auth(a.token))
      .expect(200);
    expect(kicked.body.spectators).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/server test --run lobby.e2e`
Expected: FAIL — both new tests fail (leave/kick currently ignore `spectators`, so the spectator is still present, or `kick` 400s with `'invalid'` since the target isn't in `members`).

- [ ] **Step 3: Widen `leave`**

In `apps/server/src/lobby/room.repo.ts`, replace the `leave` method body:

```ts
  /** Leave a LOBBY room: a spectator just drops off `spectators`; a seated member drops the
   *  member, keeps seats contiguous, and transfers host or closes exactly as before. */
  async leave(code: string, userId: string): Promise<RoomDoc | null> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return null;
    if (room.status !== 'LOBBY') return room;

    if (room.spectators?.some((s) => s.userId === userId)) {
      await this.col.updateOne(
        { _id: code },
        { $pull: { spectators: { userId } }, $set: { updatedAt: new Date() } },
      );
      return this.col.findOne({ _id: code });
    }

    const remaining = room.members
      .filter((m) => m.userId !== userId)
      .map((m, i) => ({ ...m, seat: i }));
    if (remaining.length === 0) {
      await this.col.updateOne(
        { _id: code },
        { $set: { status: 'CLOSED', members: [], updatedAt: new Date() } },
      );
    } else {
      const hostId = room.hostId === userId ? (remaining[0]?.userId ?? room.hostId) : room.hostId;
      await this.col.updateOne(
        { _id: code },
        { $set: { members: remaining, hostId, updatedAt: new Date() } },
      );
    }
    return this.col.findOne({ _id: code });
  }
```

- [ ] **Step 4: Widen `kick`**

Replace the `kick` method body:

```ts
  /** Host-only: remove another member or spectator (human or bot) and keep seats contiguous.
   *  The host cannot kick themselves — leaving is a separate, host-transferring path. */
  async kick(code: string, hostId: string, targetId: string): Promise<KickResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';
    if (targetId === hostId) return 'invalid';

    if (room.spectators?.some((s) => s.userId === targetId)) {
      await this.col.updateOne(
        { _id: code },
        { $pull: { spectators: { userId: targetId } }, $set: { updatedAt: new Date() } },
      );
      return (await this.col.findOne({ _id: code })) ?? 'not_found';
    }

    if (!room.members.some((m) => m.userId === targetId)) return 'invalid';
    const remaining = room.members
      .filter((m) => m.userId !== targetId)
      .map((m, i) => ({ ...m, seat: i }));
    await this.col.updateOne(
      { _id: code },
      { $set: { members: remaining, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @trm/server test --run lobby.e2e`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/test/lobby.e2e.spec.ts
git commit -m "feat(server): let leave/kick target a lobby spectator, not just a seated member"
```

---

### Task 3: Widen lobby preset chat to spectators

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts`
- Modify: `apps/server/test/lobby-chat.e2e.spec.ts`

**Interfaces:**
- Consumes: `RoomDoc.spectators` (Task 1).
- Produces: `RoomRepo.sendChat` accepts a caller who is a spectator, not just a seated member.

- [ ] **Step 1: Write the failing test**

In `apps/server/test/lobby-chat.e2e.spec.ts`, add inside the `describe('lobby: preset chat', ...)` block, after the last existing `it(...)`:

```ts
  it('lets a demoted spectator send a preset message too', async () => {
    const a = await guest('Mo');
    const b = await guest('Nia');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server()).post(`/api/v1/rooms/${code}/watch`).set(auth(b.token)).expect(200);

    const sent = await request(server())
      .post(`/api/v1/rooms/${code}/chat`)
      .set(auth(b.token))
      .send({ presetId: 'THANKS' })
      .expect(200);
    expect(sent.body.chat[0]).toMatchObject({ userId: b.id, presetId: 'THANKS' });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/server test --run lobby-chat`
Expected: FAIL — `403` (spectator currently rejected as `not_member`)

- [ ] **Step 3: Widen the membership check**

In `apps/server/src/lobby/room.repo.ts`, replace the guard line inside `sendChat`:

```ts
  async sendChat(code: string, userId: string, presetId: ChatPresetId): Promise<SendChatResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    const isParticipant =
      room.members.some((m) => m.userId === userId) ||
      (room.spectators?.some((s) => s.userId === userId) ?? false);
    if (!isParticipant) return 'not_member';
```

(The rest of the method — rate-limit check, `$push`, cap — is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run lobby-chat`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/test/lobby-chat.e2e.spec.ts
git commit -m "feat(server): let lobby spectators send preset chat too"
```

---

### Task 4: Unify post-start spectating into `RoomDoc.spectators`

**Files:**
- Modify: `apps/server/src/lobby/lobby.service.ts`
- Modify: `apps/server/test/lobby-spectate.e2e.spec.ts`

**Interfaces:**
- Consumes: `RoomRepo.recordSpectator` (Task 1).
- Produces: `LobbyService.spectateTicket` now also records the caller onto `RoomDoc.spectators`.

- [ ] **Step 1: Write the failing test**

In `apps/server/test/lobby-spectate.e2e.spec.ts`, add inside `describe('spectating', ...)`, after the existing tests:

```ts
  it('records the spectator on the room doc when minting a spectate ticket', async () => {
    const { code } = await startedRoom();
    const s = await guest('Recorder');

    await request(server()).post(`/api/v1/rooms/${code}/spectate`).set(auth(s.token)).expect(200);

    const read = await request(server()).get(`/api/v1/rooms/${code}`).set(auth(s.token)).expect(200);
    expect(read.body.spectators).toEqual([{ userId: s.id, displayName: 'Recorder', isGuest: true }]);

    // Minting a second ticket (e.g. a reconnect) doesn't duplicate the entry.
    await request(server()).post(`/api/v1/rooms/${code}/spectate`).set(auth(s.token)).expect(200);
    const read2 = await request(server())
      .get(`/api/v1/rooms/${code}`)
      .set(auth(s.token))
      .expect(200);
    expect(read2.body.spectators).toHaveLength(1);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/server test --run lobby-spectate`
Expected: FAIL — `read.body.spectators` is `[]` (nothing records it yet)

- [ ] **Step 3: Wire `recordSpectator` into `spectateTicket`**

In `apps/server/src/lobby/lobby.service.ts`, replace the `spectateTicket` method:

```ts
  /** Mint a spectator ws-ticket (seat -1) for a started room, if it allows spectating. Also
   *  records the caller onto `RoomDoc.spectators` (idempotent) — the same list a lobby demote
   *  populates, so every path that watches this room's game shares one identity list. */
  async spectateTicket(code: string, user: AuthUser): Promise<TicketResult> {
    await this.assertNotDisabled(user.userId);
    const room = await this.require(code);
    const s = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
    if (!s.allowSpectating) throw new ForbiddenException('spectating is disabled for this room');
    if (!room.gameId) throw new BadRequestException('game has not started');
    await this.rooms.recordSpectator(code, {
      userId: user.userId,
      displayName: user.displayName,
      isGuest: user.isGuest,
    });
    return {
      gameId: room.gameId,
      ticket: this.tokens.signWsTicket({ gameId: room.gameId, playerId: user.userId, seat: -1 }),
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run lobby-spectate`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lobby/lobby.service.ts apps/server/test/lobby-spectate.e2e.spec.ts
git commit -m "feat(server): record post-start spectate-ticket holders onto RoomDoc.spectators"
```

---

### Task 5: In-game chat opens to spectators (hub)

**Files:**
- Modify: `apps/server/src/ws/hub.ts`
- Modify: `apps/server/test/history-chat.e2e.spec.ts`

**Interfaces:**
- Produces: any bound connection (member or spectator) may send chat; `broadcast` fans chat out to `this.spectators` too; `sendHistory` always sends the real chat log, even to a `null` viewer.

- [ ] **Step 1: Write the failing tests**

In `apps/server/test/history-chat.e2e.spec.ts`, add a new `describe` block at the end of the file:

```ts
describe('spectator chat', () => {
  it('lets a spectator send chat, broadcasting to both members and other spectators', async () => {
    const board = taiwanBoard();
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g', board, config);

    const fMember: ServerEnvelope[] = [];
    const fSpec: ServerEnvelope[] = [];
    hub.openConnection('m1', (b) => fMember.push(decodeServer(b)));
    hub.openConnection('s1', (b) => fSpec.push(decodeServer(b)));
    await hub.receive('m1', hello('p1', 0, 1));
    await hub.receive(
      's1',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'g', playerId: 'watcher', seat: -1 }),
          protocolVersion: 1,
        },
      }),
    );
    fMember.length = 0;
    fSpec.length = 0;

    await hub.receive(
      's1',
      encodeClient(2, {
        case: 'chat',
        value: { content: { case: 'text', value: 'hi from the stands' } },
      }),
    );

    const memberChat = fMember.find((f) => f.event.case === 'chat')?.event.value as
      | { playerId: string; content: { case: string; value: string } }
      | undefined;
    const specChat = fSpec.find((f) => f.event.case === 'chat')?.event.value as
      | { playerId: string; content: { case: string; value: string } }
      | undefined;
    expect(memberChat?.playerId).toBe('watcher');
    expect(memberChat?.content).toEqual({ case: 'text', value: 'hi from the stands' });
    expect(specChat?.content).toEqual({ case: 'text', value: 'hi from the stands' });
  });

  it('backfills chat history to a spectator on hello', async () => {
    const board = taiwanBoard();
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch('g', board, config);

    hub.openConnection('m1', () => {});
    await hub.receive('m1', hello('p1', 0, 1));
    await hub.receive(
      'm1',
      encodeClient(2, {
        case: 'chat',
        value: { content: { case: 'text', value: 'before you joined' } },
      }),
    );

    const fSpec: ServerEnvelope[] = [];
    hub.openConnection('s1', (b) => fSpec.push(decodeServer(b)));
    await hub.receive(
      's1',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'g', playerId: 'watcher', seat: -1 }),
          protocolVersion: 1,
        },
      }),
    );

    const h = historyOf(fSpec);
    expect(h?.chat).toHaveLength(1);
    expect(h?.chat[0]?.content).toEqual({ case: 'text', value: 'before you joined' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/server test --run history-chat`
Expected: FAIL — the spectator's chat send is silently dropped (no `chat` frame in either buffer), and `h?.chat` is `[]` in the backfill test.

- [ ] **Step 3: Drop the seat exclusion in `onChat`**

In `apps/server/src/ws/hub.ts`, change the guard at the top of `onChat`:

```ts
    if (!conn.binding) return; // unbound → no chat
```

(replacing `if (!conn.binding || conn.binding.seat < 0) return; // unbound or spectator → no chat`)

- [ ] **Step 4: Fan the broadcast out to spectators too**

Replace the tail of `onChat`:

```ts
    const members = this.members.get(gameId);
    if (members) for (const member of members.values()) member.send(chatFrame(playerId, toSend));
    const specs = this.spectators.get(gameId);
    if (specs) for (const spec of specs) spec.send(chatFrame(playerId, toSend));
  }
```

(replacing the previous three lines: `const members = this.members.get(gameId); if (!members) return; for (const member of members.values()) member.send(chatFrame(playerId, toSend));`)

- [ ] **Step 5: Always backfill the real chat log**

In `sendHistory`, replace:

```ts
    const chat = this.chatLog.get(match.session.gameId) ?? [];
```

(replacing `const chat = viewer === null ? [] : (this.chatLog.get(match.session.gameId) ?? []);`)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace @trm/server test --run history-chat`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 7: Run the full server suite (wire-leak regression check)**

Run: `yarn workspace @trm/server test`
Expected: PASS — in particular `wire-game.e2e.spec.ts` (the hidden-info leak guard) and `spectators.spec.ts` still pass unmodified.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/ws/hub.ts apps/server/test/history-chat.e2e.spec.ts
git commit -m "feat(server): let in-game spectators send and receive chat"
```

---

### Task 6: Web roster store learns about spectators

**Files:**
- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/store/roster.ts`
- Modify: `apps/web/src/screens/GameScreen.tsx`
- Modify: `apps/web/src/screens/HomeScreen.test.tsx`
- Test: `apps/web/src/store/roster.test.ts` (new)

**Interfaces:**
- Produces: `RoomSpectator` type (`net/rest.ts`); `RoomView.spectators: RoomSpectator[]`; `useRoster.setMembers(members: RoomMember[], spectators?: RoomSpectator[]): void`; roster entries carry `isSpectator?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/store/roster.test.ts`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { useRoster } from './roster';

const member = (userId: string, displayName: string) => ({
  userId,
  displayName,
  isGuest: false,
  seat: 0,
  ready: false,
});
const spectator = (userId: string, displayName: string) => ({
  userId,
  displayName,
  isGuest: true,
});

beforeEach(() => {
  useRoster.getState().clear();
});

describe('useRoster', () => {
  it('indexes members by userId', () => {
    useRoster.getState().setMembers([member('p1', 'Alice')]);
    expect(useRoster.getState().byId.p1?.displayName).toBe('Alice');
  });

  it('also indexes spectators, marked distinctly from seated members', () => {
    useRoster.getState().setMembers([member('p1', 'Alice')], [spectator('s1', 'Watcher')]);
    expect(useRoster.getState().byId.s1).toEqual({
      userId: 's1',
      displayName: 'Watcher',
      isGuest: true,
      isSpectator: true,
    });
    expect(useRoster.getState().byId.p1?.isSpectator).toBeUndefined();
  });

  it('clear empties the roster', () => {
    useRoster.getState().setMembers([member('p1', 'Alice')]);
    useRoster.getState().clear();
    expect(useRoster.getState().byId).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/web test --run roster`
Expected: FAIL — TS error (`setMembers` doesn't accept a second argument) / the spectator isn't indexed.

- [ ] **Step 3: Add `RoomSpectator` to `net/rest.ts`**

Add right after the `RoomMember` interface:

```ts
export interface RoomSpectator {
  userId: string;
  displayName: string;
  isGuest: boolean;
}
```

Add `spectators` to `RoomView`:

```ts
export interface RoomView {
  code: string;
  hostId: string;
  status: 'LOBBY' | 'STARTED' | 'CLOSED';
  maxPlayers: number;
  members: RoomMember[];
  spectators: RoomSpectator[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
  chat: RoomChatEntry[];
}
```

`RoomView.spectators` is now required, and `apps/web/src/screens/HomeScreen.test.tsx` has a `pubRoom` helper explicitly typed as returning `RoomView` (a real object literal, not a loosened mock), so it must be updated in the same step or the workspace fails to typecheck. In `apps/web/src/screens/HomeScreen.test.tsx`, add `spectators: [],` to the object `pubRoom` returns, alongside its existing `chat: [],`:

```ts
const pubRoom = (code: string, status: RoomView['status'], gameId?: string): RoomView => ({
  code,
  hostId: 'h',
  status,
  maxPlayers: 5,
  members: [{ userId: 'h', displayName: 'h', isGuest: false, seat: 0, ready: false }],
  settings,
  spectators: [],
  chat: [],
  ...(gameId ? { gameId } : {}),
});
```

- [ ] **Step 4: Widen `store/roster.ts`**

Replace the full file:

```ts
import { create } from 'zustand';
import type { RoomMember, RoomSpectator } from '../net/rest';

// The in-game snapshot carries player ids only (no display names) — names are lobby data.
// GameScreen fetches the room's members + spectators (REST) once on entry and stashes them
// here, keyed by userId (which is the id the engine/snapshot/chat use), so the trackers,
// scoreboard, whose-turn banner, and chat can show real account names / localized bot labels
// instead of "P{seat+1}" — including for someone watching rather than seated.
export interface RosterEntry {
  displayName: string;
  isBot?: boolean;
  difficulty?: RoomMember['difficulty'];
  isSpectator?: boolean;
}

interface RosterState {
  byId: Record<string, RosterEntry>;
  setMembers(members: RoomMember[], spectators?: RoomSpectator[]): void;
  clear(): void;
}

export const useRoster = create<RosterState>()((set) => ({
  byId: {},
  setMembers: (members, spectators = []) =>
    set({
      byId: {
        ...Object.fromEntries(members.map((m) => [m.userId, m])),
        ...Object.fromEntries(spectators.map((s) => [s.userId, { ...s, isSpectator: true }])),
      },
    }),
  clear: () => set({ byId: {} }),
}));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run roster`
Expected: PASS (3 tests)

- [ ] **Step 6: Feed spectators into the roster from `GameScreen.tsx`**

In `apps/web/src/screens/GameScreen.tsx`, there are three call sites — update each from `setRoster(r.members)` to `setRoster(r.members, r.spectators)`:

1. The initial room-fetch effect (around line 45):

```ts
    api
      .getRoom(roomCode)
      .then((r) => {
        if (!cancelled) {
          setRoster(r.members, r.spectators);
          setRoom(r);
        }
      })
      .catch(() => {});
```

2. The post-game-over poll (around line 74):

```ts
        setRoster(r.members, r.spectators);
        setRoom(r);
```

3. `voteRematch` (around line 112):

```ts
  const voteRematch = async (wantsRematch: boolean) => {
    if (!roomCode) return;
    try {
      const r = await api.voteRematch(roomCode, wantsRematch);
      setRoster(r.members, r.spectators);
      setRoom(r);
    } catch {
      // transient — the next poll tick resyncs
    }
  };
```

- [ ] **Step 7: Typecheck the web workspace**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors

- [ ] **Step 8: Run the full web test suite (regression check)**

Run: `yarn workspace @trm/web test`
Expected: PASS — in particular `GameScreen.test.tsx`, `ReplayScreen.test.tsx`, `AdminReplayScreen.test.tsx` (their single-argument `setMembers(...)` calls still work via the new optional second parameter's default).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/store/roster.ts apps/web/src/store/roster.test.ts apps/web/src/screens/GameScreen.tsx apps/web/src/screens/HomeScreen.test.tsx
git commit -m "feat(web): roster store learns about spectators, not just seated members"
```

---

### Task 7: `ChatPanel` opens to spectators (removes the disabled gate, fixes author colour)

**Files:**
- Modify: `apps/web/src/components/ChatPanel.tsx`
- Modify: `apps/web/src/components/ChatPanel.test.tsx`
- Modify: `apps/web/src/i18n/index.ts`

**Interfaces:**
- Consumes: `useRoster` (Task 6) — `usePlayerName` already resolves `m.displayName` from it with no changes needed.
- Produces: `ChatPanel` takes no props (the `disabled` prop is removed); a message from an id absent from `snapshot.players` renders with a neutral colour instead of seat 0's colour.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/components/ChatPanel.test.tsx`, add the import:

```tsx
import { useRoster } from '../store/roster';
```

Add to `beforeEach` (after `useChat.getState().reset();`):

```tsx
  useRoster.getState().clear();
```

Replace the `'disables the input and preset buttons for spectators'` test with:

```tsx
  it('renders a spectator (non-seated) message with their roster name and a neutral colour', () => {
    useRoster
      .getState()
      .setMembers([], [{ userId: 'watcher-1', displayName: 'Watcher One', isGuest: true }]);
    useChat.getState().ingest({ playerId: 'watcher-1', content: { case: 'text', value: 'hi all' } });
    const { container } = render(<ChatPanel />);
    const author = container.querySelector('.chat-author');
    expect(author?.textContent).toBe('Watcher One');
    expect(author).toHaveStyle({ color: 'var(--tr-ink-soft)' });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/web test --run ChatPanel`
Expected: FAIL — the author renders as "P1" in a seat colour, not "Watcher One" in the muted token (the roster has no entry yet and `seatOf` defaults unknown ids to seat 0).

- [ ] **Step 3: Remove the `disabled` prop and fix the colour fallback**

Replace the full `apps/web/src/components/ChatPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../store/chat';
import { useGame } from '../store/game';
import { getSocket } from '../net/connection';
import { usePlayerName } from '../game/playerName';
import { SEAT_COLORS } from '../theme/colors';
import { chatRejectionHintKey } from '../game/chatErrors';
import { CHAT_PRESET_IDS, chatPresetKey } from '../game/chatPresets';

const MAX_LEN = 2048;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 5000;

export function ChatPanel() {
  const { t } = useTranslation();
  const messages = useChat((s) => s.messages);
  const snapshot = useGame((s) => s.snapshot);
  const rejection = useGame((s) => s.rejection);
  const nameOf = usePlayerName();
  const me = snapshot?.you?.playerId ?? null;
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const sentAt = useRef<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Surface a server-side chat rejection (length / rate limit / unknown preset) as inline chat
  // feedback instead of the generic action toast. Client guards usually prevent it ever firing.
  useEffect(() => {
    if (!rejection) return;
    const key = chatRejectionHintKey(rejection.messageKey);
    if (key) setHint(t(key));
  }, [rejection, t]);

  // null for a spectator author (not in the seated snapshot.players list) — never seat 0.
  const seatOf = (pid: string): number | null =>
    snapshot?.players.find((p) => p.id === pid)?.seat ?? null;

  const withinRateLimit = (): boolean => {
    const now = Date.now();
    sentAt.current = sentAt.current.filter((ts) => now - ts < RATE_WINDOW_MS);
    if (sentAt.current.length >= RATE_MAX) {
      setHint(t('chat.rateLimited'));
      return false;
    }
    sentAt.current.push(now);
    return true;
  };

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    if (!withinRateLimit()) return;
    getSocket()?.chat(text.slice(0, MAX_LEN));
    setDraft('');
    setHint(null);
  };

  const sendPreset = (id: string): void => {
    if (!withinRateLimit()) return;
    getSocket()?.chatPreset(id);
    setHint(null);
  };

  return (
    <section className="chat-panel">
      <div className="tray-head">
        <h4>{t('chat.heading')}</h4>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <p className="chat-empty">{t('chat.empty')}</p>
        ) : (
          messages.map((m) => {
            const seat = seatOf(m.playerId);
            return (
              <div className="chat-msg" key={m.id}>
                <span
                  className="chat-author"
                  style={{
                    color: seat !== null ? (SEAT_COLORS[seat % 5] ?? '#888') : 'var(--tr-ink-soft)',
                  }}
                >
                  {nameOf({ id: m.playerId, seat: seat ?? 0, isMe: m.playerId === me })}
                </span>
                <span className="chat-text">
                  {m.content.case === 'presetId'
                    ? t(chatPresetKey(m.content.value))
                    : m.content.value}
                </span>
              </div>
            );
          })
        )}
      </div>
      <p className={`chat-hint${hint ? ' chat-hint--visible' : ''}`}>{hint}</p>
      <div className="chat-presets">
        {CHAT_PRESET_IDS.map((id) => (
          <button key={id} type="button" className="chat-preset-btn" onClick={() => sendPreset(id)}>
            {t(chatPresetKey(id))}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          maxLength={MAX_LEN}
          value={draft}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={draft.trim().length === 0}>
          {t('chat.send')}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Remove the now-dead `chat.spectatorDisabled` i18n key**

In `apps/web/src/i18n/index.ts`, delete the line `spectatorDisabled: '觀戰中無法聊天',` from the zh-Hant `chat` block, and delete the line `spectatorDisabled: "Spectators can't chat",` from the `en` `chat` block.

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run ChatPanel`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ChatPanel.tsx apps/web/src/components/ChatPanel.test.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web): let spectators use in-game chat; fix author colour for non-seated ids"
```

---

### Task 8: Drop the now-dead `chatDisabled` plumbing (`CommsPanel`, `GameStage`)

**Files:**
- Modify: `apps/web/src/components/CommsPanel.tsx`
- Modify: `apps/web/src/screens/GameStage.tsx`

**Interfaces:**
- Consumes: `ChatPanel` (Task 7) now takes no props.
- Produces: `CommsPanel` takes no props.

- [ ] **Step 1: Simplify `CommsPanel.tsx`**

Replace the full file:

```tsx
import { LogPanel } from './LogPanel';
import { ChatPanel } from './ChatPanel';

/** The comms column content: action log on top, chat docked below. */
export function CommsPanel() {
  return (
    <div className="comms">
      <LogPanel />
      <ChatPanel />
    </div>
  );
}
```

- [ ] **Step 2: Drop the prop in `GameStage.tsx`**

In `apps/web/src/screens/GameStage.tsx`, change:

```tsx
  const comms = sandbox ? null : <CommsPanel />;
```

(replacing `const comms = sandbox ? null : <CommsPanel chatDisabled={isSpectator} />;` — `isSpectator` itself stays, still used by the spectator banner a few lines below.)

- [ ] **Step 3: Typecheck the web workspace**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors

- [ ] **Step 4: Run the full web test suite**

Run: `yarn workspace @trm/web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/CommsPanel.tsx apps/web/src/screens/GameStage.tsx
git commit -m "refactor(web): drop the dead chatDisabled prop now that spectators can chat"
```

---

### Task 9: `RoomScreen` — Spectate / Join-as-player buttons + spectator list + poll-effect fix

**Files:**
- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/screens/RoomScreen.tsx`
- Modify: `apps/web/src/screens/RoomScreen.test.tsx`
- Modify: `apps/web/src/i18n/index.ts`

**Interfaces:**
- Consumes: `RoomView.spectators` (Task 6; `apps/web/src/screens/HomeScreen.test.tsx`'s `pubRoom` helper was already updated there).
- Produces: `api.watchRoom(code)`, `api.rejoinRoom(code)`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/screens/RoomScreen.test.tsx`:

Add `watchRoom: vi.fn(), rejoinRoom: vi.fn(),` to the `api` object inside `vi.mock('../net/rest', ...)` (alongside `sendRoomChat: vi.fn(),`).

Add `spectators: [] as { userId: string; displayName: string; isGuest: boolean }[],` to `baseRoom()`'s return object (alongside `chat: []`).

Add `watchRoom: ReturnType<typeof vi.fn>; rejoinRoom: ReturnType<typeof vi.fn>;` to the `mocked` type cast (alongside `updateRoomSettings`).

Add a new `describe` block at the end of the file:

```tsx
describe('RoomScreen spectating', () => {
  it('does not re-join a lobby spectator on subsequent polls', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
      }),
    );
    render(<RoomScreen />);
    await screen.findByText('host');
    expect(mocked.joinRoom).not.toHaveBeenCalled();
  });

  it('shows an enabled Spectate button next to Ready when there are other members', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    mocked.watchRoom.mockResolvedValue(
      room({
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'u-me', isGuest: false }],
      }),
    );
    render(<RoomScreen />);
    const spectateBtn = await screen.findByRole('button', { name: '觀戰' });
    expect(spectateBtn).not.toBeDisabled();
    fireEvent.click(spectateBtn);
    await waitFor(() => expect(mocked.watchRoom).toHaveBeenCalledWith('ABCD'));
  });

  it('disables Spectate when the viewer is the only member', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [member('u-me')] }));
    render(<RoomScreen />);
    const spectateBtn = await screen.findByRole('button', { name: '觀戰' });
    expect(spectateBtn).toBeDisabled();
  });

  it('shows "Join as player" for a spectator and calls rejoinRoom', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
      }),
    );
    mocked.rejoinRoom.mockResolvedValue(
      room({ members: [member('host'), member('u-me')], spectators: [] }),
    );
    render(<RoomScreen />);
    const joinBtn = await screen.findByRole('button', { name: '加入遊戲' });
    expect(joinBtn).not.toBeDisabled();
    fireEvent.click(joinBtn);
    await waitFor(() => expect(mocked.rejoinRoom).toHaveBeenCalledWith('ABCD'));
  });

  it('disables "Join as player" when the room is full', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        maxPlayers: 1,
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
      }),
    );
    render(<RoomScreen />);
    const joinBtn = await screen.findByRole('button', { name: '加入遊戲' });
    expect(joinBtn).toBeDisabled();
  });

  it('renders the spectator list with a kick control for the host', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        hostId: 'u-me',
        members: [member('u-me')],
        spectators: [{ userId: 'g1', displayName: 'Watcher', isGuest: true }],
      }),
    );
    render(<RoomScreen />);
    await screen.findByText('Watcher');
    const kickBtns = await screen.findAllByRole('button', { name: '移除玩家' });
    expect(kickBtns.length).toBeGreaterThan(0);
    fireEvent.click(kickBtns[0]!);
    expect(mocked.kickPlayer).toHaveBeenCalledWith('ABCD', 'g1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: FAIL — `api.watchRoom`/`api.rejoinRoom` don't exist yet, and no Spectate/Join-as-player button renders.

- [ ] **Step 3: Add the two REST methods**

In `apps/web/src/net/rest.ts`, add to the `api` object right after `spectate`:

```ts
  spectate: (code: string) => req<TicketResult>('POST', `/rooms/${code}/spectate`),
  watchRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/watch`),
  rejoinRoom: (code: string) => req<RoomView>('POST', `/rooms/${code}/rejoin`),
```

- [ ] **Step 4: Add the new i18n keys**

In `apps/web/src/i18n/index.ts`, add to the zh-Hant block right after `cancelReady: '取消準備',`:

```ts
      becomePlayer: '加入遊戲',
      spectateDisabledOnlyMember: '房間裡只剩你一人，無法觀戰',
      becomePlayerDisabledFull: '房間已滿，無法加入遊戲',
      spectatorsHeading: '觀眾',
```

Add to the `en` block right after `cancelReady: 'Cancel ready',`:

```ts
      becomePlayer: 'Join as player',
      spectateDisabledOnlyMember: "You're the only one here — can't spectate",
      becomePlayerDisabledFull: 'Room is full — cannot join as a player',
      spectatorsHeading: 'Spectators',
```

- [ ] **Step 5: Fix the poll effect so a lobby spectator isn't re-joined**

In `apps/web/src/screens/RoomScreen.tsx`, replace the whole poll `useEffect` (the one starting `useEffect(() => { if (!code) return;`):

```tsx
  useEffect(() => {
    if (!code) return; // no room to poll (e.g. mid-navigation after leaving/being kicked)
    let active = true;
    // Whether we have ever been present here (seated or spectating). Once true, vanishing
    // from both lists means the host kicked us — go home instead of silently rejoining.
    let wasPresent = false;
    const poll = async () => {
      try {
        let r = await api.getRoom(code);
        if (!active) return;
        if (r.status === 'CLOSED') {
          active = false;
          goHome(); // the room is gone — nothing to wait in or rejoin
          return;
        }
        // A shared link can land a non-member here. Join the lobby once; a game already in
        // progress that we aren't part of can't be joined, so spectate instead if the room
        // allows it, otherwise bail home rather than trap.
        // (Existing members of a STARTED game skip this and reconnect via the ticket below —
        // the server rejects join on a started room even for members.)
        if (!r.members.some((m) => m.userId === user?.id)) {
          if (wasPresent) {
            // We were seated/spectating and have been dropped. In LOBBY that's a host kick —
            // surface a modal and let the player dismiss it home; otherwise just bail home.
            active = false;
            if (r.status === 'LOBBY') setKicked(true);
            else goHome();
            return;
          }
          if (r.status !== 'LOBBY') {
            // A started game we aren't in can't be joined — spectate if it's allowed,
            // otherwise bail home rather than trap.
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
          // A demoted lobby spectator is also a non-member, but must not be auto-joined back
          // onto a seat — they keep watching until they either rejoin a seat themselves or
          // the game starts (handled by the STARTED branch above, since they're a non-member).
          const amSpectator = r.spectators.some((s) => s.userId === user?.id);
          if (!amSpectator) {
            r = await api.joinRoom(code);
            if (!active) return;
          }
        }
        wasPresent = true;
        setRoom(r);
        if (r.status === 'STARTED' && r.gameId) {
          const ticket = await api.getTicket(code);
          if (!active) return;
          connectGame(ticket.ticket);
          enterGame(ticket.gameId, ticket.ticket);
        }
      } catch (e) {
        if (!active) return;
        // A room we can't fetch (deleted, or we're not a member) can't be restored —
        // e.g. landing on a stale /room/:code after a reload. Bail home, don't trap.
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          active = false;
          goHome();
          return;
        }
        // A 400 from join (room full, or the host started the game mid-poll) is terminal —
        // stop polling so we don't re-spam join every 2s; the error card offers a way home.
        if (e instanceof ApiError && e.status === 400) {
          active = false;
          setErr((e as Error).message);
          return;
        }
        setErr((e as Error).message);
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
  }, [code, user?.id, enterGame, goHome]);
```

- [ ] **Step 6: Add the `mySpectator` derived value and the two action functions**

Right after `const me = room.members.find((m) => m.userId === user?.id);`, add:

```tsx
  const mySpectator = room.spectators.find((s) => s.userId === user?.id);
```

Right after `const kick = (userId: string) => void guard(api.kickPlayer(code, userId));`, add:

```tsx
  const becomeSpectator = () => void guard(api.watchRoom(code));
  const becomePlayer = () => void guard(api.rejoinRoom(code));
```

- [ ] **Step 7: Render the spectator list**

Right after the closing `</ul>` of the existing `.member-list` (and before the `<div className="card stack room-chat">` block), add:

```tsx
      {room.spectators.length > 0 && (
        <>
          <h4 className="muted">{t('spectatorsHeading')}</h4>
          <ul className="member-list spectator-list">
            {room.spectators.map((s) => (
              <li key={s.userId}>
                <span>{s.displayName}</span>
                {s.userId === user?.id && <em className="muted">({t('you')})</em>}
                {isHost && (
                  <button
                    className="icon-btn"
                    aria-label={t('kickPlayer')}
                    title={t('kickPlayer')}
                    onClick={() => kick(s.userId)}
                  >
                    <UserMinus size={14} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
```

- [ ] **Step 8: Add the Spectate / Join-as-player buttons to the button row**

Replace the button row:

```tsx
      <div className="row">
        {me && (
          <>
            <button className={me.ready ? 'danger' : 'success'} onClick={toggleReady}>
              {me.ready ? t('cancelReady') : t('markReady')}
            </button>
            <button
              onClick={() => void becomeSpectator()}
              disabled={room.members.length <= 1}
              title={room.members.length <= 1 ? t('spectateDisabledOnlyMember') : undefined}
            >
              {t('watch')}
            </button>
          </>
        )}
        {mySpectator && (
          <button
            onClick={() => void becomePlayer()}
            disabled={room.members.length >= room.maxPlayers}
            title={
              room.members.length >= room.maxPlayers ? t('becomePlayerDisabledFull') : undefined
            }
          >
            {t('becomePlayer')}
          </button>
        )}
        {isHost && (
          <button className="primary" disabled={!allReady} onClick={() => void start()}>
            {t('start')}
          </button>
        )}
        <button onClick={() => requestLeave(() => void leave())}>{t('leave')}</button>
      </div>
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS (all tests in the file, including the 6 new ones)

Run: `yarn workspace @trm/web test --run HomeScreen`
Expected: PASS

- [ ] **Step 10: Typecheck the web workspace**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx apps/web/src/i18n/index.ts
git commit -m "feat(web): add Spectate/Join-as-player buttons and the spectator list to the lobby"
```

---

### Task 10: Restyle the lobby chat panel as a right-hand column

**Files:**
- Modify: `apps/web/src/screens/RoomScreen.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles/app.css`
- Create: `apps/web/src/styles/room.css`
- Modify: `apps/web/src/screens/RoomScreen.test.tsx`

**Interfaces:**
- Consumes: game.css's `.comms`/`.chat-panel`/`.chat-messages`/`.chat-msg`/`.chat-author`/`.chat-presets`/`.chat-preset-btn` classes (unchanged, reused verbatim).

- [ ] **Step 1: Update the two existing preset-chat tests for the new markup**

In `apps/web/src/screens/RoomScreen.test.tsx`, inside `describe('RoomScreen preset chat', ...)`, change both occurrences of `container.querySelector('.room-chat-log li')` to `container.querySelector('.chat-messages .chat-msg')`:

```tsx
  it('sends a preset message and shows it in the log with the translated text', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    (api.sendRoomChat as ReturnType<typeof vi.fn>).mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        chat: [{ userId: 'u-me', presetId: 'GOOD_LUCK', ts: 1 }],
      }),
    );
    const { container } = render(<RoomScreen />);
    const btn = await screen.findByRole('button', { name: '祝你好運，玩得開心！' });
    fireEvent.click(btn);
    expect(api.sendRoomChat).toHaveBeenCalledWith('ABCD', 'GOOD_LUCK');
    await waitFor(() =>
      expect(container.querySelector('.chat-messages .chat-msg')?.textContent).toContain(
        '祝你好運，玩得開心！',
      ),
    );
  });

  it('renders an existing chat log entry attributed to the sending member', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        chat: [{ userId: 'host', presetId: 'THANKS', ts: 1 }],
      }),
    );
    const { container } = render(<RoomScreen />);
    await waitFor(() =>
      expect(container.querySelector('.chat-messages .chat-msg')?.textContent).toContain('謝謝！'),
    );
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: FAIL — `.chat-messages .chat-msg` doesn't exist yet (the old `.room-chat-log li` markup is still in place).

- [ ] **Step 3: Create `apps/web/src/styles/room.css`**

```css
/* apps/web/src/styles/room.css — lobby-only layout: the two-column room+chat grid, the
   spectator list, and the room chat panel (reuses game.css's chat-panel/chat-messages/
   chat-msg/chat-author/chat-presets/chat-preset-btn classes so it looks like in-game chat). */

.room-layout {
  display: flex;
  flex-direction: column;
  gap: var(--tr-space-4);
}
@media (min-width: 1000px) {
  .room-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    align-items: start;
    gap: var(--tr-space-4);
  }
}

.spectator-list li {
  opacity: 0.85;
}

/* The lobby has no action log, so the chat-panel fills the whole card instead of the
   in-game 45% split, and doesn't need the top border game.css gives it as a divider
   from the log panel above it. */
.room-chat-panel .chat-panel {
  flex: 1;
  max-height: none;
  border-top: none;
}
.room-chat-panel .chat-messages {
  max-height: 320px;
}
```

- [ ] **Step 4: Wire the new stylesheet + a wider `app-main` modifier**

In `apps/web/src/screens/RoomScreen.tsx`, add these two imports at the top (after the existing `import { CHAT_PRESET_IDS, chatPresetKey } from '../game/chatPresets';`):

```tsx
import '../styles/game.css';
import '../styles/room.css';
```

In `apps/web/src/App.tsx`, widen the `mainClass` ternary:

```tsx
  const mainClass = isGameLayout
    ? 'app-main app-main--game'
    : isLogin
      ? 'app-main app-main--login'
      : view === 'home'
        ? 'app-main app-main--home' // the hero + two-column grid needs more than the reading column
        : view === 'room'
          ? 'app-main app-main--room' // the room+chat two-column grid needs more than the reading column
          : 'app-main';
```

In `apps/web/src/styles/app.css`, add near the other `.app-main--*` rules (there are none in `app.css` today — `app-main--home` lives in `home.css` and `app-main--game`/`app-main--login` are styled inline in `game.css`/within `app.css`'s login section; add this as a new small block right before the `.room-chat`/`.chip-btn`/`.room-chat-log` rules you're about to delete in the next step):

```css
.app-main.app-main--room {
  max-width: min(1080px, 100%);
}
```

- [ ] **Step 5: Remove the old room-chat CSS from `app.css`**

Delete these three rule blocks from `apps/web/src/styles/app.css`:

```css
.room-chat {
  gap: var(--tr-space-2);
}
.chip-btn {
  font-size: 0.8em;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--tr-line);
  background: var(--tr-surface-2);
  color: var(--tr-ink);
  cursor: pointer;
}
.room-chat-log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.85em;
}
```

- [ ] **Step 6: Restructure `RoomScreen.tsx`'s render — wrap in the two-column layout, rebuild the chat panel, widen `chatAuthorName`**

Widen `chatAuthorName` (it currently only checks `room.members`) so a spectator sender resolves to their display name instead of their raw userId:

```tsx
  const chatAuthorName = (userId: string): string => {
    const m = room.members.find((x) => x.userId === userId);
    if (m) return memberName(m);
    const s = room.spectators.find((x) => x.userId === userId);
    return s ? s.displayName : userId;
  };
```

This is three surgical edits against the existing return statement — the large, untouched middle (member list, spectator list, game-settings fieldset, bot controls, button row, hints, modals) stays exactly where it is between the first and third edit; only its indentation level changes, which `yarn format` (run in Task 11) normalizes automatically.

**Edit A — open the two-column wrapper.** Find:

```tsx
  return (
    <div className="stack">
      <div className="row between">
```

Replace with:

```tsx
  return (
    <div className="room-layout">
      <div className="stack room-main">
        <div className="row between">
```

**Edit B — delete the old room-chat block.** Find (currently sandwiched between the member list's closing `</ul>` and the game-settings `<fieldset>`):

```tsx
      <div className="card stack room-chat">
        <div className="row wrap">
          {CHAT_PRESET_IDS.map((id) => (
            <button key={id} type="button" className="chip-btn" onClick={() => sendChat(id)}>
              {t(chatPresetKey(id))}
            </button>
          ))}
        </div>
        {room.chat.length > 0 && (
          <ul className="room-chat-log">
            {room.chat.map((c, i) => (
              <li key={i}>
                <strong>{chatAuthorName(c.userId)}</strong>: {t(chatPresetKey(c.presetId))}
              </li>
            ))}
          </ul>
        )}
      </div>
```

Delete it entirely (replace with nothing) — its replacement is added in Edit C, as a sibling of `.room-main` rather than inline with it.

**Edit C — close `.room-main`, add the chat column, close `.room-layout`.** Find the component's final closing lines:

```tsx
      {leaveOpen && (
        <ConfirmDialog
          title={t('leaveConfirmTitle')}
          message={t('leaveConfirmBody')}
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
      )}
    </div>
  );
}
```

Replace with:

```tsx
      {leaveOpen && (
        <ConfirmDialog
          title={t('leaveConfirmTitle')}
          message={t('leaveConfirmBody')}
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
      )}
      </div>

      <aside className="comms room-chat-panel">
        <section className="chat-panel">
          <div className="tray-head">
            <h4>{t('chat.heading')}</h4>
          </div>
          <div className="chat-messages">
            {room.chat.length === 0 ? (
              <p className="chat-empty">{t('chat.empty')}</p>
            ) : (
              room.chat.map((c, i) => (
                <div className="chat-msg" key={i}>
                  <span className="chat-author">{chatAuthorName(c.userId)}</span>{' '}
                  <span className="chat-text">{t(chatPresetKey(c.presetId))}</span>
                </div>
              ))
            )}
          </div>
          <div className="chat-presets">
            {CHAT_PRESET_IDS.map((id) => (
              <button key={id} type="button" className="chat-preset-btn" onClick={() => sendChat(id)}>
                {t(chatPresetKey(id))}
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS (all tests in the file)

- [ ] **Step 8: Typecheck + lint the web workspace**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors

Run: `yarn workspace @trm/web lint`
Expected: no errors

- [ ] **Step 9: Manual check**

Run: `yarn workspace @trm/server dev` (needs `docker compose up -d mongo` first) and, in another terminal, `yarn workspace @trm/web dev`. Open two browser windows, create a room in one, join from the other, and confirm:
- The chat column sits to the right of the room content on a wide window, and stacks below it under ~1000px width.
- The chat panel looks like the in-game one (message list on top, preset pills at the bottom) instead of pills-then-log.
- Sending a preset shows up correctly attributed in both windows.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx apps/web/src/App.tsx apps/web/src/styles/app.css apps/web/src/styles/room.css
git commit -m "refactor(web): restyle the lobby chat panel as a right-hand column matching in-game chat"
```

---

### Task 11: Full-repo verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `yarn build`
Expected: succeeds (proto codegen + all packages/apps build in dependency order)

- [ ] **Step 2: Full typecheck**

Run: `yarn typecheck`
Expected: no errors across all workspaces

- [ ] **Step 3: Full lint**

Run: `yarn lint`
Expected: no errors

- [ ] **Step 4: Full test suite**

Run: `yarn test`
Expected: all packages/apps pass, including every file touched in Tasks 1–10

- [ ] **Step 5: Format check**

Run: `yarn format:check`
Expected: no diffs

No commit for this task — it's a verification pass over work already committed in Tasks 1–10. If any step fails, fix the underlying issue in the relevant task's files and commit the fix there (`fix: ...`), then re-run this task's steps.
