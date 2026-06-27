// In-memory registry of live games (Step A). A `Match` couples a GameSession with
// its serialization mutex and the set of connected players. Step B swaps the
// backing store for MongoDB + crash recovery; the public shape stays the same.
import type { Board, GameConfig } from '@trm/engine';
import { GameSession } from './game-session';
import { CommandQueue } from './command-queue';

export interface Match {
  readonly session: GameSession;
  readonly queue: CommandQueue;
}

export class GameRegistry {
  private readonly matches = new Map<string, Match>();

  create(gameId: string, board: Board, config: GameConfig): Match {
    if (this.matches.has(gameId)) throw new Error(`game ${gameId} already exists`);
    const match: Match = {
      session: new GameSession(gameId, board, config),
      queue: new CommandQueue(),
    };
    this.matches.set(gameId, match);
    return match;
  }

  /** Register an already-built session (e.g. recovered from the store) with a fresh queue. */
  adopt(gameId: string, session: GameSession): Match {
    const match: Match = { session, queue: new CommandQueue() };
    this.matches.set(gameId, match);
    return match;
  }

  get(gameId: string): Match | undefined {
    return this.matches.get(gameId);
  }

  remove(gameId: string): void {
    this.matches.delete(gameId);
  }

  get size(): number {
    return this.matches.size;
  }
}
