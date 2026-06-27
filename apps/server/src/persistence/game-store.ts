// MongoDB event-sourced game store (native driver, ADR A2). Correctness rests on
// the unique (gameId, seq) index — the durable double-apply guard (A14) — plus the
// per-action stateDigest, which lets recovery detect divergence. Writes use majority
// write-concern; multi-document transactions are not needed because every write for
// a game is serialized by the per-game command queue (single writer).
import type { Db, Collection } from 'mongodb';
import { ENGINE_VERSION } from '@trm/engine';
import type { GameConfig, GameState, Action } from '@trm/engine';
import {
  configToStored,
  storedToConfig,
  type GameStorePort,
  type RecoveryData,
  type GameDoc,
  type GameEventDoc,
  type GameSnapshotDoc,
  type MatchHistoryDoc,
} from './types';

/** Write a full checkpoint snapshot every N actions (also at game over). */
const SNAPSHOT_EVERY = 16;

export async function ensureIndexes(db: Db): Promise<void> {
  await db
    .collection<GameEventDoc>('gameEvents')
    .createIndex({ gameId: 1, seq: 1 }, { unique: true });
  await db
    .collection<GameSnapshotDoc>('gameSnapshots')
    .createIndex({ gameId: 1, seq: 1 }, { unique: true });
  await db.collection<GameDoc>('games').createIndex({ status: 1, updatedAt: -1 });
  await db
    .collection<MatchHistoryDoc>('matchHistory')
    .createIndex({ 'players.userId': 1, completedAt: -1 });
}

export class MongoGameStore implements GameStorePort {
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly snapshots: Collection<GameSnapshotDoc>;
  private readonly history: Collection<MatchHistoryDoc>;

  constructor(db: Db) {
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.snapshots = db.collection<GameSnapshotDoc>('gameSnapshots');
    this.history = db.collection<MatchHistoryDoc>('matchHistory');
  }

  async createGame(
    gameId: string,
    config: GameConfig,
    genesisState: GameState,
    genesisDigest: string,
  ): Promise<void> {
    const now = new Date();
    await this.games.insertOne({
      _id: gameId,
      seed: config.seed,
      config: configToStored(config),
      engineVersion: ENGINE_VERSION,
      contentHash: config.contentHash,
      schemaVersion: genesisState.schemaVersion,
      status: 'LIVE',
      currentSeq: 0,
      createdAt: now,
      updatedAt: now,
    });
    await this.snapshots.insertOne(
      { gameId, seq: 0, state: genesisState, stateDigest: genesisDigest, ts: now },
      { writeConcern: { w: 'majority' } },
    );
  }

  async appendAction(
    gameId: string,
    seq: number,
    action: Action,
    stateDigest: string,
    state: GameState,
  ): Promise<void> {
    const now = new Date();
    // Unique (gameId, seq): a duplicate/replayed action can never be appended twice.
    await this.events.insertOne(
      { gameId, seq, action, stateDigest, ts: now },
      { writeConcern: { w: 'majority' } },
    );

    const atGameOver = state.turn.phase === 'GAME_OVER';
    if (seq % SNAPSHOT_EVERY === 0 || atGameOver) {
      await this.snapshots.insertOne(
        { gameId, seq, state, stateDigest, ts: now },
        { writeConcern: { w: 'majority' } },
      );
    }
    await this.games.updateOne({ _id: gameId }, { $set: { currentSeq: seq, updatedAt: now } });
  }

  async recordCompletion(gameId: string, finalState: GameState): Promise<void> {
    const now = new Date();
    await this.games.updateOne({ _id: gameId }, { $set: { status: 'COMPLETED', updatedAt: now } });

    const game = await this.games.findOne({ _id: gameId });
    const scores = finalState.finalScores;
    if (!game || !scores) return;

    // Idempotent archive (game over only fires once, but recovery could replay it).
    await this.history.updateOne(
      { _id: gameId },
      {
        $setOnInsert: {
          players: game.config.players.map((p) => ({ userId: p.id, seat: p.seat })),
          turnOrder: finalState.turnOrder.map((id) => id as string),
          seed: game.seed,
          contentHash: game.contentHash,
          finalScores: scores,
          winners: (scores.ranking[0] ?? []).map((id) => id as string),
          completedAt: now,
        },
      },
      { upsert: true, writeConcern: { w: 'majority' } },
    );
  }

  async loadForRecovery(gameId: string): Promise<RecoveryData | null> {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) return null;

    const snap = await this.snapshots.find({ gameId }).sort({ seq: -1 }).limit(1).next();
    const sinceSeq = snap?.seq ?? -1;
    const tail = await this.events
      .find({ gameId, seq: { $gt: sinceSeq } })
      .sort({ seq: 1 })
      .toArray();

    return {
      config: storedToConfig(game.config),
      snapshot: snap ? { seq: snap.seq, state: snap.state } : null,
      tail: tail.map((e) => ({ seq: e.seq, action: e.action, stateDigest: e.stateDigest })),
    };
  }
}
