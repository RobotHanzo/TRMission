import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import type { GameSnapshot } from '@trm/proto';
import { SandboxSocket } from './sandboxSocket';

describe('SandboxSocket (mobile port)', () => {
  it('projects a redacted snapshot for the viewer and reports learner actions', () => {
    const snapshots: GameSnapshot[] = [];
    let actions = 0;
    const sandbox = new SandboxSocket(
      taiwanBoard(),
      {
        seed: 'tut-welcome',
        players: [
          { id: asPlayerId('you'), seat: 0 as SeatIndex },
          { id: asPlayerId('bot:rival'), seat: 1 as SeatIndex },
        ],
        contentHash: CONTENT_HASH,
      },
      asPlayerId('you'),
      {
        applySnapshot: (s) => snapshots.push(s),
        applyEvents: () => {},
        onAction: () => {
          actions += 1;
        },
      },
    );
    const offer = [...(sandbox.getState().players['you']?.pendingTicketOffer ?? [])];
    expect(offer.length).toBeGreaterThan(0);
    sandbox.keepInitialTickets(offer as string[]);
    expect(actions).toBe(1);
    const last = snapshots.at(-1)!;
    // Hidden-information posture holds offline too: the snapshot's private block is the viewer's.
    expect(last.you?.playerId).toBe('you');
  });
});
