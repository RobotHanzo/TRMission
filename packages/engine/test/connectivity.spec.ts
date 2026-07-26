import { describe, it, expect } from 'vitest';
import { evaluateTickets, ownConnectedTicketIds } from '../src/graph/connectivity';
import type { Edge } from '../src/graph/connectivity';
import { UnionFind } from '../src/graph/unionFind';

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
      [
        'b',
        [
          { a: 'b', b: 'c' },
          { a: 'b', b: 'd' },
        ],
      ],
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

/**
 * The contracted branch-and-bound must agree with the plain product enumeration it replaced — that
 * equivalence is what lets a v15 engine keep replaying pre-v15 games byte-identically. Cross-checked
 * over pseudo-random instances (a fixed LCG, so a failure is reproducible) rather than by hand.
 */
describe('evaluateTickets — equivalence with exhaustive enumeration', () => {
  interface Instance {
    ownEdges: Edge[];
    stationCities: string[];
    borrowCandidates: Map<string, Edge[]>;
    tickets: { a: string; b: string; value: number }[];
    vertices: string[];
    noUnfinishedTicketPenalty: boolean;
  }

  /** The pre-v15 algorithm: try every option per station, score each assignment from scratch. */
  function bruteForce(inst: Instance): {
    net: number;
    completed: number;
    borrows: (Edge | null)[];
  } {
    const options = inst.stationCities.map((c) => [null, ...(inst.borrowCandidates.get(c) ?? [])]);
    const assign: (Edge | null)[] = new Array(options.length).fill(null);
    let best = { net: -Infinity, completed: -1, borrows: [] as (Edge | null)[] };
    const evaluate = (): void => {
      const uf = new UnionFind(inst.vertices);
      for (const e of inst.ownEdges) uf.union(e.a, e.b);
      for (const e of assign) if (e) uf.union(e.a, e.b);
      let net = 0;
      let completed = 0;
      for (const t of inst.tickets) {
        if (uf.connected(t.a, t.b)) {
          net += t.value;
          completed++;
        } else if (!inst.noUnfinishedTicketPenalty) {
          net -= t.value;
        }
      }
      const borrows = assign.filter((e) => e !== null).length;
      const bestBorrows = best.borrows.filter((e) => e !== null).length;
      if (
        net > best.net ||
        (net === best.net && completed > best.completed) ||
        (net === best.net && completed === best.completed && borrows < bestBorrows)
      )
        best = { net, completed, borrows: assign.slice() };
    };
    const rec = (i: number): void => {
      if (i === options.length) return evaluate();
      for (const o of options[i] as (Edge | null)[]) {
        assign[i] = o;
        rec(i + 1);
      }
    };
    rec(0);
    return best;
  }

  /** Cities joined by the chosen borrows, as a canonical sorted signature. */
  const borrowSig = (borrows: readonly (Edge | null)[]): string =>
    borrows.map((e) => (e ? (e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`) : '·')).join(',');

  it('matches brute force (net, completed and the chosen assignment) on random instances', () => {
    let seed = 0x9e3779b9;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const cities = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const cityAt = (i: number): string => cities[i] as string;

    for (let iter = 0; iter < 400; iter++) {
      const vertices = [...cities];
      const ownEdges: Edge[] = [];
      for (let i = 0; i < 3; i++) {
        const a = rnd(cities.length);
        const b = rnd(cities.length);
        if (a !== b) ownEdges.push({ a: cityAt(a), b: cityAt(b) });
      }
      const stationCount = 1 + rnd(4);
      const stationCities: string[] = [];
      const borrowCandidates = new Map<string, Edge[]>();
      for (let s = 0; s < stationCount; s++) {
        const city = cityAt(rnd(cities.length));
        if (stationCities.includes(city)) continue; // one station per city
        stationCities.push(city);
        const cands: Edge[] = [];
        for (let k = 0; k < 1 + rnd(3); k++) {
          const far = cityAt(rnd(cities.length));
          if (far !== city) cands.push({ a: city, b: far });
        }
        borrowCandidates.set(city, cands);
      }
      const tickets: { a: string; b: string; value: number }[] = [];
      for (let k = 0; k < 1 + rnd(3); k++) {
        const a = rnd(cities.length);
        const b = rnd(cities.length);
        if (a !== b) tickets.push({ a: cityAt(a), b: cityAt(b), value: 1 + rnd(12) });
      }
      const inst: Instance = {
        ownEdges,
        stationCities,
        borrowCandidates,
        tickets,
        vertices,
        noUnfinishedTicketPenalty: rnd(2) === 0,
      };

      const fast = evaluateTickets(inst);
      const slow = bruteForce(inst);
      expect({ net: fast.net, completed: fast.completed }).toEqual({
        net: slow.net,
        completed: slow.completed,
      });
      // The reported assignment must be borrow-for-borrow equivalent, so `completedTicketIds`
      // re-derived from it cannot drift either.
      expect(borrowSig(fast.borrows)).toBe(borrowSig(slow.borrows));
    }
  });

  it("solves a trio's nine shared stations without exploding", () => {
    // 9 stations (three teammates × three) each with 6 candidates: 7^9 ≈ 40M assignments for the old
    // product enumeration. Station i can finish ticket i by borrowing c(10+i) — but that option is
    // LAST behind five dead-end decoys, so a search that cannot prune has to grind through the lot.
    const vertices = Array.from({ length: 30 }, (_, i) => `c${i}`);
    const stationCities = Array.from({ length: 9 }, (_, i) => `c${i}`);
    const borrowCandidates = new Map<string, Edge[]>(
      stationCities.map((city, i) => [
        city,
        [
          ...Array.from({ length: 5 }, (_, k) => ({ a: city, b: `c${20 + ((i + k) % 10)}` })),
          { a: city, b: `c${10 + i}` },
        ],
      ]),
    );
    const tickets = Array.from({ length: 6 }, (_, i) => ({
      a: `c${i}`,
      b: `c${10 + i}`,
      value: 5 + i,
    }));
    const r = evaluateTickets({
      ownEdges: [],
      stationCities,
      borrowCandidates,
      tickets,
      vertices,
      stepBudget: 200_000,
    });
    // Every ticket is one borrow away and there are stations to spare, so the optimum takes them all
    // — reached well inside the budget, which a truncated search would miss.
    expect(r.completed).toBe(6);
    expect(r.net).toBe(tickets.reduce((n, t) => n + t.value, 0));
  });
});
