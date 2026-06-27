import { describe, it, expect } from 'vitest';
import { evaluateTickets, ownConnectedTicketIds } from '../src/graph/connectivity';
import type { Edge } from '../src/graph/connectivity';

const V = ['a', 'b', 'c', 'd'];

describe('ownConnectedTicketIds', () => {
  it('marks only tickets joined by own edges (no borrowing)', () => {
    const r = ownConnectedTicketIds({
      ownEdges: [
        { a: 'X', b: 'Y' },
        { a: 'Y', b: 'Z' },
      ],
      tickets: [
        { id: 't1', a: 'X', b: 'Z' },
        { id: 't2', a: 'X', b: 'Q' },
      ],
      vertices: ['X', 'Y', 'Z', 'Q'],
    });
    expect(r).toEqual(['t1']);
  });

  it('returns [] when no own edges connect the endpoints', () => {
    expect(
      ownConnectedTicketIds({
        ownEdges: [{ a: 'X', b: 'Y' }],
        tickets: [{ id: 't1', a: 'X', b: 'Z' }],
        vertices: ['X', 'Y', 'Z'],
      }),
    ).toEqual([]);
  });
});

describe('evaluateTickets', () => {
  it('scores a directly-connected ticket', () => {
    const r = evaluateTickets({
      ownEdges: [{ a: 'a', b: 'b' }],
      stationCities: [],
      borrowCandidates: new Map(),
      tickets: [{ a: 'a', b: 'b', value: 5 }],
      vertices: V,
    });
    expect(r).toMatchObject({ net: 5, completed: 1 });
  });

  it('penalises an unconnected ticket', () => {
    const r = evaluateTickets({
      ownEdges: [{ a: 'a', b: 'b' }],
      stationCities: [],
      borrowCandidates: new Map(),
      tickets: [{ a: 'a', b: 'c', value: 5 }],
      vertices: V,
    });
    expect(r).toMatchObject({ net: -5, completed: 0 });
  });

  it('uses a station to borrow one opponent route to complete a ticket', () => {
    // Own a-b; opponent owns b-c; station at b can borrow b-c → a-c connected.
    const borrow = new Map<string, Edge[]>([['b', [{ a: 'b', b: 'c' }]]]);
    const r = evaluateTickets({
      ownEdges: [{ a: 'a', b: 'b' }],
      stationCities: ['b'],
      borrowCandidates: borrow,
      tickets: [{ a: 'a', b: 'c', value: 5 }],
      vertices: V,
    });
    expect(r.net).toBe(5);
    expect(r.completed).toBe(1);
    expect(r.borrows.filter((e) => e !== null)).toHaveLength(1);
  });

  it('maximises net points, not greedy per-station, when only one borrow is possible', () => {
    // One station at b can borrow EITHER b-c or b-d (not both).
    // ticket a-c=3, a-d=10. Best = borrow b-d (net +10 -3 = 7) over b-c (net +3 -10 = -7).
    const borrow = new Map<string, Edge[]>([
      ['b', [{ a: 'b', b: 'c' }, { a: 'b', b: 'd' }]],
    ]);
    const r = evaluateTickets({
      ownEdges: [{ a: 'a', b: 'b' }],
      stationCities: ['b'],
      borrowCandidates: borrow,
      tickets: [
        { a: 'a', b: 'c', value: 3 },
        { a: 'a', b: 'd', value: 10 },
      ],
      vertices: V,
    });
    expect(r.net).toBe(7);
    expect(r.completed).toBe(1);
  });

  it('returns 0/0 with no tickets', () => {
    const r = evaluateTickets({
      ownEdges: [{ a: 'a', b: 'b' }],
      stationCities: [],
      borrowCandidates: new Map(),
      tickets: [],
      vertices: V,
    });
    expect(r).toMatchObject({ net: 0, completed: 0 });
  });
});
