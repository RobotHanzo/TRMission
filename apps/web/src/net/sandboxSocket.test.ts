import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { Action, GameConfig } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { Phase, type GameSnapshot } from '@trm/proto';
import { SandboxSocket } from './sandboxSocket';

const p0 = asPlayerId('p0');
const p1 = asPlayerId('p1');

function makeSandbox() {
  const board = taiwanBoard();
  const config: GameConfig = {
    seed: 'sandbox-smoke',
    players: [
      { id: p0, seat: 0 },
      { id: p1, seat: 1 },
    ],
    contentHash: CONTENT_HASH,
  };
  let snapshot: GameSnapshot | null = null;
  const actions: Action[] = [];
  const sandbox = new SandboxSocket(board, config, p0, {
    applySnapshot: (s) => {
      snapshot = s;
    },
    applyEvents: () => {},
    onAction: (a) => {
      actions.push(a);
    },
  });
  return { sandbox, actions, snap: () => snapshot };
}

describe('SandboxSocket', () => {
  it('projects an initial snapshot for the viewer in SETUP_TICKETS', () => {
    const { snap } = makeSandbox();
    expect(snap()).not.toBeNull();
    expect(snap()!.phase).toBe(Phase.SETUP_TICKETS);
    expect(snap()!.you?.playerId).toBe('p0');
    // Opponent is counts-only — the projection never leaks their hand into the snapshot.
    const opp = snap()!.players.find((p) => p.id === 'p1');
    expect(opp).toBeDefined();
    expect(opp).not.toHaveProperty('hand');
  });

  it('drives a learner command + a scripted bot move through the local engine', () => {
    const { sandbox, actions, snap } = makeSandbox();

    // Learner keeps their whole offer (a command, mapped through the codec like the wire);
    // the bot keeps via a scripted auto-action (reading its hidden offer from engine state).
    const myOffer = sandbox.getState().players['p0']!.pendingTicketOffer!;
    const botOffer = sandbox.getState().players['p1']!.pendingTicketOffer!;
    sandbox.keepInitialTickets(myOffer.map(String));
    sandbox.auto({ t: 'KEEP_INITIAL_TICKETS', player: p1, keep: botOffer });

    expect(snap()!.phase).toBe(Phase.AWAIT_ACTION);
    expect(snap()!.currentPlayerId).toBe('p0');
    expect(actions.some((a) => a.t === 'KEEP_INITIAL_TICKETS')).toBe(true);
  });

  it('rejects an illegal learner move without advancing state', () => {
    const { sandbox, snap } = makeSandbox();
    const before = snap()!.stateVersion;
    // Drawing a card during SETUP_TICKETS is illegal — the engine rejects it, state is unchanged.
    sandbox.drawBlind();
    expect(snap()!.stateVersion).toBe(before);
    expect(snap()!.phase).toBe(Phase.SETUP_TICKETS);
  });
});
