import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { GameConfig, PlayerSeed } from '@trm/engine';
import { asPlayerId, type PlayerId } from '@trm/shared';
import type { ServerEnvelope } from '@trm/proto';
import { ensureIndexes, MongoGameStore } from '../src/persistence/game-store';
import type { GameDoc } from '../src/persistence/types';
import { GameSession } from '../src/game/game-session';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import { actionToCommand, encodeClient, decodeServer, pickAction } from './helpers';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let store: MongoGameStore;

const board = taiwanBoard();
const twoPlayers: PlayerSeed[] = [
  { id: asPlayerId('p1'), seat: 0 },
  { id: asPlayerId('p2'), seat: 1 },
];
const configFor = (seed: string, players = twoPlayers): GameConfig => ({
  seed,
  players,
  contentHash: CONTENT_HASH,
});

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

/** Drive a session forward, persisting each action exactly as the hub does (write-ahead). */
async function driveDirect(
  session: GameSession,
  gameId: string,
  maxActions: number,
): Promise<void> {
  for (let i = 0; i < maxActions; i++) {
    const state = session.raw();
    if (state.turn.phase === 'GAME_OVER') break;
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? session.turnOrder.find((p) => session.hasPendingOffer(p))
        : session.currentPlayer;
    if (!actor) break;
    const action = pickAction(session.board, state, actor);
    const prep = session.prepare(action);
    if (!prep.ok) throw new Error(`unexpected rejection: ${prep.violation.code}`);
    await store.appendAction(
      gameId,
      prep.prepared.stateVersion,
      action,
      prep.prepared.digest,
      prep.prepared.state,
    );
    session.commit(prep.prepared, action);
    if (prep.prepared.state.turn.phase === 'GAME_OVER')
      await store.markCompleted(gameId, prep.prepared.digest);
  }
}

