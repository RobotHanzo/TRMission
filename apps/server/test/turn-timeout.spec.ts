import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type GameConfig, type PlayerSeed } from '@trm/engine';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import { GameSession } from '../src/game/game-session';
import { chooseTimeoutAction, turnActor } from '../src/ws/turn-timeout';

function newSession(seed = 'timeout'): {
  board: ReturnType<typeof taiwanBoard>;
  session: GameSession;
} {
  const board = taiwanBoard();
  const players: PlayerSeed[] = [
    { id: asPlayerId('p0'), seat: 0 as SeatIndex },
    { id: asPlayerId('p1'), seat: 1 as SeatIndex },
  ];
  const config: GameConfig = { seed, players, contentHash: CONTENT_HASH };
  return { board, session: new GameSession('g', board, config) };
}

/** Drive the simultaneous SETUP_TICKETS phase to completion by keeping every player's full offer. */
function resolveSetup(session: GameSession): void {
  for (let guard = 0; guard < 10 && session.phase === 'SETUP_TICKETS'; guard++) {
    const state = session.raw();
    const pid = state.turnOrder.find((id) => state.players[id as string]?.pendingTicketOffer);
    if (!pid) break;
    const offer = state.players[pid as string]!.pendingTicketOffer!;
    session.apply({ t: 'KEEP_INITIAL_TICKETS', player: pid, keep: offer });
  }
}

describe('turnActor', () => {
  it('is null during the simultaneous SETUP_TICKETS phase (the per-turn timer does not cover it)', () => {
    const { session } = newSession();
    expect(session.phase).toBe('SETUP_TICKETS');
    expect(turnActor(session.raw())).toBeNull();
  });

  it('is the current player during a normal turn', () => {
    const { session } = newSession();
    resolveSetup(session);
    expect(session.phase).toBe('AWAIT_ACTION');
    expect(turnActor(session.raw())).toBe(session.currentPlayer);
  });
});

describe('chooseTimeoutAction', () => {
  it('takes a random (blind) train card on a normal turn', () => {
    const { board, session } = newSession();
    resolveSetup(session);
    const actor = session.currentPlayer!;
    const action = chooseTimeoutAction(board, session.raw(), actor);
    expect(action?.t).toBe('DRAW_BLIND');
    // Whatever it picks is always a move the reducer accepts (never an illegal auto-move).
    expect(action && session.prepare(action).ok).toBe(true);
  });

  it('keeps ALL offered tickets when the player is forced into a ticket selection', () => {
    const { board, session } = newSession();
    resolveSetup(session);
    const actor = session.currentPlayer!;
    session.apply({ t: 'DRAW_TICKETS', player: actor });
    expect(session.phase).toBe('TICKET_SELECTION');

    const offer = session.raw().players[actor as string]!.pendingTicketOffer!;
    expect(offer.length).toBeGreaterThan(0);

    const action = chooseTimeoutAction(board, session.raw(), actor);
    expect(action?.t).toBe('KEEP_TICKETS');
    expect(action && action.t === 'KEEP_TICKETS' ? action.keep.length : -1).toBe(offer.length);
    expect(action && session.prepare(action).ok).toBe(true);
  });
});
