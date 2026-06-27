import { describe, it, expect } from 'vitest';
import {
  taiwanBoard,
  replay,
  stateDigest,
  CONTENT_HASH,
  type GameConfig,
  type PlayerSeed,
} from '@trm/engine';
import { asPlayerId, type PlayerId, type SeatIndex } from '@trm/shared';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import type { BotProfile, BotDifficulty } from '../src/bots/types';
import { encodeClient, actionToCommand, pickAction } from './helpers';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function waitForGameOver(phaseOf: () => string, maxTicks = 200_000): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (phaseOf() === 'GAME_OVER') return;
    await tick();
  }
  throw new Error('game did not terminate');
}

describe('bots: an all-bot table plays itself to a valid finish', () => {
  it('drives every phase autonomously and the action log replays digit-for-digit', async () => {
    const board = taiwanBoard();
    const seats: { id: string; difficulty: BotDifficulty }[] = [
      { id: 'bot:e', difficulty: 'EASY' },
      { id: 'bot:m', difficulty: 'MEDIUM' },
      { id: 'bot:h', difficulty: 'HARD' },
    ];
    const players: PlayerSeed[] = seats.map((s, i) => ({
      id: asPlayerId(s.id),
      seat: i as SeatIndex,
    }));
    const bots: BotProfile[] = seats.map((s) => ({ playerId: s.id, difficulty: s.difficulty }));
    const config: GameConfig = { seed: 'bots-all', players, contentHash: CONTENT_HASH };

    // No human ever connects: createMatch kicks the driver and the bots run the whole game.
    const hub = new GameHub(new GameRegistry(), { botMoveDelayMs: 0 });
    const match = await hub.createMatch('all-bots', board, config, bots);
    const { session } = match;

    await waitForGameOver(() => session.phase);

    expect(session.phase).toBe('GAME_OVER');
    const scores = session.raw().finalScores;
    expect(scores?.players).toHaveLength(3);
    expect(scores?.ranking.length).toBeGreaterThan(0);

    // Every move the bots made is a logged action → a pure replay reaches the same state.
    const rep = replay(taiwanBoard(), config, session.appliedActions);
    expect(stateDigest(rep.state)).toBe(session.digest());
  }, 30_000);
});

describe('bots: fill out a short table for a single human', () => {
  it('lets a lone human finish a game with two bots taking their own turns', async () => {
    const board = taiwanBoard();
    const human = asPlayerId('human');
    const players: PlayerSeed[] = [
      { id: human, seat: 0 as SeatIndex },
      { id: asPlayerId('bot:a'), seat: 1 as SeatIndex },
      { id: asPlayerId('bot:b'), seat: 2 as SeatIndex },
    ];
    const bots: BotProfile[] = [
      { playerId: 'bot:a', difficulty: 'MEDIUM' },
      { playerId: 'bot:b', difficulty: 'HARD' },
    ];
    const config: GameConfig = { seed: 'bots-mixed', players, contentHash: CONTENT_HASH };

    const hub = new GameHub(new GameRegistry(), { botMoveDelayMs: 0 });
    const match = await hub.createMatch('mixed', board, config, bots);
    const { session } = match;

    hub.openConnection('hc', () => {});
    let seq = 0;
    await hub.receive(
      'hc',
      encodeClient(++seq, {
        case: 'hello',
        value: { ticket: makeDevTicket({ gameId: 'mixed', playerId: 'human', seat: 0 }), protocolVersion: 1 },
      }),
    );

    const humanActionable = (): boolean => {
      const s = session.raw();
      switch (s.turn.phase) {
        case 'SETUP_TICKETS':
          return session.hasPendingOffer(human);
        case 'TICKET_SELECTION':
        case 'AWAIT_ACTION':
        case 'DRAWING_CARDS':
          return session.currentPlayer === human;
        case 'TUNNEL_PENDING':
          return s.pendingTunnel?.playerId === human;
        default:
          return false;
      }
    };

    let guard = 0;
    while (session.phase !== 'GAME_OVER') {
      if (++guard > 200_000) throw new Error('mixed game did not terminate');
      if (humanActionable()) {
        await hub.receive(
          'hc',
          encodeClient(++seq, actionToCommand(pickAction(board, session.raw(), human as PlayerId))),
        );
      } else {
        await tick(); // let the background bot driver advance the other seats
      }
    }

    const scores = session.raw().finalScores;
    expect(scores?.players).toHaveLength(3);
    // The two bots are scored alongside the human.
    expect(scores?.players.map((p) => p.playerId as string).sort()).toEqual(
      ['bot:a', 'bot:b', 'human'].sort(),
    );
  }, 30_000);
});