describe('event-sourced persistence + recovery (ADR A5/A7)', () => {
  it('recovers a partially-played game to an identical digest, via a checkpoint snapshot', async () => {
    const config = configFor('persist-partial');
    const live = new GameSession('g1', board, config);
    await store.createGame('g1', config, live.raw(), live.digest());
    await driveDirect(live, 'g1', 40);

    const data = await store.loadForRecovery('g1');
    expect(data).not.toBeNull();
    const recovered = GameSession.restore(
      'g1',
      board,
      data!.config,
      data!.snapshot?.state ?? null,
      data!.tail,
    );

    expect(recovered.digest()).toBe(live.digest());
    expect(recovered.stateVersion).toBe(live.stateVersion);

    // A checkpoint beyond genesis was written, and recovery replayed only the tail after it.
    const snapCount = await db.collection('gameSnapshots').countDocuments({ gameId: 'g1' });
    expect(snapCount).toBeGreaterThan(1);
    expect(data!.snapshot!.seq).toBeGreaterThan(0);
    expect(data!.tail.length).toBeLessThan(live.stateVersion);
  });

  it('recovers a full completed game and marks it COMPLETED', async () => {
    const config = configFor('persist-full', [
      { id: asPlayerId('p1'), seat: 0 },
      { id: asPlayerId('p2'), seat: 1 },
      { id: asPlayerId('p3'), seat: 2 },
    ]);
    const live = new GameSession('g2', board, config);
    await store.createGame('g2', config, live.raw(), live.digest());
    await driveDirect(live, 'g2', 5000);

    expect(live.phase).toBe('GAME_OVER');
    const data = await store.loadForRecovery('g2');
    const recovered = GameSession.restore(
      'g2',
      board,
      data!.config,
      data!.snapshot?.state ?? null,
      data!.tail,
    );
    expect(recovered.digest()).toBe(live.digest());

    const game = await db.collection<GameDoc>('games').findOne({ _id: 'g2' });
    expect(game?.status).toBe('COMPLETED');
  });

  it('detects a tampered event during recovery (digest divergence, risk #2)', async () => {
    const config = configFor('persist-tamper');
    const live = new GameSession('g3', board, config);
    await store.createGame('g3', config, live.raw(), live.digest());
    await driveDirect(live, 'g3', 5);

    const last = await db
      .collection('gameEvents')
      .find({ gameId: 'g3' })
      .sort({ seq: -1 })
      .limit(1)
      .next();
    await db
      .collection('gameEvents')
      .updateOne({ gameId: 'g3', seq: last!.seq }, { $set: { stateDigest: 'TAMPERED' } });

    const data = await store.loadForRecovery('g3');
    expect(() =>
      GameSession.restore('g3', board, data!.config, data!.snapshot?.state ?? null, data!.tail),
    ).toThrow(/digest mismatch/);
  });

  it('rejects a duplicate (gameId, seq) append (double-apply guard, A14)', async () => {
    const config = configFor('persist-dupe');
    const live = new GameSession('g4', board, config);
    await store.createGame('g4', config, live.raw(), live.digest());

    const state = live.raw();
    const actor = live.turnOrder.find((p) => live.hasPendingOffer(p))!;
    const prep = live.prepare(pickAction(board, state, actor));
    if (!prep.ok) throw new Error('setup');
    const action = pickAction(board, state, actor);

    await store.appendAction(
      'g4',
      prep.prepared.stateVersion,
      action,
      prep.prepared.digest,
      prep.prepared.state,
    );
    await expect(
      store.appendAction(
        'g4',
        prep.prepared.stateVersion,
        action,
        prep.prepared.digest,
        prep.prepared.state,
      ),
    ).rejects.toThrow();
  });

  it('recovers on reconnect: a fresh hub rehydrates the game from the store on hello', async () => {
    const config = configFor('persist-wire');
    const hub1 = new GameHub(new GameRegistry(), { store });
    const match1 = await hub1.createMatch('wire1', board, config);

    const seq = new Map<string, number>();
    for (const p of config.players) {
      hub1.openConnection(p.id as string, () => {});
      await hub1.receive(
        p.id as string,
        encodeClient(1, {
          case: 'hello',
          value: {
            ticket: makeDevTicket({ gameId: 'wire1', playerId: p.id as string, seat: p.seat }),
            protocolVersion: 1,
          },
        }),
      );
      seq.set(p.id as string, 1);
    }
    for (let i = 0; i < 12 && match1.session.phase !== 'GAME_OVER'; i++) {
      const state = match1.session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? config.players.map((p) => p.id).find((p) => match1.session.hasPendingOffer(p))!
          : (match1.session.currentPlayer as PlayerId);
      const n = (seq.get(actor as string) ?? 0) + 1;
      seq.set(actor as string, n);
      await hub1.receive(
        actor as string,
        encodeClient(n, actionToCommand(pickAction(board, state, actor))),
      );
    }
    const v1 = match1.session.stateVersion;
    const d1 = match1.session.digest();
    expect(v1).toBeGreaterThan(0);

    // Fresh hub, same store: a client's hello triggers recovery, then a projected snapshot.
    const hub2 = new GameHub(new GameRegistry(), { store });
    const frames: ServerEnvelope[] = [];
    hub2.openConnection('c', (b) => frames.push(decodeServer(b)));
    await hub2.receive(
      'c',
      encodeClient(1, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'wire1', playerId: 'p1', seat: 0 }),
          protocolVersion: 1,
        },
      }),
    );

    const snap = frames.find((f) => f.event.case === 'snapshot');
    if (snap?.event.case !== 'snapshot') throw new Error('no snapshot after recovery');
    expect(snap.event.value.snapshot?.stateVersion).toBe(v1);

    // And an independent recovery reproduces the exact same state.
    const data = await store.loadForRecovery('wire1');
    const rec = GameSession.restore(
      'wire1',
      board,
      data!.config,
      data!.snapshot?.state ?? null,
      data!.tail,
    );
    expect(rec.digest()).toBe(d1);
  });
});
