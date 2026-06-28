import { describe, it, expect } from 'vitest';
import { asPlayerId } from '@trm/shared';
import { borrowConnectedTicketIds } from '../src/graph/connectivity';
import { stationBorrowEdges } from '../src/scoring';
import { initGame } from '../src/setup';
import { cloneState } from '../src/serialize';
import { makeConfig } from './helpers';

describe('borrowConnectedTicketIds', () => {
  it('unions own + borrowed edges to connect a ticket', () => {
    const ids = borrowConnectedTicketIds({
      ownEdges: [{ a: 'X', b: 'M' }],
      borrowEdges: [{ a: 'M', b: 'Y' }],
      tickets: [{ id: 't1', a: 'X', b: 'Y' }],
    });
    expect(ids).toEqual(['t1']);
  });

  it('does not connect a ticket without the borrowed edge', () => {
    const ids = borrowConnectedTicketIds({
      ownEdges: [{ a: 'X', b: 'M' }],
      borrowEdges: [],
      tickets: [{ id: 't1', a: 'X', b: 'Y' }],
      vertices: ['X', 'M', 'Y'],
    });
    expect(ids).toEqual([]);
  });
});

describe('stationBorrowEdges', () => {
  it('returns opponent edges incident to the player station city', () => {
    const { board, config } = makeConfig(2, 'borrow-edges');
    const route = board.content.routes[0]!;
    const me = asPlayerId('p0');
    const opp = asPlayerId('p1');
    const s = {
      ...cloneState(initGame(board, config)),
      ownership: { [route.id as string]: { owner: opp } },
      stations: [{ playerId: me, cityId: route.a }],
    };
    expect(stationBorrowEdges(board, s, me)).toContainEqual({
      a: route.a as string,
      b: route.b as string,
    });
  });

  it("excludes the player's own routes from borrow edges", () => {
    const { board, config } = makeConfig(2, 'borrow-edges2');
    const route = board.content.routes[0]!;
    const me = asPlayerId('p0');
    const s = {
      ...cloneState(initGame(board, config)),
      ownership: { [route.id as string]: { owner: me } },
      stations: [{ playerId: me, cityId: route.a }],
    };
    expect(stationBorrowEdges(board, s, me)).toEqual([]);
  });
});
