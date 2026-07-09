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
import type { Board, GameConfig, GameState, PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { MongoGameStore, ensureIndexes } from '../src/persistence/game-store';
import type { GameDoc, MatchHistoryDoc } from '../src/persistence/types';
import { pickAction, encodeClient } from './helpers';
import { GameHub } from '../src/ws/hub';
import { GameRegistry } from '../src/game/game-registry';
import { makeDevTicket } from '../src/ws/ticket';

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
