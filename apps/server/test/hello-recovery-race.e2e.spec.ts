// F12 round 2: a hello is a once-per-connection bind, and cold-game recovery is single-flight
// per gameId. Round 1 added `if (conn.binding) return;` at the top of onHello, which only helps
// once a connection is ALREADY bound — it does nothing during the `await recoverMatch(...)`
// window a cold game's first post-restart hello suspends on, since `conn.binding` isn't set until
// AFTER that await resolves. These specs pin the round-2 fix: `conn.helloInFlight` is set
// SYNCHRONOUSLY before that await (closing the same-connection pipelining gap), and
// `GameHub.recoverMatch` is single-flight per gameId (closing the cross-connection race and the
// `GameRegistry.adopt()` clobber that came with it).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { GameConfig, PlayerSeed, GameState, Action } from '@trm/engine';
import type { BotProfile } from '@trm/bots';
import { asPlayerId } from '@trm/shared';
import type { ServerEnvelope } from '@trm/proto';
import { ensureIndexes, MongoGameStore } from '../src/persistence/game-store';
import type {
  ChatContent,
  ChatEntry,
  GameDoc,
  GameStorePort,
  MatchOptions,
  RecoveryData,
} from '../src/persistence/types';
import { GameSession } from '../src/game/game-session';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { encodeClient, decodeServer } from './helpers';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let inner: MongoGameStore;

const board = taiwanBoard();
const players: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];
const config: GameConfig = { seed: 'hello-race', players, contentHash: CONTENT_HASH };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('trm-test');
  await ensureIndexes(db);
  inner = new MongoGameStore(db);
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

/**
 * Wraps a real store and counts (+ mildly delays) `loadForRecovery` calls, so a test can prove
 * the expensive genesis replay + `GameRegistry.adopt()` only ever run ONCE per gameId no matter
 * how many hellos race to recover it. Everything else forwards straight to the real store.
 */
class CountingStore implements GameStorePort {
  loadForRecoveryCalls = 0;
  constructor(
    private readonly wrapped: GameStorePort,
    private readonly delayMs = 15,
  ) {}
  createGame(
    gameId: string,
    gameConfig: GameConfig,
    genesisState: GameState,
    genesisDigest: string,
    bots?: readonly BotProfile[],
    options?: MatchOptions,
  ): Promise<void> {
    return this.wrapped.createGame(gameId, gameConfig, genesisState, genesisDigest, bots, options);
  }
  appendAction(
    gameId: string,
    seq: number,
    action: Action,
    stateDigest: string,
    state: GameState,
  ): Promise<void> {
    return this.wrapped.appendAction(gameId, seq, action, stateDigest, state);
  }
  recordCompletion(gameId: string, finalState: GameState): Promise<void> {
    return this.wrapped.recordCompletion(gameId, finalState);
  }
  getStatus(gameId: string): Promise<GameDoc['status'] | undefined> {
    return this.wrapped.getStatus(gameId);
  }
  addSpectator(gameId: string, userId: string): Promise<void> {
    return this.wrapped.addSpectator(gameId, userId);
  }
  async loadForRecovery(gameId: string): Promise<RecoveryData | null> {
    this.loadForRecoveryCalls++;
    await new Promise((r) => setTimeout(r, this.delayMs));
    return this.wrapped.loadForRecovery(gameId);
  }
  appendChat(gameId: string, seq: number, playerId: string, content: ChatContent): Promise<void> {
    return this.wrapped.appendChat(gameId, seq, playerId, content);
  }
  loadChat(gameId: string): Promise<ChatEntry[]> {
    return this.wrapped.loadChat(gameId);
  }
}

const helloFrame = (gameId: string, playerId: string, seat: number, clientSeq: number): Uint8Array =>
  encodeClient(clientSeq, {
    case: 'hello',
    value: { ticket: makeDevTicket({ gameId, playerId, seat }), protocolVersion: 1 },
  });

