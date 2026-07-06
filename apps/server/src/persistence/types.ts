// Persistence contract + document shapes (ADR A2/A5/A6/A7). The store is an
// event-sourced log: a genesis snapshot, one append-only event per applied action
// (carrying the resulting stateDigest for divergence detection), and periodic full
// snapshots. A game replays deterministically through the engine from the latest
// snapshot + the tail of events.
import { asPlayerId } from '@trm/shared';
import type { RuleParams, SeatIndex } from '@trm/shared';
import type { GameConfig, GameState, Action, FinalScoreboard } from '@trm/engine';
import type { BotProfile } from '@trm/bots';

export interface StoredConfig {
  seed: string | number;
  players: { id: string; seat: number }[];
  contentHash: string;
  ruleParams?: Partial<RuleParams>;
  shuffleTurnOrder?: boolean;
}

export interface GameDoc {
  _id: string; // gameId
  seed: string | number;
  config: StoredConfig;
  engineVersion: number;
  contentHash: string;
  schemaVersion: number;
  /** TERMINATED = force-closed by a maintainer; never archived, never replayable. */
  status: 'LIVE' | 'COMPLETED' | 'TERMINATED';
  currentSeq: number;
  terminatedAt?: Date;
  terminatedBy?: string; // maintainer userId
  terminatedReason?: string;
  /** Bot players in this game (so the driver resumes them after crash recovery). */
  bots?: BotProfile[];
  /** userIds who ever spectated (never seated players); grants history/replay access. */
  spectators?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface GameEventDoc {
  gameId: string;
  seq: number;
  action: Action;
  stateDigest: string;
  ts: Date;
}

export interface GameSnapshotDoc {
  gameId: string;
  seq: number;
  state: GameState;
  stateDigest: string;
  ts: Date;
}

/** Either free-typed text or a validated preset id — the same discriminated shape the wire uses. */
export type ChatContent = { case: 'text'; value: string } | { case: 'presetId'; value: string };

/** A persisted chat line. Chat is non-authoritative (outside the engine/digest). */
export interface GameChatDoc {
  gameId: string;
  seq: number;
  playerId: string;
  content: ChatContent;
  ts: Date;
}

/** In-memory chat line (the hub keeps these per game and replays them on connect). */
export interface ChatEntry {
  playerId: string;
  content: ChatContent;
  ts: number;
}

/** Everything needed to rebuild a live game: base snapshot (or null) + the events after it. */
export interface RecoveryData {
  config: GameConfig;
  snapshot: { seq: number; state: GameState } | null;
  tail: { seq: number; action: Action; stateDigest: string }[];
  bots: BotProfile[];
}

/** Who may fetch a finished game's replay: members only, or anyone holding the link. */
export type ReplayVisibility = 'private' | 'link';

/** Denormalised archive of a finished game, for history listing + leaderboards. */
export interface MatchHistoryDoc {
  _id: string; // gameId
  players: { userId: string; seat: number }[];
  turnOrder: string[];
  seed: string | number;
  contentHash: string;
  finalScores: FinalScoreboard;
  winners: string[];
  /** Spectator userIds copied from the game doc at completion (absent on legacy docs). */
  spectators?: string[];
  /** ENGINE_VERSION the game ran on, for replayability flags (absent on legacy docs). */
  engineVersion?: number;
  /** Seated players may flip this; absent = 'private' (the pre-feature behaviour). */
  replayVisibility?: ReplayVisibility;
  completedAt: Date;
}

export interface GameStorePort {
  createGame(
    gameId: string,
    config: GameConfig,
    genesisState: GameState,
    genesisDigest: string,
    bots?: readonly BotProfile[],
  ): Promise<void>;
  appendAction(
    gameId: string,
    seq: number,
    action: Action,
    stateDigest: string,
    state: GameState,
  ): Promise<void>;
  /** At game over: mark COMPLETED and archive a match-history record. */
  recordCompletion(gameId: string, finalState: GameState): Promise<void>;
  /** Current status of a game, or undefined if unknown. Used by rematch to confirm a game has
   *  actually finished even across a server restart (the hub's in-memory registry is the fast
   *  path; this is the durable fallback). */
  getStatus(gameId: string): Promise<GameDoc['status'] | undefined>;
  /** Record that a user spectated this game (idempotent; no-op for unknown games). */
  addSpectator(gameId: string, userId: string): Promise<void>;
  loadForRecovery(gameId: string): Promise<RecoveryData | null>;
  appendChat(gameId: string, seq: number, playerId: string, content: ChatContent): Promise<void>;
  loadChat(gameId: string): Promise<ChatEntry[]>;
}

export function configToStored(c: GameConfig): StoredConfig {
  return {
    seed: c.seed,
    players: c.players.map((p) => ({ id: p.id as string, seat: p.seat })),
    contentHash: c.contentHash,
    ...(c.ruleParams ? { ruleParams: c.ruleParams } : {}),
    ...(c.shuffleTurnOrder !== undefined ? { shuffleTurnOrder: c.shuffleTurnOrder } : {}),
  };
}

export function storedToConfig(s: StoredConfig): GameConfig {
  return {
    seed: s.seed,
    players: s.players.map((p) => ({ id: asPlayerId(p.id), seat: p.seat as SeatIndex })),
    contentHash: s.contentHash,
    ...(s.ruleParams ? { ruleParams: s.ruleParams } : {}),
    ...(s.shuffleTurnOrder !== undefined ? { shuffleTurnOrder: s.shuffleTurnOrder } : {}),
  };
}
