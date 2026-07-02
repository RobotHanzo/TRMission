# Game Replay System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players can browse finished games they played in or spectated (`/history`) and re-watch them move-by-move in a replay player (`/replay/:gameId`) with play/pause, step, seek, action log, and a per-seat perspective switcher.

**Architecture:** The server already event-sources every game (full `Action` log in Mongo `gameEvents`, never deleted) and the engine replays byte-identically from `initGame(config) + Action[]`. We add: (1) spectator persistence, (2) an authz-fixed history REST surface plus a replay-payload endpoint (JSON: stored config + ordered action log — COMPLETED games only, members/spectators only), and (3) a client-side replay player that reuses the tutorial-sandbox recipe (`initGame`/`reduce` locally, project via `redactFor(viewer)` → `viewToSnapshot` into isolated zustand stores, render through the existing `GameStage sandbox`).

**Tech Stack:** NestJS + Mongo (native driver) + zod/nestjs-zod + supertest/mongodb-memory-server · React 19 + Vite 5 + zustand 5 + react-i18next + vitest/@testing-library.

## Global Constraints

- **No `.proto`, engine, codec, shared, or map-data changes.** Everything needed is exported: `initGame`, `reduce`, `redactFor`, `cloneState`, `stateDigest`, `replay`, `boardForContentHash`, `ENGINE_VERSION`, `SCHEMA_VERSION` (all from `@trm/engine`), `viewToSnapshot`, `eventToProto` (from `@trm/codec`).
- **Hidden-info doctrine:** raw `GameState` never reaches a client; live-game logs never leave the server. The replay endpoint ships a **COMPLETED** game's action log to an **authorized member/spectator only** — comment this rationale at the gate.
- **swc, not tsx** (server runtime); **Vite pinned ^5** (web) — do not touch either.
- UI copy: **zh-Hant primary + en**. i18n resources are nested objects in `apps/web/src/i18n/index.ts` (both locales must be updated together).
- Git: commit after each task once validated. **Never `git add -A`** — stage only files this plan touches (other agents may share the worktree).
- Prettier style: single quotes, semicolons, trailing commas, 100-col.

## Design decisions (validated with the user)

- Client-side replay; default perspective = own seat (`redactFor(viewer)`), switchable to any seat or the public (null-viewer) projection. Shipping a finished game's log to an authorized viewer is accepted by design.
- Spectator recording starts now; legacy games have no spectator records (their lists are just empty).
- Only COMPLETED games are replayable. Chat replay and pagination: out of scope (list capped at 50 newest).
- Version guards: server precomputes a `replayable` flag per row; the client makes the final call against its own `ENGINE_VERSION`/`SCHEMA_VERSION`/`boardForContentHash`.

---

### Task 1: Server — spectator persistence in the store

**Files:**
- Modify: `apps/server/src/persistence/types.ts`
- Modify: `apps/server/src/persistence/game-store.ts`
- Test (create): `apps/server/test/spectators.spec.ts`

**Interfaces:**
- Consumes: existing `MongoGameStore`, `ensureIndexes`, engine `initGame`/`reduce`/`stateDigest`/`ENGINE_VERSION`, test helper `pickAction` (`apps/server/test/helpers.ts:82`).
- Produces: `GameStorePort.addSpectator(gameId: string, userId: string): Promise<void>`; `GameDoc.spectators?: string[]`; `MatchHistoryDoc.spectators?: string[]` and `MatchHistoryDoc.engineVersion?: number`; matchHistory index `{ spectators: 1, completedAt: -1 }`. Task 2 (hub) and Task 3 (repo) rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/spectators.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import {
  taiwanBoard,
  initGame,
  reduce,
  stateDigest,
  CONTENT_HASH,
  ENGINE_VERSION,
} from '@trm/engine';
import type { Action, Board, GameConfig, GameState, PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { MongoGameStore, ensureIndexes } from '../src/persistence/game-store';
import type { GameDoc, MatchHistoryDoc } from '../src/persistence/types';
import { pickAction } from './helpers';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let store: MongoGameStore;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('trm-spectators');
  await ensureIndexes(db);
  store = new MongoGameStore(db);
}, 60_000);
afterAll(async () => {
  await client.close();
  await mongod.stop();
});

const players: PlayerSeed[] = [
  { id: asPlayerId('u1'), seat: 0 },
  { id: asPlayerId('u2'), seat: 1 },
];

/** Pure-engine driver: run a seeded game to GAME_OVER, returning the final state. */
function driveToCompletion(board: Board, config: GameConfig): GameState {
  let state = initGame(board, config);
  let guard = 0;
  while (state.turn.phase !== 'GAME_OVER') {
    if (++guard > 50_000) throw new Error('game did not terminate');
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? players
            .map((p) => p.id)
            .find((p) => (state.players[p as string]?.pendingTicketOffer?.length ?? 0) > 0)
        : state.turnOrder[state.turn.orderIndex];
    if (!actor) throw new Error(`no actor in ${state.turn.phase}`);
    const r = reduce(board, state, pickAction(board, state, actor));
    if (!r.ok) throw new Error(`driver action rejected: ${r.error.code}`);
    state = r.value.state;
  }
  return state;
}