describe('hello / recoverMatch single-flight (F12 round 2)', () => {
  it('pipelined hellos on ONE connection for a cold game: recovery runs once, only the first binds', async () => {
    const gameId = 'race-one-conn';
    const genesis = new GameSession(gameId, board, config);
    await inner.createGame(gameId, config, genesis.raw(), genesis.digest());

    const store = new CountingStore(inner);
    const hub = new GameHub(new GameRegistry(), { store });

    const frames: ServerEnvelope[] = [];
    hub.openConnection('c1', (b) => frames.push(decodeServer(b)));

    // Fire 5 hello frames on the SAME connection without awaiting each individually — exactly
    // what a real ws 'message' handler does (`void hub.receive(...)`, never awaited per frame).
    const attempts = Array.from({ length: 5 }, (_, i) =>
      hub.receive('c1', helloFrame(gameId, 'p1', 0, i + 1)),
    );
    await Promise.all(attempts);

    // The expensive genesis replay (and registry.adopt) ran exactly once...
    expect(store.loadForRecoveryCalls).toBe(1);
    // ...and only the FIRST hello actually bound and got served; the rest were silently ignored
    // while the first was still suspended awaiting recovery (conn.helloInFlight).
    expect(frames.filter((f) => f.event.case === 'welcome')).toHaveLength(1);
    expect(frames.filter((f) => f.event.case === 'history')).toHaveLength(1);
    expect(frames.filter((f) => f.event.case === 'snapshot')).toHaveLength(1);
    expect(frames.some((f) => f.event.case === 'rejection')).toBe(false);
  });

  it('two DIFFERENT connections racing to recover the SAME cold game converge on one adopted match', async () => {
    const gameId = 'race-two-conns';
    const genesis = new GameSession(gameId, board, config);
    await inner.createGame(gameId, config, genesis.raw(), genesis.digest());

    const store = new CountingStore(inner);
    const registry = new GameRegistry();
    const hub = new GameHub(registry, { store });

    const framesA: ServerEnvelope[] = [];
    const framesB: ServerEnvelope[] = [];
    hub.openConnection('cA', (b) => framesA.push(decodeServer(b)));
    hub.openConnection('cB', (b) => framesB.push(decodeServer(b)));

    // Two different seated players, two different connections — e.g. both reconnecting right
    // after a redeploy — racing to be the one that recovers this game. Fired without awaiting
    // either, like two independent sockets' 'message' handlers.
    const pA = hub.receive('cA', helloFrame(gameId, 'p1', 0, 1));
    const pB = hub.receive('cB', helloFrame(gameId, 'p2', 1, 1));
    await Promise.all([pA, pB]);

    // Only one recovery ever actually ran and adopted...
    expect(store.loadForRecoveryCalls).toBe(1);
    // ...and BOTH callers still got served in full (neither was starved or silently dropped).
    expect(framesA.filter((f) => f.event.case === 'welcome')).toHaveLength(1);
    expect(framesB.filter((f) => f.event.case === 'welcome')).toHaveLength(1);
    expect(framesA.filter((f) => f.event.case === 'history')).toHaveLength(1);
    expect(framesB.filter((f) => f.event.case === 'history')).toHaveLength(1);
    expect(framesA.some((f) => f.event.case === 'rejection')).toBe(false);
    expect(framesB.some((f) => f.event.case === 'rejection')).toBe(false);

    // Both bound to the one game object actually resident in the registry — not two independent
    // sessions each blindly clobbering the registry slot (the adopt() smell F12 also flagged).
    expect(registry.get(gameId)).toBeDefined();
  });

  it('a failed recovery propagates to every joined caller, each on its own error branch — replay still runs once', async () => {
    const gameId = 'race-unrecoverable';
    const live = new GameSession(gameId, board, config);
    await inner.createGame(gameId, config, live.raw(), live.digest());
    // Stamp an engine major the current engine refuses to resume (see recovery-engine-compat spec).
    await db.collection<GameDoc>('games').updateOne({ _id: gameId }, { $set: { engineVersion: 8 } });

    const store = new CountingStore(inner);
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

    const framesA: ServerEnvelope[] = [];
    const framesB: ServerEnvelope[] = [];
    hub.openConnection('cA', (b) => framesA.push(decodeServer(b)));
    hub.openConnection('cB', (b) => framesB.push(decodeServer(b)));

    const pA = hub.receive('cA', helloFrame(gameId, 'p1', 0, 1));
    const pB = hub.receive('cB', helloFrame(gameId, 'p2', 1, 1));
    await Promise.all([pA, pB]);

    // The underlying replay/version-check ran exactly once...
    expect(store.loadForRecoveryCalls).toBe(1);
    // ...but EVERY joined caller still observed the failure and took its own error branch.
    expect(recoveryFailures).toBe(2);
    for (const frames of [framesA, framesB]) {
      const rejection = frames.find((f) => f.event.case === 'rejection');
      if (rejection?.event.case !== 'rejection') throw new Error('expected a rejection frame');
      expect(rejection.event.value.messageKey).toBe('errors:gameUnavailable');
    }
  });

  it('a later, genuinely new recovery for the same gameId does not join a stale settled attempt', async () => {
    const gameId = 'race-reuse';
    const genesis = new GameSession(gameId, board, config);
    await inner.createGame(gameId, config, genesis.raw(), genesis.digest());

    const store = new CountingStore(inner, 0);
    const registry = new GameRegistry();
    const hub = new GameHub(registry, { store });

    hub.openConnection('c1', () => {});
    await hub.receive('c1', helloFrame(gameId, 'p1', 0, 1));
    expect(store.loadForRecoveryCalls).toBe(1);

    // Evict it from memory the same way a server restart would drop it (belt-and-braces: the
    // in-flight map must not still be "holding" this gameId from the first recovery).
    registry.remove(gameId);

    hub.openConnection('c2', () => {});
    await hub.receive('c2', helloFrame(gameId, 'p2', 1, 1));
    // A second, independent recovery actually ran — the first attempt's cleanup freed the
    // gameId, it wasn't stuck joining a stale resolved promise forever.
    expect(store.loadForRecoveryCalls).toBe(2);
    expect(registry.get(gameId)).toBeDefined();
  });

  it('repeat hello on an already-bound connection is a no-op (hot path, game already resident)', async () => {
    const gameId = 'hot-repeat';
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch(gameId, board, config);

    const frames: ServerEnvelope[] = [];
    hub.openConnection('c1', (b) => frames.push(decodeServer(b)));

    await hub.receive('c1', helloFrame(gameId, 'p1', 0, 1));
    expect(frames.filter((f) => f.event.case === 'welcome')).toHaveLength(1);

    // A second hello on the SAME already-bound connection must not re-send welcome/snapshot/history.
    await hub.receive('c1', helloFrame(gameId, 'p1', 0, 2));
    expect(frames.filter((f) => f.event.case === 'welcome')).toHaveLength(1);
    expect(frames.filter((f) => f.event.case === 'history')).toHaveLength(1);
    expect(frames.some((f) => f.event.case === 'rejection')).toBe(false);
  });

  it('a genuine reconnect on a NEW connection still gets a full welcome + history replay', async () => {
    const gameId = 'hot-reconnect';
    const hub = new GameHub(new GameRegistry());
    await hub.createMatch(gameId, board, config);

    const framesOld: ServerEnvelope[] = [];
    hub.openConnection('c-old', (b) => framesOld.push(decodeServer(b)));
    await hub.receive('c-old', helloFrame(gameId, 'p1', 0, 1));
    expect(framesOld.filter((f) => f.event.case === 'welcome')).toHaveLength(1);

    // The player reconnects on a fresh connId (e.g. after a page reload) — a brand-new
    // Connection object, so it is never blocked by the old one's `helloInFlight`/`binding`.
    const framesNew: ServerEnvelope[] = [];
    hub.openConnection('c-new', (b) => framesNew.push(decodeServer(b)));
    await hub.receive('c-new', helloFrame(gameId, 'p1', 0, 1));
    expect(framesNew.filter((f) => f.event.case === 'welcome')).toHaveLength(1);
    expect(framesNew.filter((f) => f.event.case === 'history')).toHaveLength(1);
    expect(framesNew.filter((f) => f.event.case === 'snapshot')).toHaveLength(1);
  });
});
