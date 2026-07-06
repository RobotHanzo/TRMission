import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type GameConfig, type PlayerSeed } from '@trm/engine';
import { asPlayerId, type PlayerId, type SeatIndex } from '@trm/shared';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub, type PushSink } from '../src/ws/hub';
import { makeDevTicket } from '../src/ws/ticket';
import type { BotProfile } from '../src/bots/types';
import { encodeClient, actionToCommand, pickAction } from './helpers';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface RecordingSink extends PushSink {
  yourTurnCalls: { gameId: string; playerId: string }[];
  gameOverCalls: { gameId: string; playerIds: string[] }[];
}

const recordingSink = (): RecordingSink => {
  const sink: RecordingSink = {
    yourTurnCalls: [],
    gameOverCalls: [],
    yourTurn(gameId, playerId) {
      sink.yourTurnCalls.push({ gameId, playerId });
    },
    gameOver(gameId, playerIds) {
      sink.gameOverCalls.push({ gameId, playerIds });
    },
  };
  return sink;
};

const mixedSetup = (gameId: string, seed: string) => {
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
  const config: GameConfig = { seed, players, contentHash: CONTENT_HASH };
  return { board, human, players, bots, config };
};

describe('hub push triggers', () => {
  it('pushes your-turn only once the current player has no live socket', async () => {
    const { board, human, bots, config } = mixedSetup('push-yt', 'push-yt-seed');
    const sink = recordingSink();
    const hub = new GameHub(new GameRegistry(), {
      botMoveDelayMs: 0,
      push: sink,
      yourTurnDelayMs: 0,
    });
    const match = await hub.createMatch('push-yt', board, config, bots);
    const { session } = match;

    hub.openConnection('hc', () => {});
    let seq = 0;
    await hub.receive(
      'hc',
      encodeClient(++seq, {
        case: 'hello',
        value: {
          ticket: makeDevTicket({ gameId: 'push-yt', playerId: 'human', seat: 0 }),
          protocolVersion: 1,
        },
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

    // Phase A (connected): play through setup + the human's first full turn.
    let humanTookTurn = false;
    let guard = 0;
    while (!humanTookTurn) {
      if (++guard > 200_000) throw new Error('phase A did not progress');
      if (humanActionable()) {
        await hub.receive(
          'hc',
          encodeClient(++seq, actionToCommand(pickAction(board, session.raw(), human as PlayerId))),
        );
        if (session.raw().turn.phase !== 'SETUP_TICKETS' && session.currentPlayer !== human) {
          humanTookTurn = true;
        }
      } else {
        await tick();
      }
    }
    expect(sink.yourTurnCalls).toEqual([]); // connected the whole time → no reminder

    // Phase B (disconnected): bots play on; the next TURN_STARTED(human) must push.
    hub.closeConnection('hc');
    guard = 0;
    while (sink.yourTurnCalls.length === 0) {
      if (++guard > 200_000) throw new Error('no your-turn push arrived');
      await tick();
    }
    expect(sink.yourTurnCalls[0]).toEqual({ gameId: 'push-yt', playerId: 'human' });
  }, 30_000);

  it('pushes game-over to a socketless human iff a bot move ends the game', async () => {
    // Dance: the human connects only to act and disconnects between turns, so the human
    // is absent at game end UNLESS the final commit is the human's own move. Which player
    // commits last is seed-determined (the whole system is deterministic), so search a
    // fixed seed list: every seed asserts the matching branch (bot-final → pushed with
    // exactly ['human']; human-final → no push), and at least one seed must hit each branch.
    const danceGame = async (seed: string) => {
      const gameId = `push-over-${seed}`;
      const { board, human, bots, config } = mixedSetup(gameId, seed);
      const sink = recordingSink();
      const hub = new GameHub(new GameRegistry(), {
        botMoveDelayMs: 0,
        push: sink,
        yourTurnDelayMs: 0,
      });
      const match = await hub.createMatch(gameId, board, config, bots);
      const { session } = match;

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

      let seq = 0;
      let connSerial = 0;
      let currentConn: string | null = null;
      const connectHuman = async (): Promise<string> => {
        const id = `${gameId}-dc${++connSerial}`;
        hub.openConnection(id, () => {});
        await hub.receive(
          id,
          encodeClient(++seq, {
            case: 'hello',
            value: {
              ticket: makeDevTicket({ gameId, playerId: 'human', seat: 0 }),
              protocolVersion: 1,
            },
          }),
        );
        return id;
      };

      let guard = 0;
      while (session.phase !== 'GAME_OVER') {
        if (++guard > 400_000) throw new Error(`dance game ${seed} did not terminate`);
        if (humanActionable()) {
          if (!currentConn) currentConn = await connectHuman();
          await hub.receive(
            currentConn,
            encodeClient(
              ++seq,
              actionToCommand(pickAction(board, session.raw(), human as PlayerId)),
            ),
          );
        } else {
          if (currentConn && session.currentPlayer !== human) {
            hub.closeConnection(currentConn);
            currentConn = null;
          }
          await tick();
        }
      }
      await tick(); // drain trailing zero-delay timers
      const lastActor = (session.appliedActions.at(-1) as { player?: string } | undefined)?.player;
      return { gameId, sink, humanEndedIt: lastActor === 'human' };
    };

    let sawBotFinal = false;
    let sawHumanFinal = false;
    for (const seed of ['po-1', 'po-2', 'po-3', 'po-4', 'po-5', 'po-6', 'po-7', 'po-8']) {
      const r = await danceGame(seed);
      if (r.humanEndedIt) {
        // Human was connected for their own final move → correctly NOT pushed.
        expect(r.sink.gameOverCalls).toEqual([]);
        sawHumanFinal = true;
      } else {
        expect(r.sink.gameOverCalls).toEqual([{ gameId: r.gameId, playerIds: ['human'] }]);
        sawBotFinal = true;
      }
      if (sawBotFinal && sawHumanFinal) break;
    }
    // The seed list must exercise the positive branch (and in practice hits both).
    expect(sawBotFinal).toBe(true);
  }, 60_000);
});
