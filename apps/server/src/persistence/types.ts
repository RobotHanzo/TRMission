// Persistence contract + document shapes (ADR A2/A5/A6/A7). The store is an
// event-sourced log: a genesis snapshot, one append-only event per applied action
// (carrying the resulting stateDigest for divergence detection), and periodic full
// snapshots. A game replays deterministically through the engine from the latest
// snapshot + the tail of events.
import { asPlayerId } from '@trm/shared';
import type { RuleParams, SeatIndex } from '@trm/shared';
import type { GameConfig, GameState, Action, FinalScoreboard } from '@trm/engine';
import type { BotProfile } from '../bots/types';

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
  status: 'LIVE' | 'COMPLETED';
  currentSeq: number;
  /** Bot players in this game (so the driver resumes them after crash recovery). */
  bots?: BotProfile[];
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

/** Everything needed to rebuild a live game: base snapshot (or null) + the events after it. */
export interface RecoveryData {
  config: GameConfig;
  snapshot: { seq: number; state: GameState } | null;
  tail: { seq: number; action: Action; stateDigest: string }[];
  bots: BotProfile[];
}

/** Denormalised archive of a finished game, for history listing + leaderboards. */
export interface MatchHistoryDoc {
  _id: string; // gameId
  players: { userId: string; seat: number }[];
  turnOrder: string[];
  seed: string | number;
  contentHash: string;
  finalScores: FinalScoreboard;
  winners: string[];
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
  loadForRecovery(gameId: string): Promise<RecoveryData | null>;
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
