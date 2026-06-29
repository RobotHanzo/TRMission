import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type GameConfig, type GameEvent } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { GameSession } from '../src/game/game-session';
import { pickAction } from './helpers';

const config: GameConfig = {
  seed: 'hist-1',
  players: [
    { id: asPlayerId('p0'), seat: 0 },
    { id: asPlayerId('p1'), seat: 1 },
    { id: asPlayerId('p2'), seat: 2 },
  ],
  contentHash: CONTENT_HASH,
};

describe('GameSession.history()', () => {
  it('reproduces exactly the events from replaying the applied actions', () => {
    const board = taiwanBoard();
    const session = new GameSession('h', board, config);
    const captured: GameEvent[] = [];

    let guard = 0;
    while (session.phase !== 'GAME_OVER') {
      if (++guard > 50_000) throw new Error('did not terminate');
      const state = session.raw();
      const actor =
        state.turn.phase === 'SETUP_TICKETS'
          ? config.players.map((p) => p.id).find((p) => session.hasPendingOffer(p))
          : session.currentPlayer;
      if (!actor) throw new Error(`no actor in ${state.turn.phase}`);
      const res = session.apply(pickAction(board, state, actor));
      if (!res.ok) throw new Error(`rejected: ${res.violation.code}`);
      captured.push(...res.events);
    }

    expect(session.history()).toEqual(captured);
    expect(session.history().length).toBeGreaterThan(0);
  });

  it('returns [] for a freshly created session', () => {
    const session = new GameSession('h2', taiwanBoard(), config);
    expect(session.history()).toEqual([]);
  });
});