describe('spectator persistence', () => {
  it('addSpectator is idempotent and a no-op for unknown games', async () => {
    const board = taiwanBoard();
    const config: GameConfig = { seed: 'spect-1', players, contentHash: CONTENT_HASH };
    const genesis = initGame(board, config);
    await store.createGame('gs1', config, genesis, stateDigest(genesis));

    await store.addSpectator('gs1', 'watcher');
    await store.addSpectator('gs1', 'watcher'); // duplicate — set semantics
    await store.addSpectator('missing-game', 'watcher'); // unknown game — must not throw

    const doc = await db.collection<GameDoc>('games').findOne({ _id: 'gs1' });
    expect(doc?.spectators).toEqual(['watcher']);
  });

  it('recordCompletion copies spectators (minus seated players) and stamps engineVersion', async () => {
    const board = taiwanBoard();
    const config: GameConfig = { seed: 'spect-2', players, contentHash: CONTENT_HASH };
    const genesis = initGame(board, config);
    await store.createGame('gs2', config, genesis, stateDigest(genesis));
    // u2 is seated — even if they spectated, their role stays "player".
    await store.addSpectator('gs2', 'watcher');
    await store.addSpectator('gs2', 'u2');

    const finalState = driveToCompletion(board, config);
    await store.recordCompletion('gs2', finalState);

    const hist = await db.collection<MatchHistoryDoc>('matchHistory').findOne({ _id: 'gs2' });
    expect(hist?.spectators).toEqual(['watcher']);
    expect(hist?.engineVersion).toBe(ENGINE_VERSION);
  });

  it('creates the spectator history index', async () => {
    const indexes = await db.collection('matchHistory').indexes();
    expect(indexes.some((i) => i.key.spectators === 1 && i.key.completedAt === -1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/server test --run spectators`
Expected: FAIL — `store.addSpectator is not a function` (and the index test fails).

- [ ] **Step 3: Implement the store changes**

In `apps/server/src/persistence/types.ts`:

In `GameDoc`, after the `bots?: BotProfile[];` line add:

```ts
  /** userIds who ever spectated (never seated players); grants history/replay access. */
  spectators?: string[];
```

In `MatchHistoryDoc`, after `winners: string[];` add:

```ts
  /** Spectator userIds copied from the game doc at completion (absent on legacy docs). */
  spectators?: string[];
  /** ENGINE_VERSION the game ran on, for replayability flags (absent on legacy docs). */
  engineVersion?: number;
```

In `GameStorePort`, after the `recordCompletion(...)` line add:

```ts
  /** Record that a user spectated this game (idempotent; no-op for unknown games). */
  addSpectator(gameId: string, userId: string): Promise<void>;
```

In `apps/server/src/persistence/game-store.ts`:

In `ensureIndexes`, after the existing matchHistory index add:

```ts
  await db
    .collection<MatchHistoryDoc>('matchHistory')
    .createIndex({ spectators: 1, completedAt: -1 });
```

Add the method to `MongoGameStore` (after `recordCompletion`):

```ts
  async addSpectator(gameId: string, userId: string): Promise<void> {
    await this.games.updateOne(
      { _id: gameId },
      { $addToSet: { spectators: userId }, $set: { updatedAt: new Date() } },
    );
  }
```

In `recordCompletion`, inside the `$setOnInsert` object, after `winners: ...,` add:

```ts
          // A seated member can also mint a spectate ticket — their role stays "player".
          spectators: (game.spectators ?? []).filter(
            (id) => !game.config.players.some((p) => p.id === id),
          ),
          engineVersion: game.engineVersion,
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `yarn workspace @trm/server test --run spectators` — Expected: PASS (3 tests).
Run: `yarn workspace @trm/server test --run persistence` — Expected: PASS (no regression).
Run: `yarn typecheck` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/persistence/types.ts apps/server/src/persistence/game-store.ts apps/server/test/spectators.spec.ts
git commit -m "feat(server): persist spectators on games and the completion archive"
```

---

### Task 2: Server — hub records spectators on hello

**Files:**
- Modify: `apps/server/src/ws/hub.ts` (spectator branch of `onHello`, ~line 248–264)
- Test: `apps/server/test/spectators.spec.ts` (extend)

**Interfaces:**
- Consumes: `GameStorePort.addSpectator` (Task 1), `match.session.turnOrder` (existing, see hub.ts:266), `makeDevTicket` (`src/ws/ticket`), `encodeClient` (test helpers).
- Produces: every spectator `hello` for a non-seated user lands in `GameDoc.spectators`.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/spectators.spec.ts` (add imports at the top):

```ts
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient } from './helpers';
```

New describe block:

```ts
describe('hub spectator recording', () => {
  it('persists a spectator hello, but never a seated player', async () => {
    const board = taiwanBoard();
    const hub = new GameHub(new GameRegistry(), { store, botMoveDelayMs: 0 });
    const config: GameConfig = { seed: 'spect-3', players, contentHash: CONTENT_HASH };
    await hub.createMatch('gs3', board, config);

    hub.openConnection('w1', () => {});
    await hub.receive(
      'w1',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'gs3', playerId: 'watcher', seat: -1 }),
          protocolVersion: 1,
        },
      }),
    );
    // A seated player binding as a spectator must NOT be recorded.
    hub.openConnection('w2', () => {});
    await hub.receive(
      'w2',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'gs3', playerId: 'u1', seat: -1 }),
          protocolVersion: 1,
        },
      }),
    );

    // The persist is fire-and-forget off the hello path — give it a tick to settle.
    await new Promise((r) => setTimeout(r, 25));
    const doc = await db.collection<GameDoc>('games').findOne({ _id: 'gs3' });
    expect(doc?.spectators ?? []).toEqual(['watcher']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/server test --run spectators`
Expected: FAIL — `doc?.spectators` is `undefined` (nothing recorded yet).

- [ ] **Step 3: Implement the hub change**

In `apps/server/src/ws/hub.ts`, inside the spectator branch of `onHello` (the `if (binding.seat < 0) {` block), immediately after `set.add(conn);` add:

```ts
      // Persist who spectated — grants post-game history/replay access. Never for seated
      // players (a member can mint a spectate ticket; their role stays "player").
      // Fire-and-forget: a store hiccup must not break the hello path (same posture as chat).
      if (this.store && !match.session.turnOrder.includes(player)) {
        void this.store.addSpectator(binding.gameId, binding.playerId).catch(() => {});
      }
```

- [ ] **Step 4: Run the tests**

Run: `yarn workspace @trm/server test --run spectators` — Expected: PASS.
Run: `yarn workspace @trm/server test --run lobby-spectate` — Expected: PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws/hub.ts apps/server/test/spectators.spec.ts
git commit -m "feat(server): record spectators on the game doc at ws bind"
```

---

### Task 3: Server — history authz fix + extended list

**Files:**
- Create: `apps/server/src/history/history.schemas.ts`
- Modify: `apps/server/src/history/history.repo.ts` (rework)
- Modify: `apps/server/src/history/history.controller.ts`
- Test (create): `apps/server/test/history-replay.e2e.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–2; `apiSchema` (`src/openapi/openapi.ts:23`); `AccessTokenGuard`/`@CurrentUser()`; `UserDoc` (`src/auth/user.repo.ts:10`); `boardForContentHash`, `ENGINE_VERSION` (`@trm/engine`); e2e patterns from `test/lobby-spectate.e2e.spec.ts` and `test/wire-game.e2e.spec.ts`.
- Produces (Tasks 4 and 6–7 rely on these):
  - `GET /api/v1/history` → `MatchSummary[]` where `MatchSummary = { gameId, players: {userId, seat, displayName?}[], winners: string[], completedAt: string(ISO), role: 'player'|'spectator', finalScores, replayable: boolean }`
  - `GET /api/v1/history/:gameId` → 200 member/spectator, **404 otherwise**
  - Repo: `listForUser(userId, limit=50)`, `getForUser(gameId, userId)`, `displayNames(userIds)` (public), `loadReplay(gameId)` (stub added in Task 4)

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/history-replay.e2e.spec.ts`. The `beforeAll` boots the full REST app, creates four guests (host, member, watcher, outsider), starts a 2-player room, binds both players **and a mid-game spectator** over real ws bytes, then drives the game to GAME_OVER through the hub (persisting every action + the completion archive exactly like production):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { taiwanBoard, replay, stateDigest } from '@trm/engine';
import type { Board } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { createTestApp, type TestApp } from './app';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { storedToConfig } from '../src/persistence/types';
import { actionToCommand, encodeClient, pickAction } from './helpers';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

let host: { token: string; id: string };
let member: { token: string; id: string };
let watcher: { token: string; id: string };
let outsider: { token: string; id: string };
let gameId: string;
let board: Board;

beforeAll(async () => {
  t = await createTestApp();
  board = taiwanBoard();
  host = await guest('Host');
  member = await guest('Member');
  watcher = await guest('Watcher');
  outsider = await guest('Outsider');

  const room = await request(server())
    .post('/api/v1/rooms')
    .set(auth(host.token))
    .send({})
    .expect(201);
  const code: string = room.body.code;
  await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(member.token)).expect(200);
  for (const u of [host, member]) {
    await request(server())
      .post(`/api/v1/rooms/${code}/ready`)
      .set(auth(u.token))
      .send({ ready: true })
      .expect(200);
  }
  const started = await request(server())
    .post(`/api/v1/rooms/${code}/start`)
    .set(auth(host.token))
    .expect(200);
  gameId = started.body.gameId;
  const hostTicket: string = started.body.ticket;
  const memberTicket: string = (
    await request(server()).post(`/api/v1/rooms/${code}/ticket`).set(auth(member.token)).expect(200)
  ).body.ticket;

  const hub = t.app.get(GameHub);
  const seqs = new Map<string, number>();
  const nextSeq = (id: string): number => {
    const n = (seqs.get(id) ?? 0) + 1;
    seqs.set(id, n);
    return n;
  };
  hub.openConnection('c-host', () => {});
  hub.openConnection('c-member', () => {});
  hub.openConnection('c-watch', () => {});
  await hub.receive(
    'c-host',
    encodeClient(nextSeq(host.id), {
      case: 'hello',
      value: { ticket: hostTicket, protocolVersion: 1 },
    }),
  );
  await hub.receive(
    'c-member',
    encodeClient(nextSeq(member.id), {
      case: 'hello',
      value: { ticket: memberTicket, protocolVersion: 1 },
    }),
  );
  // Mid-game spectator over the real REST + ws path.
  const spec = await request(server())
    .post(`/api/v1/rooms/${code}/spectate`)
    .set(auth(watcher.token))
    .expect(200);
  await hub.receive(
    'c-watch',
    encodeClient(1, { case: 'hello', value: { ticket: spec.body.ticket, protocolVersion: 1 } }),
  );

  // Drive to completion THROUGH the hub so every action is persisted like production.
  const match = t.app.get(GameRegistry).get(gameId);
  if (!match) throw new Error('match not registered');
  const connOf = new Map<string, string>([
    [host.id, 'c-host'],
    [member.id, 'c-member'],
  ]);
  let guard = 0;
  while (match.session.phase !== 'GAME_OVER') {
    if (++guard > 50_000) throw new Error('game did not terminate');
    const state = match.session.raw();
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? [host.id, member.id].map(asPlayerId).find((p) => match.session.hasPendingOffer(p))
        : match.session.currentPlayer;
    if (!actor) throw new Error(`no actor in ${state.turn.phase}`);
    await hub.receive(
      connOf.get(actor as string)!,
      encodeClient(nextSeq(actor as string), actionToCommand(pickAction(board, state, actor))),
    );
  }
  // Let the fire-and-forget spectator write + completion archive settle.
  await new Promise((r) => setTimeout(r, 50));
}, 180_000);
afterAll(() => t.close());

describe('GET /api/v1/history', () => {
  it('lists the finished game for a player: role, names, replayable', async () => {
    const res = await request(server()).get('/api/v1/history').set(auth(host.token)).expect(200);
    expect(res.body).toHaveLength(1);
    const row = res.body[0];
    expect(row.gameId).toBe(gameId);
    expect(row.role).toBe('player');
    expect(row.replayable).toBe(true);
    expect(row.winners.length).toBeGreaterThan(0);
    expect(typeof row.completedAt).toBe('string');
    const names = row.players.map((p: { displayName?: string }) => p.displayName);
    expect(names).toContain('Host');
    expect(names).toContain('Member');
  });

  it('lists the game for the spectator with role=spectator', async () => {
    const res = await request(server()).get('/api/v1/history').set(auth(watcher.token)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].role).toBe('spectator');
  });

  it('is empty for a non-member', async () => {
    const res = await request(server())
      .get('/api/v1/history')
      .set(auth(outsider.token))
      .expect(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/v1/history/:gameId', () => {
  it('200 for member and spectator; 404 for non-member; 401 unauthenticated', async () => {
    await request(server()).get(`/api/v1/history/${gameId}`).set(auth(member.token)).expect(200);
    await request(server()).get(`/api/v1/history/${gameId}`).set(auth(watcher.token)).expect(200);
    await request(server()).get(`/api/v1/history/${gameId}`).set(auth(outsider.token)).expect(404);
    await request(server()).get(`/api/v1/history/${gameId}`).expect(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/server test --run history-replay`
Expected: FAIL — list rows have `_id` not `gameId`/`role`/`replayable`; watcher's list is empty; outsider's `GET :gameId` returns 200 instead of 404.

- [ ] **Step 3: Create the zod schemas**

Create `apps/server/src/history/history.schemas.ts`:

```ts
// Zod is the single source for validation + OpenAPI (ADR A3). These schemas document the
// history/replay responses; they are not request pipes.
import { z } from 'zod';

export const HistoryPlayerSchema = z.object({
  userId: z.string(),
  seat: z.number(),
  // Absent for bots and TTL-expired guests — the client falls back to P{seat+1} / a bot label.
  displayName: z.string().optional(),
});

export const MatchSummarySchema = z.object({
  gameId: z.string(),
  players: z.array(HistoryPlayerSchema),
  winners: z.array(z.string()),
  completedAt: z.string(), // ISO 8601
  role: z.enum(['player', 'spectator']),
  finalScores: z.unknown(), // engine FinalScoreboard, passed through for the list UI
  replayable: z.boolean(),
});

export const ReplayPlayerSchema = HistoryPlayerSchema.extend({
  isBot: z.boolean().optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
});

export const ReplayPayloadSchema = z.object({
  gameId: z.string(),
  config: z.object({
    seed: z.union([z.string(), z.number()]),
    players: z.array(z.object({ id: z.string(), seat: z.number() })),
    contentHash: z.string(),
    ruleParams: z.record(z.string(), z.unknown()).optional(),
    shuffleTurnOrder: z.boolean().optional(),
  }),
  engineVersion: z.number(),
  schemaVersion: z.number(),
  actions: z.array(z.record(z.string(), z.unknown())), // engine Action union (docs-only shape)
  players: z.array(ReplayPlayerSchema),
  winners: z.array(z.string()),
  completedAt: z.string(),
  finalDigest: z.string().optional(),
});
```

- [ ] **Step 4: Rework the repo**

Replace `apps/server/src/history/history.repo.ts` with:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Collection, Db } from 'mongodb';
import { ENGINE_VERSION, boardForContentHash } from '@trm/engine';
import type { Action } from '@trm/engine';
import { MONGO_DB } from '../db/tokens';
import type { GameDoc, GameEventDoc, MatchHistoryDoc, StoredConfig } from '../persistence/types';
import type { UserDoc } from '../auth/user.repo';
import type { BotProfile } from '../bots/types';

export interface HistoryPlayer {
  userId: string;
  seat: number;
  displayName?: string;
}

export interface MatchSummary {
  gameId: string;
  players: HistoryPlayer[];
  winners: string[];
  completedAt: string;
  role: 'player' | 'spectator';
  finalScores: MatchHistoryDoc['finalScores'];
  replayable: boolean;
}

export interface ReplayData {
  config: StoredConfig;
  engineVersion: number;
  schemaVersion: number;
  bots: BotProfile[];
  actions: Action[];
  finalDigest?: string;
}

/** Replayable = same engine major + a board we can still build for that content hash. */
const isReplayable = (engineVersion: number | undefined, contentHash: string): boolean => {
  if (engineVersion !== ENGINE_VERSION) return false;
  try {
    boardForContentHash(contentHash);
    return true;
  } catch {
    return false;
  }
};

@Injectable()
export class HistoryRepo {
  private readonly col: Collection<MatchHistoryDoc>;
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly users: Collection<UserDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<MatchHistoryDoc>('matchHistory');
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.users = db.collection<UserDoc>('users');
  }

  /** Display names for userIds (bots and TTL-expired guests simply don't match). */
  async displayNames(userIds: string[]): Promise<Map<string, string>> {
    const humans = [...new Set(userIds)].filter((id) => !id.startsWith('bot:'));
    if (humans.length === 0) return new Map();
    const docs = await this.users
      .find({ _id: { $in: humans } }, { projection: { displayName: 1 } })
      .toArray();
    return new Map(docs.map((u) => [u._id, u.displayName]));
  }

  /** Finished games the user played in or spectated, newest first. */
  async listForUser(userId: string, limit = 50): Promise<MatchSummary[]> {
    const docs = await this.col
      .find({ $or: [{ 'players.userId': userId }, { spectators: userId }] })
      .sort({ completedAt: -1 })
      .limit(limit)
      .toArray();

    // Legacy archives predate the engineVersion stamp — read it off the game doc instead.
    const missing = docs.filter((d) => d.engineVersion === undefined).map((d) => d._id);
    const versions = new Map<string, number>();
    if (missing.length > 0) {
      const games = await this.games
        .find({ _id: { $in: missing } }, { projection: { engineVersion: 1 } })
        .toArray();
      for (const g of games) versions.set(g._id, g.engineVersion);
    }
    const names = await this.displayNames(docs.flatMap((d) => d.players.map((p) => p.userId)));

    return docs.map((d) => ({
      gameId: d._id,
      players: d.players.map((p) => ({
        userId: p.userId,
        seat: p.seat,
        ...(names.has(p.userId) ? { displayName: names.get(p.userId) } : {}),
      })),
      winners: d.winners,
      completedAt: d.completedAt.toISOString(),
      role: d.players.some((p) => p.userId === userId)
        ? ('player' as const)
        : ('spectator' as const),
      finalScores: d.finalScores,
      replayable: isReplayable(d.engineVersion ?? versions.get(d._id), d.contentHash),
    }));
  }

  /** The archive doc IF the user played or spectated it; null otherwise (→ 404 upstream). */
  getForUser(gameId: string, userId: string): Promise<MatchHistoryDoc | null> {
    return this.col.findOne({
      _id: gameId,
      $or: [{ 'players.userId': userId }, { spectators: userId }],
    });
  }

  /**
   * Full replay payload: stored config + the ordered action log. `status: 'COMPLETED'` is the
   * hard gate — a LIVE game's action log encodes hidden information (payments, kept tickets,
   * deck order via the seed) and must never leave the server. Shipping a FINISHED game's log
   * to an authorized participant/spectator is by design (see docs: replay feature).
   */
  async loadReplay(gameId: string): Promise<ReplayData | null> {
    const game = await this.games.findOne({ _id: gameId, status: 'COMPLETED' });
    if (!game) return null;
    const events = await this.events.find({ gameId }).sort({ seq: 1 }).toArray();
    const last = events[events.length - 1];
    return {
      config: game.config,
      engineVersion: game.engineVersion,
      schemaVersion: game.schemaVersion,
      bots: game.bots ?? [],
      actions: events.map((e) => e.action),
      ...(last ? { finalDigest: last.stateDigest } : {}),
    };
  }
}
```

- [ ] **Step 5: Update the controller (list shape + authz fix)**

Replace `apps/server/src/history/history.controller.ts` with (the `/replay` route is added in Task 4; keep this file exactly as below for now):

```ts
import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { HistoryRepo } from './history.repo';
import { MatchSummarySchema } from './history.schemas';
import { apiSchema } from '../openapi/openapi';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

@ApiTags('history')
@ApiBearerAuth('access-token')
@UseGuards(AccessTokenGuard)
@Controller('api/v1/history')
export class HistoryController {
  constructor(private readonly repo: HistoryRepo) {}

  @Get()
  @ApiOperation({ summary: 'List finished games you played in or spectated' })
  @ApiResponse({ status: 200, schema: apiSchema(z.array(MatchSummarySchema)) })
  list(@CurrentUser() user: AuthUser) {
    return this.repo.listForUser(user.userId);
  }

  @Get(':gameId')
  @ApiOperation({ summary: 'One finished game (scoreboard) — members and spectators only' })
  async get(@Param('gameId') gameId: string, @CurrentUser() user: AuthUser) {
    // 404 (not 403) for non-members: don't reveal whether the game exists.
    const doc = await this.repo.getForUser(gameId, user.userId);
    if (!doc) throw new NotFoundException('game not found');
    return doc;
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `yarn workspace @trm/server test --run history-replay` — Expected: PASS (the 5 tests above; the drive-to-completion beforeAll takes ~30–90 s).
Run: `yarn workspace @trm/server test --run docs.e2e` — Expected: PASS (if it asserts on route/schema counts, update it for the changed history routes).
Run: `yarn typecheck` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/history apps/server/test/history-replay.e2e.spec.ts
git commit -m "feat(server): history list covers spectated games; membership-gate game lookups"
```

---

### Task 4: Server — replay payload endpoint

**Files:**
- Modify: `apps/server/src/history/history.controller.ts`
- Test: `apps/server/test/history-replay.e2e.spec.ts` (extend)

**Interfaces:**
- Consumes: `HistoryRepo.loadReplay` / `getForUser` / `displayNames` (Task 3), `ReplayPayloadSchema` (Task 3), `storedToConfig` (`src/persistence/types.ts:118`).
- Produces: `GET /api/v1/history/:gameId/replay` → `{ gameId, config: StoredConfig, engineVersion, schemaVersion, actions: Action[], players: {userId, seat, displayName?, isBot?, difficulty?}[], winners, completedAt, finalDigest? }`. The web client (Tasks 6/9) consumes this shape verbatim.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/history-replay.e2e.spec.ts`:

```ts
describe('GET /api/v1/history/:gameId/replay', () => {
  it('returns config + the full ordered action log; a pure replay reproduces finalDigest', async () => {
    const res = await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(host.token))
      .expect(200);
    expect(res.body.gameId).toBe(gameId);
    expect(res.body.engineVersion).toBeTypeOf('number');
    expect(res.body.schemaVersion).toBeTypeOf('number');
    expect(res.body.actions.length).toBeGreaterThan(0);
    expect(res.body.finalDigest).toBeTypeOf('string');
    const names = res.body.players.map((p: { displayName?: string }) => p.displayName);
    expect(names).toContain('Host');

    // Determinism seal: replaying the returned log reproduces the persisted final digest.
    const rep = replay(board, storedToConfig(res.body.config), res.body.actions);
    expect(rep.state.turn.phase).toBe('GAME_OVER');
    expect(stateDigest(rep.state)).toBe(res.body.finalDigest);
  });

  it('is allowed for spectators; 404 for non-members', async () => {
    await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(watcher.token))
      .expect(200);
    await request(server())
      .get(`/api/v1/history/${gameId}/replay`)
      .set(auth(outsider.token))
      .expect(404);
  });

  it('404 while a game is LIVE, even if an archive row exists (belt-and-braces)', async () => {
    const now = new Date();
    await t.db.collection('games').insertOne({
      _id: 'live-1',
      seed: 's',
      config: { seed: 's', players: [{ id: host.id, seat: 0 }], contentHash: 'x' },
      engineVersion: 1,
      contentHash: 'x',
      schemaVersion: 1,
      status: 'LIVE',
      currentSeq: 0,
      createdAt: now,
      updatedAt: now,
    });
    await t.db.collection('matchHistory').insertOne({
      _id: 'live-1',
      players: [{ userId: host.id, seat: 0 }],
      turnOrder: [host.id],
      seed: 's',
      contentHash: 'x',
      finalScores: { players: [], ranking: [] },
      winners: [],
      completedAt: now,
    });
    await request(server())
      .get('/api/v1/history/live-1/replay')
      .set(auth(host.token))
      .expect(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/server test --run history-replay`
Expected: FAIL — 404 on `/replay` (route does not exist).

- [ ] **Step 3: Add the route**

In `apps/server/src/history/history.controller.ts`, update the schemas import to
`import { MatchSummarySchema, ReplayPayloadSchema } from './history.schemas';`
and add after the `get` method:

```ts
  @Get(':gameId/replay')
  @ApiOperation({ summary: 'Replay payload (config + action log) for a finished game' })
  @ApiResponse({ status: 200, schema: apiSchema(ReplayPayloadSchema) })
  async replay(@Param('gameId') gameId: string, @CurrentUser() user: AuthUser) {
    // Same membership gate as `get`; the repo additionally hard-gates on status=COMPLETED —
    // a live game's action log encodes hidden information and must never leave the server.
    const doc = await this.repo.getForUser(gameId, user.userId);
    if (!doc) throw new NotFoundException('game not found');
    const data = await this.repo.loadReplay(gameId);
    if (!data) throw new NotFoundException('replay not available');

    const names = await this.repo.displayNames(doc.players.map((p) => p.userId));
    const botsById = new Map(data.bots.map((b) => [b.playerId, b]));
    return {
      gameId: doc._id,
      config: data.config,
      engineVersion: data.engineVersion,
      schemaVersion: data.schemaVersion,
      actions: data.actions,
      players: doc.players.map((p) => ({
        userId: p.userId,
        seat: p.seat,
        ...(names.has(p.userId) ? { displayName: names.get(p.userId) } : {}),
        ...(botsById.has(p.userId)
          ? { isBot: true, difficulty: botsById.get(p.userId)!.difficulty }
          : {}),
      })),
      winners: doc.winners,
      completedAt: doc.completedAt.toISOString(),
      ...(data.finalDigest ? { finalDigest: data.finalDigest } : {}),
    };
  }
```

(If `BotProfile`'s id field is named differently than `playerId`, follow the type error — it is defined in `apps/server/src/bots/types.ts`.)

- [ ] **Step 4: Run the tests**

Run: `yarn workspace @trm/server test --run history-replay` — Expected: PASS (8 tests total).
Run: `yarn workspace @trm/server test` — Expected: full server suite PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/history/history.controller.ts apps/server/test/history-replay.e2e.spec.ts
git commit -m "feat(server): replay payload endpoint for finished games"
```

---

### Task 5: Web — contextual log store

**Files:**
- Modify: `apps/web/src/store/log.ts`
- Modify: `apps/web/src/components/LogPanel.tsx`
- Modify: `apps/web/src/store/sandboxProvider.tsx`
- Test: `apps/web/src/store/log.test.ts` (extend)

**Interfaces:**
- Consumes: the contextual-store pattern in `apps/web/src/store/game.ts:82-103` (copy it exactly).
- Produces: `createLogStore(): LogStoreApi`, `LogStoreProvider`, `useLogStore(selector)`, `useLogStoreApi()`, `type LogStoreApi` — Task 8/9 rely on these names. `useLog` singleton and `net/connection.ts` stay untouched.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/store/log.test.ts`:

```ts
import { createLogStore } from './log';

describe('contextual log store', () => {
  it('createLogStore returns an isolated instance (singleton untouched)', () => {
    const iso = createLogStore();
    iso.setState({ entries: [{ id: 1, kind: 'gameStarted', playerId: null, data: {} }], nextId: 2 });
    expect(iso.getState().entries).toHaveLength(1);
    expect(useLog.getState().entries).toHaveLength(0);
  });
});
```

(Match the file's existing imports — it already imports `useLog`; if the `LogEntry` literal needs a cast, use `as unknown as LogEntry[]` with `import type { LogEntry } from '../game/logModel';`.)

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/web test --run log.test`
Expected: FAIL — `createLogStore` is not exported.

- [ ] **Step 3: Implement**

Replace `apps/web/src/store/log.ts` with:

```ts
import { create, useStore, type StateCreator } from 'zustand';
import { createContext, useContext } from 'react';
import type { GameEvent } from '@trm/proto';
import { entriesFromEvents, type LogEntry } from '../game/logModel';

const CAP = 1000;

interface LogState {
  entries: LogEntry[];
  nextId: number;
  ingestLive(events: GameEvent[]): void;
  ingestHistory(events: GameEvent[]): void;
  reset(): void;
}

const creator: StateCreator<LogState> = (set) => ({
  entries: [],
  nextId: 1,
  ingestLive: (events) =>
    set((s) => {
      const datas = entriesFromEvents(events);
      if (datas.length === 0) return s;
      let id = s.nextId;
      const entries = [...s.entries];
      for (const d of datas) entries.push({ id: id++, ...d });
      return { entries: entries.slice(-CAP), nextId: id };
    }),
  // History is the server's COMPLETE backfill, re-sent on every (re)connect and always
  // delivered before any live event on that connection. Replace the store with it so a
  // transient reconnect re-fills the disconnect-window gap; live events then append.
  ingestHistory: (events) =>
    set(() => {
      const entries = entriesFromEvents(events).map((d, i) => ({ id: i + 1, ...d }));
      return { entries: entries.slice(-CAP), nextId: entries.length + 1 };
    }),
  reset: () => set({ entries: [], nextId: 1 }),
});

/** The live game's log singleton (the WebSocket bridge in net/connection.ts writes here). */
export const useLog = create<LogState>()(creator);

/** Create an ISOLATED log store (replay/sandbox) — mirrors store/game.ts's contextual pattern. */
export const createLogStore = () => create<LogState>()(creator);

export type LogStoreApi = typeof useLog;
const LogStoreContext = createContext<LogStoreApi | null>(null);
export const LogStoreProvider = LogStoreContext.Provider;

/** Subscribe to the contextual log store — the isolated one under a provider, else the singleton. */
export function useLogStore<T>(selector: (s: LogState) => T): T {
  const store = useContext(LogStoreContext) ?? useLog;
  return useStore(store, selector);
}

/** The contextual store object itself, for imperative `.getState()` use in effects/hooks. */
export function useLogStoreApi(): LogStoreApi {
  return useContext(LogStoreContext) ?? useLog;
}
```

In `apps/web/src/components/LogPanel.tsx`:
- change `import { useLog } from '../store/log';` → `import { useLogStore } from '../store/log';`
- change `import { useGame } from '../store/game';` → `import { useGameStore } from '../store/game';`
- change `const entries = useLog((s) => s.entries);` → `const entries = useLogStore((s) => s.entries);`
- change `const snapshot = useGame((s) => s.snapshot);` → `const snapshot = useGameStore((s) => s.snapshot);`

(The `useGame`→`useGameStore` switch is also a latent-bug fix: under a provider the panel now reads the sandboxed snapshot instead of the live singleton. Outside a provider both hooks resolve to the same singletons — existing `LogPanel.test.tsx` keeps passing unchanged.)

In `apps/web/src/store/sandboxProvider.tsx`, add the log store alongside the others:

```tsx
import { useState, type ReactNode } from 'react';
import { createGameStore, GameStoreProvider } from './game';
import { createAnimationsStore, AnimationsStoreProvider } from './animations';
import { createLogStore, LogStoreProvider } from './log';

export function SandboxProvider({ children }: { children: ReactNode }) {
  const [gameStore] = useState(() => createGameStore());
  const [animStore] = useState(() => createAnimationsStore());
  const [logStore] = useState(() => createLogStore());
  return (
    <GameStoreProvider value={gameStore}>
      <AnimationsStoreProvider value={animStore}>
        <LogStoreProvider value={logStore}>{children}</LogStoreProvider>
      </AnimationsStoreProvider>
    </GameStoreProvider>
  );
}
```

(Keep the existing doc comment on the component.)

- [ ] **Step 4: Run the tests**

Run: `yarn workspace @trm/web test --run log.test` — Expected: PASS.
Run: `yarn workspace @trm/web test --run LogPanel` — Expected: PASS.
Run: `yarn workspace @trm/web test --run sandboxProvider` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store/log.ts apps/web/src/components/LogPanel.tsx apps/web/src/store/sandboxProvider.tsx apps/web/src/store/log.test.ts
git commit -m "refactor(web): contextual log store so sandboxed views get an isolated log"
```

---

### Task 6: Web — REST types, routes, header entry, i18n keys

**Files:**
- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/store/ui.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AppHeader.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/store/ui.test.ts` (extend)

**Interfaces:**
- Produces (Tasks 7–9 rely on these): `View` includes `'history' | 'replay'`; `useUi` state `replayGameId: string | null`; actions `enterHistory()`, `enterReplay(gameId)`; REST types `MatchSummary`, `HistoryPlayer`, `ReplayPlayerMeta`, `ReplayPayload`; `api.history()`, `api.replay(gameId)`; i18n namespace `history.*`.

- [ ] **Step 1: Write the failing routing tests**

Append inside the `describe('ui store routing', ...)` block of `apps/web/src/store/ui.test.ts`:

```ts
  it('enterHistory pushes /history, sets the view, and disconnects any live game', () => {
    useUi.getState().enterHistory();
    expect(useUi.getState().view).toBe('history');
    expect(path()).toBe('/history');
    expect(disconnectGame).toHaveBeenCalled();
  });

  it('enterReplay pushes /replay/:id and records the game id', () => {
    useUi.getState().enterReplay('game-9');
    expect(useUi.getState().view).toBe('replay');
    expect(useUi.getState().replayGameId).toBe('game-9');
    expect(path()).toBe('/replay/game-9');
  });

  it('syncFromUrl(authed) on /replay/:id restores the replay view', () => {
    window.history.replaceState(null, '', '/replay/game-9');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('replay');
    expect(useUi.getState().replayGameId).toBe('game-9');
  });

  it('syncFromUrl(not authed) on /history gates to /login remembering the target', () => {
    window.history.replaceState(null, '', '/history');
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('login');
    expect(window.location.pathname + window.location.search).toBe(
      '/login?redirect=%2Fhistory',
    );
  });

  it('goHome clears a replay id', () => {
    useUi.getState().enterReplay('game-9');
    useUi.getState().goHome();
    expect(useUi.getState().replayGameId).toBeNull();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/web test --run ui.test`
Expected: FAIL — `enterHistory` is not a function.

- [ ] **Step 3: Implement `ui.ts`**

In `apps/web/src/store/ui.ts`:

1. View union:
```ts
export type View =
  | 'home'
  | 'room'
  | 'game'
  | 'tutorial'
  | 'login'
  | 'loginCallback'
  | 'history'
  | 'replay';
```

2. After `const TUTORIAL_PATH = '/tutorial';` add:
```ts
const HISTORY_PATH = '/history';
const REPLAY_PATH = /^\/replay\/([^/]+)$/;

export const replayIdFromPath = (): string | null => {
  const id = REPLAY_PATH.exec(window.location.pathname)?.[1];
  return id ? decodeURIComponent(id) : null;
};
```

3. In `UiState`, after `ticket: string | null;` add `replayGameId: string | null;` and after `enterTutorial(): void;` add:
```ts
  /** Open the game-history screen (finished games the user played or spectated). */
  enterHistory(): void;
  /** Open the replay player for one finished game. */
  enterReplay(gameId: string): void;
```

4. In the store initializer, after `ticket: null,` add `replayGameId: null,`.

5. Add `replayGameId: null` to **every existing `set()` call that already sets `roomCode: null`** (there are seven: `goHome`, `enterTutorial`, `navigateLogin`, `navigateAfterAuth` ×2 branches, and the `syncFromUrl` branches for tutorial / loginCallback / login-unauthed / home).

6. New actions (place after `enterTutorial`):
```ts
  enterHistory: () => {
    disconnectGame();
    pushPath(HISTORY_PATH);
    set({ view: 'history', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  enterReplay: (gameId) => {
    disconnectGame();
    pushPath(`/replay/${encodeURIComponent(gameId)}`);
    set({ view: 'replay', replayGameId: gameId, roomCode: null, gameId: null, ticket: null });
  },
```

7. In `syncFromUrl`, insert **before** the `const code = roomCodeFromPath();` line:
```ts
    // History + replay are account-scoped — gate unauthenticated visitors like rooms.
    if (path === HISTORY_PATH) {
      if (!authed) {
        get().navigateLogin(HISTORY_PATH);
        return;
      }
      disconnectGame();
      set({ view: 'history', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    const replayId = replayIdFromPath();
    if (replayId) {
      if (!authed) {
        get().navigateLogin(`/replay/${encodeURIComponent(replayId)}`);
        return;
      }
      disconnectGame();
      set({
        view: 'replay',
        replayGameId: replayId,
        roomCode: null,
        gameId: null,
        ticket: null,
      });
      return;
    }
```

8. In `navigateAfterAuth`, after the room-code branch and before `replacePath('/');` add (so a gated deep link resumes after sign-in):
```ts
    if (target === HISTORY_PATH) {
      replacePath(HISTORY_PATH);
      set({ view: 'history', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    const replayId = REPLAY_PATH.exec(target)?.[1];
    if (replayId) {
      const id = decodeURIComponent(replayId);
      replacePath(`/replay/${encodeURIComponent(id)}`);
      set({ view: 'replay', replayGameId: id, roomCode: null, gameId: null, ticket: null });
      return;
    }
```

- [ ] **Step 4: Implement `rest.ts`**

In `apps/web/src/net/rest.ts`, replace the old `MatchSummary` interface (lines 65–70) with:

```ts
export interface HistoryPlayer {
  userId: string;
  seat: number;
  displayName?: string;
}
export interface MatchSummary {
  gameId: string;
  players: HistoryPlayer[];
  winners: string[];
  completedAt: string;
  role: 'player' | 'spectator';
  finalScores: unknown;
  replayable: boolean;
}
export interface ReplayPlayerMeta extends HistoryPlayer {
  isBot?: boolean;
  difficulty?: BotDifficulty;
}
/** actions stay `unknown[]` here so the eager bundle never imports @trm/engine types;
 *  the lazy replay feature narrows them to engine `Action[]`. */
export interface ReplayPayload {
  gameId: string;
  config: {
    seed: string | number;
    players: { id: string; seat: number }[];
    contentHash: string;
    ruleParams?: Record<string, unknown>;
    shuffleTurnOrder?: boolean;
  };
  engineVersion: number;
  schemaVersion: number;
  actions: unknown[];
  players: ReplayPlayerMeta[];
  winners: string[];
  completedAt: string;
  finalDigest?: string;
}
```

And replace the `history:` entry in `api` with:

```ts
  history: () => req<MatchSummary[]>('GET', '/history'),
  replay: (gameId: string) =>
    req<ReplayPayload>('GET', `/history/${encodeURIComponent(gameId)}/replay`),
```

- [ ] **Step 5: Implement `App.tsx` + `AppHeader.tsx` + i18n keys**

`apps/web/src/App.tsx`:
- add `import { HistoryScreen } from './screens/HistoryScreen';` (created in Task 7 — to keep this task compiling, create the placeholder screen now, full version in Task 7; see below) and `const ReplayScreen = lazy(() => import('./screens/ReplayScreen'));` next to the other lazy screens.
- change `const isGameLayout = view === 'game' || view === 'tutorial';` → `const isGameLayout = view === 'game' || view === 'tutorial' || view === 'replay';`
- add render branches after `{view === 'room' && <RoomScreen />}`:
```tsx
            {view === 'history' && <HistoryScreen />}
            {view === 'replay' && (
              <Suspense fallback={<div className="card">{t('connecting')}</div>}>
                <ReplayScreen />
              </Suspense>
            )}
```

To keep this task independently green, create minimal stubs (fully replaced by Tasks 7/9):

`apps/web/src/screens/HistoryScreen.tsx`:
```tsx
import { useTranslation } from 'react-i18next';

export function HistoryScreen() {
  const { t } = useTranslation();
  return (
    <div className="stack">
      <div className="card">
        <h2>{t('history.title')}</h2>
      </div>
    </div>
  );
}
```

`apps/web/src/screens/ReplayScreen.tsx`:
```tsx
export default function ReplayScreen() {
  return null;
}
```

`apps/web/src/components/AppHeader.tsx`:
- add `History` to the lucide import list;
- add `const enterHistory = useUi((s) => s.enterHistory);` next to the other `useUi` selectors;
- insert before the encyclopedia button:
```tsx
        {user && view !== 'login' && view !== 'loginCallback' && !inGame && (
          <button
            onClick={enterHistory}
            aria-label={t('history.title')}
            title={t('history.title')}
          >
            <History size={16} aria-hidden />
          </button>
        )}
```

`apps/web/src/i18n/index.ts` — add a nested `history` block to **both** locale objects (alongside the other top-level groups such as `log`):

zh-Hant:
```ts
      history: {
        title: '對局紀錄',
        empty: '尚無完成的對局',
        rolePlayer: '玩家',
        roleSpectator: '觀戰',
        watchReplay: '重播',
        notReplayable: '此對局由較舊的遊戲版本產生，無法重播',
        unknownMap: '找不到此對局使用的地圖版本',
        loadFailed: '無法載入對局',
        perspective: '視角',
        publicView: '公開視角',
        step: '第 {{n}} / {{total}} 步',
        backToHistory: '返回對局紀錄',
        bot: '機器人',
      },
```

en:
```ts
      history: {
        title: 'Game history',
        empty: 'No finished games yet',
        rolePlayer: 'Player',
        roleSpectator: 'Spectator',
        watchReplay: 'Replay',
        notReplayable: 'Played on an older game version — replay unavailable',
        unknownMap: 'The map version this game used is not available',
        loadFailed: 'Could not load the game',
        perspective: 'Perspective',
        publicView: 'Public view',
        step: 'Step {{n}} / {{total}}',
        backToHistory: 'Back to history',
        bot: 'Bot',
      },
```

(Match the file's actual indentation for nested groups; playback buttons reuse the existing `tutorial.play/pause/prevStep/nextStep` keys.)

- [ ] **Step 6: Run the tests**

Run: `yarn workspace @trm/web test --run ui.test` — Expected: PASS.
Run: `yarn workspace @trm/web test --run rest.test` — Expected: PASS (fix any assertion still using the old `MatchSummary._id`).
Run: `yarn typecheck` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/store/ui.ts apps/web/src/store/ui.test.ts apps/web/src/App.tsx apps/web/src/components/AppHeader.tsx apps/web/src/i18n/index.ts apps/web/src/screens/HistoryScreen.tsx apps/web/src/screens/ReplayScreen.tsx
git commit -m "feat(web): /history and /replay routes, header entry, replay REST client"
```

---

### Task 7: Web — History screen

**Files:**
- Modify: `apps/web/src/screens/HistoryScreen.tsx` (replace the Task-6 stub)
- Create: `apps/web/src/styles/history.css`
- Test (create): `apps/web/src/screens/HistoryScreen.test.tsx`

**Interfaces:**
- Consumes: `api.history()`, `MatchSummary` (Task 6), `useUi.enterReplay`, i18n `history.*`.
- Produces: the list UI. No exports consumed elsewhere.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/screens/HistoryScreen.test.tsx` (mirrors `HomeScreen.test.tsx` conventions):

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { HistoryScreen } from './HistoryScreen';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api, type MatchSummary } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', () => ({
  setOnTokenChange: vi.fn(),
  setAccessToken: vi.fn(),
  api: { history: vi.fn() },
}));

const mocked = api as unknown as { history: ReturnType<typeof vi.fn> };

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
} as const;

const row = (over: Partial<MatchSummary> = {}): MatchSummary => ({
  gameId: 'g1',
  players: [
    { userId: 'u1', seat: 0, displayName: 'Tester' },
    { userId: 'u2', seat: 1, displayName: 'Rival' },
  ],
  winners: ['u2'],
  completedAt: '2026-07-01T10:00:00.000Z',
  role: 'player',
  finalScores: null,
  replayable: true,
  ...over,
});

describe('HistoryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'history', replayGameId: null });
    window.history.replaceState(null, '', '/history');
  });

  it('renders rows with names and a role badge; the replay button opens the player', async () => {
    mocked.history.mockResolvedValue([row()]);
    render(<HistoryScreen />);
    expect(await screen.findByText('Rival')).toBeInTheDocument();
    expect(screen.getByText('玩家')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重播/ }));
    expect(useUi.getState().view).toBe('replay');
    expect(useUi.getState().replayGameId).toBe('g1');
  });

  it('disables replay for non-replayable games', async () => {
    mocked.history.mockResolvedValue([row({ replayable: false })]);
    render(<HistoryScreen />);
    expect(await screen.findByRole('button', { name: /重播/ })).toBeDisabled();
  });

  it('marks spectated games with the spectator badge', async () => {
    mocked.history.mockResolvedValue([row({ role: 'spectator' })]);
    render(<HistoryScreen />);
    expect(await screen.findByText('觀戰')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mocked.history.mockResolvedValue([]);
    render(<HistoryScreen />);
    expect(await screen.findByText('尚無完成的對局')).toBeInTheDocument();
  });

  it('shows the error state when the fetch fails', async () => {
    mocked.history.mockRejectedValue(new Error('boom'));
    render(<HistoryScreen />);
    expect(await screen.findByText('無法載入對局')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/web test --run HistoryScreen`
Expected: FAIL — the stub renders only the title.

- [ ] **Step 3: Implement the screen**

Replace `apps/web/src/screens/HistoryScreen.tsx` with:

```tsx
// Finished games the user played in or spectated — each row opens the replay player.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { api, type MatchSummary } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import '../styles/history.css';

export function HistoryScreen() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const enterReplay = useUi((s) => s.enterReplay);
  const locale = useUi((s) => s.locale);
  const [rows, setRows] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .history()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;

  const nameOf = (p: MatchSummary['players'][number]): string =>
    p.displayName || (p.userId.startsWith('bot:') ? t('history.bot') : `P${p.seat + 1}`);

  return (
    <div className="stack history-screen">
      <div className="card">
        <h2>{t('history.title')}</h2>
        {error && <p className="history-error">{t('history.loadFailed')}</p>}
        {rows && rows.length === 0 && <p className="history-empty">{t('history.empty')}</p>}
        {rows?.map((m) => (
          <div className="history-row" key={m.gameId}>
            <div className="history-meta">
              <span className="history-date">{new Date(m.completedAt).toLocaleString(locale)}</span>
              <span className={`history-role history-role--${m.role}`}>
                {t(m.role === 'player' ? 'history.rolePlayer' : 'history.roleSpectator')}
              </span>
            </div>
            <div className="history-players">
              {m.players.map((p) => (
                <span
                  key={p.userId}
                  className={'history-player' + (m.winners.includes(p.userId) ? ' is-winner' : '')}
                >
                  {nameOf(p)}
                </span>
              ))}
            </div>
            <button
              onClick={() => enterReplay(m.gameId)}
              disabled={!m.replayable}
              title={m.replayable ? t('history.watchReplay') : t('history.notReplayable')}
            >
              <Play size={14} aria-hidden /> {t('history.watchReplay')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Create `apps/web/src/styles/history.css`:

```css
.history-screen .card {
  max-width: 720px;
  margin: 0 auto;
}
.history-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--border, rgba(128, 128, 128, 0.25));
}
.history-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 160px;
}
.history-date {
  font-size: 0.85em;
  opacity: 0.75;
}
.history-role {
  font-size: 0.75em;
  width: fit-content;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid currentColor;
  opacity: 0.85;
}
.history-players {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}
.history-player.is-winner {
  font-weight: 700;
}
.history-player.is-winner::after {
  content: ' ★';
}
.history-empty,
.history-error {
  opacity: 0.75;
  padding: 8px 0;
}
```

(Reuse existing CSS variables/classes where they exist — check `styles/app.css` for the border token name and match it.)

- [ ] **Step 4: Run the tests**

Run: `yarn workspace @trm/web test --run HistoryScreen` — Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/HistoryScreen.tsx apps/web/src/screens/HistoryScreen.test.tsx apps/web/src/styles/history.css
git commit -m "feat(web): game-history screen listing played and spectated games"
```

---

### Task 8: Web — the replay player hook

**Files:**
- Create: `apps/web/src/features/replay/useReplayPlayer.ts`
- Test (create): `apps/web/src/features/replay/useReplayPlayer.test.ts`

**Interfaces:**
- Consumes: `@trm/engine` (`initGame`, `reduce`, `redactFor`, `cloneState`, `stateDigest`), `@trm/codec` (`viewToSnapshot`, `eventToProto`) — the exact projection recipe of `net/sandboxSocket.ts:70-79`; `GameStoreApi` (`store/game.ts:88`), `LogStoreApi` (Task 5).
- Produces (Task 9 relies on this exact shape):

```ts
export interface ReplayControls {
  step: number;          // actions applied, 0..total
  total: number;
  playing: boolean;
  viewer: PlayerId | null; // null = public/spectator projection
  atEnd: boolean;
  error: boolean;        // an action failed to replay (version skew) — UI shows a friendly card
  setViewer(viewer: PlayerId | null): void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(step: number): void;
}
export function useReplayPlayer(
  board: Board,
  config: GameConfig,
  actions: readonly Action[],
  initialViewer: PlayerId | null,
  stores: { game: GameStoreApi; log: LogStoreApi },
  finalDigest?: string,
): ReplayControls;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/replay/useReplayPlayer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  taiwanBoard,
  initGame,
  reduce,
  replay,
  redactFor,
  legalActions,
  CONTENT_HASH,
} from '@trm/engine';
import type { Action, GameConfig, PlayerSeed } from '@trm/engine';
import { viewToSnapshot } from '@trm/codec';
import { asPlayerId, type PlayerId } from '@trm/shared';
import { createGameStore } from '../../store/game';
import { createLogStore } from '../../store/log';
import { useReplayPlayer } from './useReplayPlayer';

const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];
const config: GameConfig = { seed: 'replay-test-1', players, contentHash: CONTENT_HASH };

/** Script `count` legal actions with a first-legal-action driver (pure engine, no server). */
function scriptActions(count: number): Action[] {
  const board = taiwanBoard();
  let state = initGame(board, config);
  const out: Action[] = [];
  while (out.length < count && state.turn.phase !== 'GAME_OVER') {
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? players
            .map((p) => p.id)
            .find((p) => (state.players[p as string]?.pendingTicketOffer?.length ?? 0) > 0)!
        : state.turnOrder[state.turn.orderIndex]!;
    const action = legalActions(board, state, actor)[0]!;
    const r = reduce(board, state, action);
    if (!r.ok) throw new Error(`scripted action rejected: ${r.error.code}`);
    state = r.value.state;
    out.push(action);
  }
  return out;
}

function setup(actions: Action[], viewer: PlayerId | null) {
  const game = createGameStore();
  const log = createLogStore();
  const board = taiwanBoard();
  const hook = renderHook(() => useReplayPlayer(board, config, actions, viewer, { game, log }));
  return { game, log, board, hook };
}

describe('useReplayPlayer', () => {
  it('projects genesis on mount (step 0)', () => {
    const { game, hook } = setup(scriptActions(4), asPlayerId('p1'));
    expect(hook.result.current.step).toBe(0);
    expect(hook.result.current.total).toBe(4);
    expect(game.getState().snapshot?.stateVersion).toBe(0);
    expect(game.getState().snapshot?.you?.playerId).toBe('p1');
  });

  it('next() advances one action and feeds animations + the log', () => {
    const actions = scriptActions(10);
    const { game, log, hook } = setup(actions, asPlayerId('p1'));
    act(() => hook.result.current.next());
    expect(hook.result.current.step).toBe(1);
    expect(game.getState().snapshot?.stateVersion).toBe(1);
    expect(game.getState().lastBatch).not.toBeNull();
    expect(log.getState().entries.length).toBeGreaterThan(0);
  });

  it('seek() lands on exactly the snapshot a pure replay produces; seek(0) resets to genesis', () => {
    const actions = scriptActions(40);
    const { game, board, hook } = setup(actions, asPlayerId('p1'));
    act(() => hook.result.current.seek(37));
    expect(hook.result.current.step).toBe(37);
    const rep = replay(board, config, actions.slice(0, 37));
    const expected = viewToSnapshot(redactFor(board, rep.state, asPlayerId('p1')), 37, asPlayerId('p1'));
    expect(game.getState().snapshot).toEqual(expected);
    // Backward seek must work despite applySnapshot's stale-version guard (store reset first).
    act(() => hook.result.current.seek(0));
    expect(game.getState().snapshot?.stateVersion).toBe(0);
  });

  it('setViewer re-projects the same step from another perspective', () => {
    const { game, hook } = setup(scriptActions(6), asPlayerId('p1'));
    act(() => hook.result.current.setViewer(asPlayerId('p2')));
    expect(game.getState().snapshot?.you?.playerId).toBe('p2');
    act(() => hook.result.current.setViewer(null));
    expect(game.getState().snapshot?.you).toBeUndefined();
  });

  it('prev() steps back without animations', () => {
    const { game, hook } = setup(scriptActions(6), null);
    act(() => hook.result.current.next());
    act(() => hook.result.current.next());
    const batchesBefore = game.getState().lastBatch?.seq ?? 0;
    act(() => hook.result.current.prev());
    expect(hook.result.current.step).toBe(1);
    // A rebuild resets the store — no new animation batch was pushed.
    expect(game.getState().lastBatch).toBeNull();
    expect(batchesBefore).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/web test --run useReplayPlayer`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `apps/web/src/features/replay/useReplayPlayer.ts`:

```ts
// Drives a finished game's action log through the LOCAL engine and projects each step through
// redactFor(viewer) → viewToSnapshot into an isolated game store — the same recipe as the
// tutorial sandbox (net/sandboxSocket.ts) plus seek, checkpoints, autoplay, and a switchable
// viewer. Forward steps animate (applyEvents + ingestLive); seeks rebuild silently and backfill
// the log in one shot (ingestHistory), mirroring how a live reconnect avoids re-animating.
import { useCallback, useEffect, useRef, useState } from 'react';
import { initGame, reduce, redactFor, cloneState, stateDigest } from '@trm/engine';
import type { Action, Board, GameConfig, GameState, GameEvent } from '@trm/engine';
import type { PlayerId } from '@trm/shared';
import { viewToSnapshot, eventToProto } from '@trm/codec';
import type { GameEvent as PbGameEvent } from '@trm/proto';
import type { GameStoreApi } from '../../store/game';
import type { LogStoreApi } from '../../store/log';

/** Auto-play cadence (ms per action) — near the tutorial's calm 900 ms beat. */
const STEP_MS = 1100;
/** State checkpoints every N actions so seeks rebuild from nearby, not genesis. */
const CHECKPOINT_EVERY = 32;

export interface ReplayControls {
  step: number;
  total: number;
  playing: boolean;
  viewer: PlayerId | null;
  atEnd: boolean;
  error: boolean;
  setViewer(viewer: PlayerId | null): void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(step: number): void;
}

export function useReplayPlayer(
  board: Board,
  config: GameConfig,
  actions: readonly Action[],
  initialViewer: PlayerId | null,
  stores: { game: GameStoreApi; log: LogStoreApi },
  finalDigest?: string,
): ReplayControls {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [viewer, setViewerState] = useState<PlayerId | null>(initialViewer);
  const [error, setError] = useState(false);

  const stepRef = useRef(0);
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  // Lazily-built caches: raw events emitted by action i, and periodic state checkpoints.
  // Both are viewer-agnostic (redaction happens at projection time).
  const eventsCache = useRef<GameEvent[][]>([]);
  const checkpoints = useRef<Map<number, GameState>>(new Map());

  /** Engine state AFTER k actions, reducing forward from the nearest checkpoint and caching. */
  const stateAt = useCallback(
    (k: number): GameState => {
      let base = 0;
      for (const s of checkpoints.current.keys()) if (s <= k && s > base) base = s;
      let state = checkpoints.current.get(base);
      if (!state) {
        state = initGame(board, config);
        checkpoints.current.set(0, cloneState(state));
      }
      for (let i = base; i < k; i++) {
        const action = actions[i];
        if (!action) throw new Error(`replay: missing action ${i}`);
        const r = reduce(board, state, action);
        if (!r.ok) throw new Error(`replay: action ${i} (${action.t}) rejected: ${r.error.code}`);
        state = r.value.state;
        eventsCache.current[i] = [...r.value.events];
        const n = i + 1;
        if (n % CHECKPOINT_EVERY === 0 && !checkpoints.current.has(n)) {
          checkpoints.current.set(n, cloneState(state));
        }
      }
      return state;
    },
    [board, config, actions],
  );

  const redactEvents = useCallback(
    (events: readonly GameEvent[], v: PlayerId | null): PbGameEvent[] =>
      events.map((e) => eventToProto(e, v)).filter((e): e is PbGameEvent => e !== null),
    [],
  );

  const project = useCallback(
    (state: GameState, v: PlayerId | null) => {
      const view = redactFor(board, state, v);
      stores.game.getState().applySnapshot(viewToSnapshot(view, state.actionSeq, v));
    },
    [board, stores.game],
  );

  /** Rebuild to `target` silently: reset stores (the snapshot guard drops older stateVersions),
   *  restore board state from the nearest checkpoint, backfill the redacted log, project once. */
  const applyTo = useCallback(
    (target: number, v: PlayerId | null) => {
      const clamped = Math.max(0, Math.min(actions.length, target));
      try {
        const state = stateAt(clamped);
        stores.game.getState().reset();
        stores.log.getState().reset();
        const past = eventsCache.current.slice(0, clamped).flat();
        stores.log.getState().ingestHistory(redactEvents(past, v));
        project(state, v);
        stepRef.current = clamped;
        setStep(clamped);
      } catch {
        setError(true);
        setPlaying(false);
      }
    },
    [actions.length, stateAt, stores, redactEvents, project],
  );

  /** One animated forward step: reduce, project, and feed events to animations + the log. */
  const next = useCallback(() => {
    const cur = stepRef.current;
    if (cur >= actions.length) return;
    try {
      const before = stateAt(cur); // cached after the first pass — no recompute
      const action = actions[cur];
      if (!action) return;
      const r = reduce(board, before, action);
      if (!r.ok) throw new Error(`replay: action ${cur} rejected`);
      const state = r.value.state;
      eventsCache.current[cur] = [...r.value.events];
      const n = cur + 1;
      if (n % CHECKPOINT_EVERY === 0 && !checkpoints.current.has(n)) {
        checkpoints.current.set(n, cloneState(state));
      }
      const v = viewerRef.current;
      project(state, v);
      const pb = redactEvents(r.value.events, v);
      if (pb.length > 0) {
        stores.game.getState().applyEvents(state.actionSeq, pb);
        stores.log.getState().ingestLive(pb);
      }
      stepRef.current = n;
      setStep(n);
    } catch {
      setError(true);
      setPlaying(false);
    }
  }, [actions, board, stateAt, project, redactEvents, stores]);

  const seek = useCallback(
    (target: number) => {
      setPlaying(false);
      applyTo(target, viewerRef.current);
    },
    [applyTo],
  );

  const prev = useCallback(() => {
    setPlaying(false);
    applyTo(stepRef.current - 1, viewerRef.current);
  }, [applyTo]);

  const setViewer = useCallback(
    (v: PlayerId | null) => {
      setViewerState(v);
      applyTo(stepRef.current, v);
    },
    [applyTo],
  );

  const play = useCallback(() => {
    if (!error && stepRef.current < actions.length) setPlaying(true);
  }, [error, actions.length]);
  const pause = useCallback(() => setPlaying(false), []);

  // Mount: project genesis. Unmount: clear the (isolated) stores.
  useEffect(() => {
    applyTo(0, viewerRef.current);
    const { game, log } = stores;
    return () => {
      game.getState().reset();
      log.getState().reset();
    };
    // Mount-only by design: board/config/actions are memoized by the screen for the mount's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autoplay: a setTimeout chain that re-arms after each applied step.
  useEffect(() => {
    if (!playing) return;
    if (error || stepRef.current >= actions.length) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(next, STEP_MS);
    return () => clearTimeout(id);
  }, [playing, step, error, actions.length, next]);

  // Optional integrity seal at the end (diagnostic only — never blocks the UX).
  useEffect(() => {
    if (!finalDigest || step !== actions.length || actions.length === 0) return;
    try {
      if (stateDigest(stateAt(actions.length)) !== finalDigest) {
        console.warn('[replay] final state digest mismatch — engine/content drift?');
      }
    } catch {
      /* surfaced via `error` already */
    }
  }, [step, actions.length, finalDigest, stateAt]);

  return {
    step,
    total: actions.length,
    playing,
    viewer,
    atEnd: step >= actions.length,
    error,
    setViewer,
    play,
    pause,
    next,
    prev,
    seek,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `yarn workspace @trm/web test --run useReplayPlayer` — Expected: PASS (5 tests).
Run: `yarn typecheck` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/replay/useReplayPlayer.ts apps/web/src/features/replay/useReplayPlayer.test.ts
git commit -m "feat(web): replay player hook — step/seek/autoplay over the local engine"
```

---

### Task 9: Web — Replay screen, perspective switcher, control bar

**Files:**
- Modify: `apps/web/src/screens/ReplayScreen.tsx` (replace the Task-6 stub)
- Create: `apps/web/src/features/replay/PerspectiveSwitcher.tsx`
- Create: `apps/web/src/styles/replay.css`
- Test (create): `apps/web/src/screens/ReplayScreen.test.tsx`

**Interfaces:**
- Consumes: `useReplayPlayer` (Task 8), `api.replay`/`ReplayPayload` (Task 6), `SandboxProvider` (Task 5 version), `GameStage` (`screens/GameStage.tsx:51` — `commands: null`, `sandbox`), `LogPanel` (contextual, Task 5), `useRoster.setMembers/clear` (`store/roster.ts`), `usePlayerName` (`game/playerName.ts`), `SEAT_COLORS` (`theme/colors.ts:51`, a `string[]`), `boardForContentHash`/`ENGINE_VERSION`/`SCHEMA_VERSION` (`@trm/engine`), `asPlayerId` (`@trm/shared`), tutorial i18n keys for the buttons.
- Produces: the `/replay/:gameId` screen (default export, lazy-loaded from App.tsx).

- [ ] **Step 1: Write the failing guard-rail test**

Create `apps/web/src/screens/ReplayScreen.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import ReplayScreen from './ReplayScreen';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api, type ReplayPayload } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', () => ({
  setOnTokenChange: vi.fn(),
  setAccessToken: vi.fn(),
  api: { replay: vi.fn() },
}));

const mocked = api as unknown as { replay: ReturnType<typeof vi.fn> };

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
} as const;

const payload = (over: Partial<ReplayPayload> = {}): ReplayPayload => ({
  gameId: 'g1',
  config: { seed: 's1', players: [{ id: 'u1', seat: 0 }], contentHash: 'not-a-real-hash' },
  engineVersion: 1, // older than the bundled engine → version guard trips
  schemaVersion: 1,
  actions: [],
  players: [{ userId: 'u1', seat: 0, displayName: 'Tester' }],
  winners: ['u1'],
  completedAt: '2026-07-01T10:00:00.000Z',
  ...over,
});

describe('ReplayScreen guard rails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'replay', replayGameId: 'g1' });
    window.history.replaceState(null, '', '/replay/g1');
  });

  it('shows the version-mismatch card for a game from an older engine', async () => {
    mocked.replay.mockResolvedValue(payload());
    render(<ReplayScreen />);
    expect(await screen.findByText(/較舊的遊戲版本/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回對局紀錄' })).toBeInTheDocument();
  });

  it('shows the load-failed card when the fetch fails', async () => {
    mocked.replay.mockRejectedValue(new Error('boom'));
    render(<ReplayScreen />);
    expect(await screen.findByText('無法載入對局')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @trm/web test --run ReplayScreen`
Expected: FAIL — the stub renders nothing.

- [ ] **Step 3: Implement the switcher, screen, and styles**

Create `apps/web/src/features/replay/PerspectiveSwitcher.tsx`:

```tsx
// Re-project the replay from any seat's perspective (their hand/tickets become visible) or
// the public (null-viewer) projection — the "as they experienced it" toggle.
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { asPlayerId, type PlayerId } from '@trm/shared';
import type { ReplayPlayerMeta } from '../../net/rest';
import { usePlayerName } from '../../game/playerName';
import { SEAT_COLORS } from '../../theme/colors';

export function PerspectiveSwitcher({
  players,
  viewer,
  onChange,
}: {
  players: ReplayPlayerMeta[];
  viewer: PlayerId | null;
  onChange(viewer: PlayerId | null): void;
}) {
  const { t } = useTranslation();
  const nameOf = usePlayerName();
  return (
    <div className="card perspective-switcher">
      <div className="perspective-label">{t('history.perspective')}</div>
      <div className="perspective-pills">
        <button
          className={'perspective-pill' + (viewer === null ? ' is-active' : '')}
          onClick={() => onChange(null)}
        >
          <Eye size={14} aria-hidden /> {t('history.publicView')}
        </button>
        {[...players]
          .sort((a, b) => a.seat - b.seat)
          .map((p) => (
            <button
              key={p.userId}
              className={
                'perspective-pill' + ((viewer as string | null) === p.userId ? ' is-active' : '')
              }
              onClick={() => onChange(asPlayerId(p.userId))}
            >
              <span
                className="perspective-dot"
                style={{ background: SEAT_COLORS[p.seat] ?? '#888' }}
                aria-hidden
              />
              {nameOf({ id: p.userId, seat: p.seat })}
            </button>
          ))}
      </div>
    </div>
  );
}
```

Replace `apps/web/src/screens/ReplayScreen.tsx` with:

```tsx
// The replay player for one finished game (/replay/:gameId). Fetches the replay payload
// (config + action log), guards engine/content version skew, then mounts the standard
// GameStage inside ISOLATED sandbox stores driven by useReplayPlayer. Never touches the
// live game singletons or the WebSocket.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { boardForContentHash, ENGINE_VERSION, SCHEMA_VERSION } from '@trm/engine';
import type { Action, Board, GameConfig } from '@trm/engine';
import { asPlayerId, type RuleParams, type SeatIndex } from '@trm/shared';
import { api, type ReplayPayload, type ReplayPlayerMeta } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useRoster } from '../store/roster';
import { SandboxProvider } from '../store/sandboxProvider';
import { useGameStore, useGameStoreApi } from '../store/game';
import { useLogStoreApi } from '../store/log';
import { GameStage } from './GameStage';
import { LogPanel } from '../components/LogPanel';
import { useReplayPlayer } from '../features/replay/useReplayPlayer';
import { PerspectiveSwitcher } from '../features/replay/PerspectiveSwitcher';
import '../styles/replay.css';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; msgKey: string }
  | { kind: 'ready'; payload: ReplayPayload; board: Board; config: GameConfig; actions: Action[] };

export default function ReplayScreen() {
  const { t } = useTranslation();
  const gameId = useUi((s) => s.replayGameId);
  const enterHistory = useUi((s) => s.enterHistory);
  const user = useSession((s) => s.user);
  const setMembers = useRoster((s) => s.setMembers);
  const clearRoster = useRoster((s) => s.clear);
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setLoad({ kind: 'loading' });
    api
      .replay(gameId)
      .then((payload) => {
        if (cancelled) return;
        // The client's OWN engine must match the stored game — the server's `replayable`
        // flag is advisory; this is the authoritative check.
        if (payload.engineVersion !== ENGINE_VERSION || payload.schemaVersion !== SCHEMA_VERSION) {
          setLoad({ kind: 'error', msgKey: 'history.notReplayable' });
          return;
        }
        let board: Board;
        try {
          board = boardForContentHash(payload.config.contentHash);
        } catch {
          setLoad({ kind: 'error', msgKey: 'history.unknownMap' });
          return;
        }
        const config: GameConfig = {
          seed: payload.config.seed,
          players: payload.config.players.map((p) => ({
            id: asPlayerId(p.id),
            seat: p.seat as SeatIndex,
          })),
          contentHash: payload.config.contentHash,
          ...(payload.config.ruleParams
            ? { ruleParams: payload.config.ruleParams as Partial<RuleParams> }
            : {}),
          ...(payload.config.shuffleTurnOrder !== undefined
            ? { shuffleTurnOrder: payload.config.shuffleTurnOrder }
            : {}),
        };
        setLoad({ kind: 'ready', payload, board, config, actions: payload.actions as Action[] });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: 'error', msgKey: 'history.loadFailed' });
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  // Roster names for trackers/scoreboard/log — same channel a live game fills from the lobby.
  useEffect(() => {
    if (load.kind !== 'ready') return;
    setMembers(
      load.payload.players.map((p) => ({
        userId: p.userId,
        displayName: p.displayName ?? '',
        isGuest: false,
        seat: p.seat,
        ready: true,
        ...(p.isBot ? { isBot: true } : {}),
        ...(p.difficulty ? { difficulty: p.difficulty } : {}),
      })),
    );
    return () => clearRoster();
  }, [load, setMembers, clearRoster]);

  if (!gameId) return null;
  if (load.kind === 'loading') return <div className="card">{t('connecting')}</div>;
  if (load.kind === 'error') {
    return (
      <div className="card replay-error">
        <p>{t(load.msgKey)}</p>
        <button onClick={enterHistory}>{t('history.backToHistory')}</button>
      </div>
    );
  }

  const initialViewer =
    user && load.payload.players.some((p) => p.userId === user.id) ? asPlayerId(user.id) : null;

  return (
    <SandboxProvider>
      <ReplayStage
        board={load.board}
        config={load.config}
        actions={load.actions}
        players={load.payload.players}
        finalDigest={load.payload.finalDigest}
        initialViewer={initialViewer}
        onLeave={enterHistory}
      />
    </SandboxProvider>
  );
}

function ReplayStage({
  board,
  config,
  actions,
  players,
  finalDigest,
  initialViewer,
  onLeave,
}: {
  board: Board;
  config: GameConfig;
  actions: Action[];
  players: ReplayPlayerMeta[];
  finalDigest: string | undefined;
  initialViewer: ReturnType<typeof asPlayerId> | null;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const gameStore = useGameStoreApi();
  const logStore = useLogStoreApi();
  const stores = useMemo(() => ({ game: gameStore, log: logStore }), [gameStore, logStore]);
  const player = useReplayPlayer(board, config, actions, initialViewer, stores, finalDigest);
  const snapshot = useGameStore((s) => s.snapshot);

  if (player.error) {
    return (
      <div className="card replay-error">
        <p>{t('history.notReplayable')}</p>
        <button onClick={onLeave}>{t('history.backToHistory')}</button>
      </div>
    );
  }
  if (!snapshot) return <div className="card">{t('connecting')}</div>;

  return (
    <div className="replay">
      <div className="replay-stage">
        <GameStage snapshot={snapshot} commands={null} sandbox onLeave={onLeave} />
      </div>
      <aside className="replay-rail">
        <PerspectiveSwitcher players={players} viewer={player.viewer} onChange={player.setViewer} />
        <LogPanel />
      </aside>
      <div className="replay-controls">
        <button
          className="icon-btn"
          onClick={player.prev}
          disabled={player.step <= 0}
          aria-label={t('tutorial.prevStep')}
          title={t('tutorial.prevStep')}
        >
          <SkipBack size={16} aria-hidden />
        </button>
        <button
          className="icon-btn"
          onClick={player.playing ? player.pause : player.play}
          disabled={player.atEnd}
          aria-label={player.playing ? t('tutorial.pause') : t('tutorial.play')}
          title={player.playing ? t('tutorial.pause') : t('tutorial.play')}
        >
          {player.playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        </button>
        <button
          className="icon-btn"
          onClick={player.next}
          disabled={player.atEnd}
          aria-label={t('tutorial.nextStep')}
          title={t('tutorial.nextStep')}
        >
          <SkipForward size={16} aria-hidden />
        </button>
        <input
          type="range"
          className="replay-scrubber"
          min={0}
          max={player.total}
          value={player.step}
          onChange={(e) => player.seek(Number(e.target.value))}
          aria-label={t('history.step', { n: player.step, total: player.total })}
        />
        <span className="replay-step">
          {t('history.step', { n: player.step, total: player.total })}
        </span>
      </div>
    </div>
  );
}
```

Create `apps/web/src/styles/replay.css`:

```css
.replay {
  display: grid;
  grid-template:
    'stage rail' minmax(0, 1fr)
    'controls rail' auto / minmax(0, 1fr) 300px;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.replay-stage {
  grid-area: stage;
  position: relative;
  min-height: 0;
}
.replay-rail {
  grid-area: rail;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
}
.replay-controls {
  grid-area: controls;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
}
.replay-scrubber {
  flex: 1;
  min-width: 120px;
}
.replay-step {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  opacity: 0.8;
}
.replay-error {
  max-width: 420px;
  margin: 48px auto;
  display: grid;
  gap: 12px;
  justify-items: start;
}
.perspective-switcher {
  display: grid;
  gap: 8px;
}
.perspective-label {
  font-size: 0.85em;
  opacity: 0.75;
}
.perspective-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.perspective-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
}
.perspective-pill.is-active {
  outline: 2px solid currentColor;
}
.perspective-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
@media (max-width: 900px) {
  .replay {
    grid-template:
      'stage' minmax(0, 1fr)
      'controls' auto
      'rail' minmax(120px, 30vh) / minmax(0, 1fr);
  }
}
```

(Adjust selectors to sit well inside `.app-main--game` — compare with how `.enc-demo-stage` hosts `GameStage` in `styles/tutorial.css` if the stage overflows.)

- [ ] **Step 4: Run the tests**

Run: `yarn workspace @trm/web test --run ReplayScreen` — Expected: PASS (2 tests).
Run: `yarn workspace @trm/web test` — Expected: full web suite PASS.
Run: `yarn typecheck && yarn lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/ReplayScreen.tsx apps/web/src/screens/ReplayScreen.test.tsx apps/web/src/features/replay/PerspectiveSwitcher.tsx apps/web/src/styles/replay.css
git commit -m "feat(web): replay player screen with timeline, log and perspective switcher"
```

---

### Task 10: Docs, full validation, manual verification

**Files:**
- Modify: `apps/server/CLAUDE.md`
- Modify: `apps/web/CLAUDE.md`

- [ ] **Step 1: Update the CLAUDE.md files**

`apps/server/CLAUDE.md` — in the "Persistence & recovery" section, append to the paragraph:

```md
Spectator userIds are `$addToSet` onto the game doc at ws bind and copied (minus seated players)
into `matchHistory` at completion. `GET /history/:gameId[/replay]` is membership-gated (players +
spectators, 404 otherwise); the `/replay` endpoint ships a **COMPLETED** game's full action log to
that authorized viewer — the one sanctioned exception to "hidden info never leaves the server",
hard-gated on `status: 'COMPLETED'` in `HistoryRepo.loadReplay`.
```

`apps/web/CLAUDE.md` — in the `store/ui.ts` bullet, extend the route list with
`` `history`/`replay` ⇄ `/history`, `/replay/:gameId` `` and append a bullet under "Rendering & content":

```md
- `features/replay/` + `screens/ReplayScreen.tsx` — client-side replay of finished games: fetches
  `/history/:id/replay` (config + action log), runs the real engine locally and projects through
  `redactFor(viewer)`/`viewToSnapshot` into isolated sandbox stores (`SandboxProvider`, which also
  isolates the log store), rendered by the standard `GameStage sandbox`. Perspective switching
  re-projects the same step for another seat; seeks rebuild silently (no animations), forward
  steps animate.
```

- [ ] **Step 2: Full validation sweep**

```bash
yarn typecheck        # expected: clean, all workspaces
yarn lint             # expected: clean
yarn test             # expected: all workspaces green
yarn format           # prettier passes over touched files
```

- [ ] **Step 3: Manual end-to-end verification (needs Docker Mongo)**

```bash
docker compose up -d mongo
yarn workspace @trm/server dev     # optionally TRM_BOT_DELAY_MS=0 for fast bot games
yarn workspace @trm/web dev        # http://localhost:5173
```

1. Guest A: create a room, add 2 HARD bots, ready, start; play (or let the bots dominate) to GAME_OVER.
2. Guest B (second browser/incognito): from the home screen's public rooms, watch (觀戰) the same room before it ends.
3. A → header history icon → `/history`: one row, role 玩家, replay enabled. B: same row, role 觀戰.
4. Open the replay: verify play/pause cadence with card/claim animations and sound, prev/next stepping, scrubbing forward **and backward**, the log panel filling and following, perspective pills (A defaults to own hand; switching to a bot seat reveals its hand/tickets; B defaults to 公開視角), the ScoreBoard appearing at the final step (its longest-trail reveal works), and "leave" returning to `/history`.
5. Deep-link `/replay/<gameId>` in a fresh tab → login gate → resumes into the replay after sign-in. A third, uninvolved account gets the not-found/load-failed card.
6. `docker exec -it $(docker ps -qf name=mongo) mongosh trmission --eval "db.games.findOne({}, {spectators: 1}); db.matchHistory.findOne({}, {spectators: 1, engineVersion: 1}); db.matchHistory.getIndexes()"` — confirm spectators arrays and the `{spectators: 1, completedAt: -1}` index. (Adjust db name to `MONGO_DB` if set.)

- [ ] **Step 4: Commit**

```bash
git add apps/server/CLAUDE.md apps/web/CLAUDE.md
git commit -m "docs: record spectator persistence and the replay data flow"
```

---

## Risks / known edges (accepted)

- **Legacy games**: no spectator records (lists just omit them); archives missing `engineVersion` are backfilled from `games` at query time; games from older engine versions show a disabled replay button with the version message.
- **Expired guests**: display names fall back to `P{seat+1}` (denormalizing names into `matchHistory` at completion is a possible follow-up).
- **Perspective switch changes the log**: private lines (blind draws, ticket offers) appear only for the chosen viewer — intended "as they experienced it" semantics.
- **Sound during autoplay**: the contextual sound driver fires on forward steps, is silent on seeks. Gate later if noisy.
- **No pagination** (cap 50, newest first) — the new `{spectators, completedAt}` index supports cursor pagination later.
- If `docs.e2e.spec.ts` asserts on the OpenAPI route inventory, it needs the new `/history/:gameId/replay` route added to its expectations (Task 3/4 will surface this).
