// Regression: a game persisted by an OLDER engine major must not be able to kill the server.
//
// Production issues #22 and #26 were the same bug seen from two angles. `EventsState` grew three
// fields in engine v8 (`luckyContracts`, `repairedRouteIds`, `resources`), but recovery never
// checked which engine wrote a snapshot — so a v5–v7 game rehydrated into v9 handed the reducer an
// `events` blob missing keys it dereferences unconditionally. The resulting TypeError escaped
// through the fire-and-forget `void hub.receive(...)` at the socket layer as an unhandled
// rejection, taking the whole process (and every other live game) down:
//   #26  reduce → validateClaimEventResources → eventResources → `events.resources` is undefined
//   #22  redactFor → projectEvents → `...events.luckyContracts` is not iterable
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { taiwanBoard, CONTENT_HASH, ENGINE_VERSION } from '@trm/engine';
import type { GameConfig, PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import type { ServerEnvelope } from '@trm/proto';
import { RejectionCode } from '@trm/proto';
import { ensureIndexes, MongoGameStore } from '../src/persistence/game-store';
import type { GameDoc } from '../src/persistence/types';
import { GameSession } from '../src/game/game-session';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub, GameUnrecoverableError } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient, decodeServer } from './helpers';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let store: MongoGameStore;

const board = taiwanBoard();
const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];
/** Events on — otherwise there is no `events` blob to go stale. */
const config: GameConfig = {
  seed: 'legacy-events',
  players,
  contentHash: CONTENT_HASH,
  ruleParams: { eventsMode: 'moderate' },
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('trm-test');
  await ensureIndexes(db);
  store = new MongoGameStore(db);
}, 60_000);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all([
    db.collection('games').deleteMany({}),
    db.collection('gameEvents').deleteMany({}),
    db.collection('gameSnapshots').deleteMany({}),
  ]);
});

/** Persist a game, then rewrite it on disk the way an older engine major would have left it. */
async function seedLegacyGame(gameId: string, engineVersion: number): Promise<void> {
  const live = new GameSession(gameId, board, config);
  await store.createGame(gameId, config, live.raw(), live.digest());
  expect(live.raw().events).toBeDefined();

  await db.collection<GameDoc>('games').updateOne({ _id: gameId }, { $set: { engineVersion } });
  // The pre-v8 EventsState shape: the expansion fields simply did not exist.
  await db
    .collection('gameSnapshots')
    .updateMany(
      { gameId },
      {
        $unset: {
          'state.events.luckyContracts': '',
          'state.events.repairedRouteIds': '',
          'state.events.resources': '',
        },
      },
    );
}

const helloFrame = (gameId: string, playerId: string, seat: number): Uint8Array =>
  encodeClient(1, {
    case: 'hello',
    value: { ticket: makeDevTicket({ gameId, playerId, seat }), protocolVersion: 1 },
  });

describe('recovery refuses games written by an incompatible engine major (#22, #26)', () => {
  it('rejects a pre-v8 game instead of splicing its stale state into the current reducer', async () => {
    await seedLegacyGame('legacy1', 8);

    const hub = new GameHub(new GameRegistry(), { store });
    await expect(hub.recoverMatch('legacy1')).rejects.toBeInstanceOf(GameUnrecoverableError);
  });

  it('tells the client the game is unavailable — and the hub survives to serve everyone else', async () => {
    await seedLegacyGame('legacy2', 8);

    let recoveryFailures = 0;
    const hub = new GameHub(new GameRegistry(), {
      store,
      metrics: {
        commandReceived() {},
        commandRejected() {},
        commandApplied() {},
        connectionOpened() {},
        connectionClosed() {},
        leakBlocked() {},
        botDriverStalled() {},
        recoveryFailed() {
          recoveryFailures++;
        },
      },
    });

    const frames: ServerEnvelope[] = [];
    hub.openConnection('c', (b) => frames.push(decodeServer(b)));
    // The crash was here: this used to reject, and nothing caught it.
    await expect(hub.receive('c', helloFrame('legacy2', 'p1', 0))).resolves.toBeUndefined();

    const rejection = frames.find((f) => f.event.case === 'rejection');
    if (rejection?.event.case !== 'rejection') throw new Error('expected a rejection frame');
    expect(rejection.event.value.code).toBe(RejectionCode.NOT_IN_GAME);
    expect(rejection.event.value.messageKey).toBe('errors:gameUnavailable');
    expect(recoveryFailures).toBe(1);
    // No snapshot for a game we refused to load.
    expect(frames.some((f) => f.event.case === 'snapshot')).toBe(false);

    // The hub is still alive: a healthy game on the same hub still binds and gets its snapshot.
    const healthy = await hub.createMatch('healthy', board, config);
    expect(healthy).toBeDefined();
    hub.openConnection('c2', (b) => frames.push(decodeServer(b)));
    await hub.receive('c2', helloFrame('healthy', 'p1', 0));
    expect(frames.some((f) => f.event.case === 'snapshot')).toBe(true);
  });

  it('never lets a frame reject, even when a game with a current stamp has a corrupt state', async () => {
    // Belt and braces: the version gate is the fix, but a state that goes bad for ANY other reason
    // must still cost one client its command rather than the whole process.
    await seedLegacyGame('corrupt', ENGINE_VERSION);

    const hub = new GameHub(new GameRegistry(), { store });
    const frames: ServerEnvelope[] = [];
    hub.openConnection('c', (b) => frames.push(decodeServer(b)));
    await expect(hub.receive('c', helloFrame('corrupt', 'p1', 0))).resolves.toBeUndefined();

    expect(frames.some((f) => f.event.case === 'rejection')).toBe(true);
  });
});
