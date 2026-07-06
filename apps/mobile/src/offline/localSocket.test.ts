import type { Action } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { LocalSocket } from './localSocket';

describe('LocalSocket', () => {
  it('maps stage commands through the shared codec to engine actions for the human', () => {
    const seen: Action[] = [];
    const human = asPlayerId('local:human');
    const socket = new LocalSocket(human, (a) => seen.push(a));

    socket.keepInitialTickets(['t1', 't2']);
    socket.drawBlind();
    socket.pass();
    socket.cameraUpdate({ cx: 1, cy: 2, span: 3 }); // cosmetic → no action

    expect(seen.map((a) => a.t)).toEqual(['KEEP_INITIAL_TICKETS', 'DRAW_BLIND', 'PASS']);
    expect(seen.every((a) => a.player === human)).toBe(true);
  });
});
