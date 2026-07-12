// MongoDB event-sourced game store (native driver, ADR A2). Correctness rests on
// the unique (gameId, seq) index — the durable double-apply guard (A14) — plus the
// per-action stateDigest, which lets recovery detect divergence. Writes use majority
// write-concern; multi-document transactions are not needed because every write for
// a game is serialized by the per-game command queue (single writer).
import type { Db, Collection } from 'mongodb';
import { ENGINE_VERSION } from '@trm/engine';
import type { GameConfig, GameState, Action } from '@trm/engine';
import type { BotProfile } from '@trm/bots';
import {
  configToStored,
  storedToConfig,
  type GameStorePort,
  type RecoveryData,
  type GameDoc,
  type GameEventDoc,
  type GameSnapshotDoc,
  type MatchHistoryDoc,
  type GameChatDoc,
  type ChatEntry,
  type ChatContent,
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
  await db
    .collection<GameChatDoc>('gameChats')
    .createIndex({ gameId: 1, seq: 1 }, { unique: true });
  await db.collection<GameDoc>('games').createIndex({ status: 1, updatedAt: -1 });
  await db
    .collection<MatchHistoryDoc>('matchHistory')
    .createIndex({ 'players.userId': 1, completedAt: -1 });
  await db
    .collection<MatchHistoryDoc>('matchHistory')
    .createIndex({ spectators: 1, completedAt: -1 });
}

export class MongoGameStore implements GameStorePort {
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly snapshots: Collection<GameSnapshotDoc>;
  private readonly history: Collection<MatchHistoryDoc>;
  private readonly chats: Collection<GameChatDoc>;

  constructor(db: Db) {
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.snapshots = db.collection<GameSnapshotDoc>('gameSnapshots');
    this.history = db.collection<MatchHistoryDoc>('matchHistory');
    this.chats = db.collection<GameChatDoc>('gameChats');
  }

  async createGame(
    gameId: string,
    config: GameConfig,
    genesisState: GameState,
    genesisDigest: string,
    bots: readonly BotProfile[] = [],
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
      ...(bots.length > 0 ? { bots: bots.map((b) => ({ ...b })) } : {}),
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
    await this.games.updateOne(
      { _id: gameId },
      { $set: { currentSeq: seq, engineVersion: state.engineVersion, updatedAt: now } },
    );
  }

  async recordCompletion(gameId: string, finalState: GameState): Promise<void> {
    const now = new Date();
    // CAS on LIVE: a bot move racing a maintainer termination to GAME_OVER must not
    // overwrite TERMINATED → COMPLETED. (A recovery replay of an already-COMPLETED
    // game also matches 0 here — that's fine, the archive below stays idempotent.)
    await this.games.updateOne(
      { _id: gameId, status: 'LIVE' },
      { $set: { status: 'COMPLETED', updatedAt: now } },
    );

    const game = await this.games.findOne({ _id: gameId });
    const scores = finalState.finalScores;
    if (!game || !scores) return;
    // A terminated game is dead: no history archive, whatever a racing command computed.
    if (game.status === 'TERMINATED') return;

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
          // A seated member can also mint a spectate ticket — their role stays "player".
          spectators: (game.spectators ?? []).filter(
            (id) => !game.config.players.some((p) => p.id === id),
          ),
          engineVersion: game.engineVersion,
          completedAt: now,
        },
      },
      { upsert: true, writeConcern: { w: 'majority' } },
    );
  }

  async getStatus(gameId: string): Promise<GameDoc['status'] | undefined> {
    const game = await this.games.findOne({ _id: gameId }, { projection: { status: 1 } });
    return game?.status;
  }

  async addSpectator(gameId: string, userId: string): Promise<void> {
    await this.games.updateOne({ _id: gameId }, { $addToSet: { spectators: userId } });
  }

  async appendChat(
    gameId: string,
    seq: number,
    playerId: string,
    content: ChatContent,
  ): Promise<void> {
    await this.chats.insertOne(
      { gameId, seq, playerId, content, ts: new Date() },
      { writeConcern: { w: 'majority' } },
    );
  }

  async loadChat(gameId: string): Promise<ChatEntry[]> {
    const docs = await this.chats.find({ gameId }).sort({ seq: 1 }).toArray();
    return docs.map((d) => ({ playerId: d.playerId, content: d.content, ts: d.ts.getTime() }));
  }

  async loadForRecovery(gameId: string): Promise<RecoveryData | null> {
    // $ne rather than status:'LIVE': COMPLETED games still rehydrate (final-state viewing),
    // but a TERMINATED game must never be resurrected by a member's reconnect.
    const game = await this.games.findOne({ _id: gameId, status: { $ne: 'TERMINATED' } });
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
      bots: game.bots ?? [],
    };
  }
}
