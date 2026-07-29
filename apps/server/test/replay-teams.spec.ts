// Issue #75: a team game's `teamCount` must round-trip through persistence. It never did, so
// every rebuild from the stored config drew a FREE-FOR-ALL genesis (a full turn-order shuffle
// instead of the team rotation = a different deck), and the recorded log was rejected at the
// first action — which the replay screens report as "played on an older version".
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { taiwanBoard, CONTENT_HASH, replay, stateDigest } from '@trm/engine';
import type { GameConfig, PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { ensureIndexes, MongoGameStore } from '../src/persistence/game-store';
import { storedToConfig, type GameDoc } from '../src/persistence/types';
import { GameSession } from '../src/game/game-session';
import { HistoryRepo } from '../src/history/history.repo';
import { pickAction } from './helpers';

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let store: MongoGameStore;
let repo: HistoryRepo;

const board = taiwanBoard();
const fourPlayers: PlayerSeed[] = [0, 1, 2, 3].map((seat) => ({
  id: asPlayerId(`p${seat}`),
  seat: seat as PlayerSeed['seat'],
}));
// shuffleTurnOrder is what the lobby always sets, and it is where the two genesis paths part:
// a team game rotates (one draw), a free-for-all shuffles (n draws).
const teamConfig = (seed: string): GameConfig => ({
  seed,
  players: fourPlayers,
  contentHash: CONTENT_HASH,
  shuffleTurnOrder: true,
  teamCount: 2,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db('trm-test');
  await ensureIndexes(db);
  store = new MongoGameStore(db);
  repo = new HistoryRepo(db);
}, 60_000);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

/** Persist `count` actions the way the hub does (write-ahead), then mark the game COMPLETED. */
async function playAndFinish(gameId: string, config: GameConfig, count: number) {
  const live = new GameSession(gameId, board, config);
  await store.createGame(gameId, config, live.raw(), live.digest());
  for (let i = 0; i < count; i++) {
    const state = live.raw();
    if (state.turn.phase === 'GAME_OVER') break;
    const actor =
      state.turn.phase === 'SETUP_TICKETS'
        ? live.turnOrder.find((p) => live.hasPendingOffer(p))
        : live.currentPlayer;
    if (!actor) break;
    const action = pickAction(board, state, actor);
    const prep = live.prepare(action);
    if (!prep.ok) throw new Error(`unexpected rejection: ${prep.violation.code}`);
    await store.appendAction(
      gameId,
      prep.prepared.stateVersion,
      action,
      prep.prepared.digest,
      prep.prepared.state,
    );
    live.commit(prep.prepared, action);
  }
  // The replay gate is `status: 'COMPLETED'`; playing a 4p table out is not what this tests.
  await db
    .collection<GameDoc>('games')
    .updateOne({ _id: gameId }, { $set: { status: 'COMPLETED' } });
  return live;
}

describe('team games round-trip through persistence (issue #75)', () => {
  it('serves a replay config that reproduces the recorded log', async () => {
    const live = await playAndFinish('t-new', teamConfig('team-replay'), 30);

    const doc = await db.collection<GameDoc>('games').findOne({ _id: 't-new' });
    expect(doc?.config.teamCount).toBe(2);

    const data = await repo.loadReplay('t-new');
    expect(data?.config.teamCount).toBe(2);
    // What the client does with that payload: rebuild the engine and run the log.
    const rep = replay(board, storedToConfig(data!.config), data!.actions);
    expect(stateDigest(rep.state)).toBe(live.digest());
    expect(rep.state.teams).toHaveLength(2);

    // And this is what the missing key did: the same log against a free-for-all rebuild is
    // rejected outright, which is the failure the replay screens surfaced.
    const { teamCount: _dropped, ...asFreeForAll } = storedToConfig(data!.config);
    expect(() => replay(board, asFreeForAll, data!.actions)).toThrow(/rejected/);
  });

  it('repairs a pre-fix game whose stored config predates teamCount', async () => {
    const live = await playAndFinish('t-legacy', teamConfig('team-legacy'), 30);
    // Exactly the docs already in the database: written by a build that never stored the key.
    await db
      .collection<GameDoc>('games')
      .updateOne({ _id: 't-legacy' }, { $unset: { 'config.teamCount': '' } });

    const data = await repo.loadReplay('t-legacy');
    expect(data?.config.teamCount).toBe(2);
    const rep = replay(board, storedToConfig(data!.config), data!.actions);
    expect(stateDigest(rep.state)).toBe(live.digest());
  });

  it('leaves a free-for-all config alone', async () => {
    const config: GameConfig = {
      seed: 'ffa-replay',
      players: fourPlayers,
      contentHash: CONTENT_HASH,
      shuffleTurnOrder: true,
    };
    const live = await playAndFinish('t-ffa', config, 30);

    const data = await repo.loadReplay('t-ffa');
    expect(data?.config.teamCount).toBeUndefined();
    const rep = replay(board, storedToConfig(data!.config), data!.actions);
    expect(stateDigest(rep.state)).toBe(live.digest());
    expect(rep.state.teams).toBeUndefined();
  });

  it('recovers a team game with an intact action-log backfill', async () => {
    // GameSession.restore overwrites the genesis it builds from the config, so a dropped
    // teamCount stayed invisible here — until history() re-inits from that same config to
    // backfill a reconnecting client's log and replays into an immediate rejection.
    const live = await playAndFinish('t-recover', teamConfig('team-recover'), 30);
    await db
      .collection<GameDoc>('games')
      .updateOne({ _id: 't-recover' }, { $unset: { 'config.teamCount': '' } });

    const data = await store.loadForRecovery('t-recover');
    expect(data?.config.teamCount).toBe(2);
    const recovered = GameSession.restore(
      't-recover',
      board,
      data!.config,
      data!.snapshot?.state ?? null,
      data!.preSnapshotActions,
      data!.tail,
    );
    expect(recovered.digest()).toBe(live.digest());
    expect(recovered.history()).toEqual(live.history());
    expect(recovered.history().events.length).toBeGreaterThan(0);
  });
});
