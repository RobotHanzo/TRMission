import { UnionFind } from './unionFind';

export interface Edge {
  readonly a: string;
  readonly b: string;
}

export interface TicketGoal {
  readonly a: string;
  readonly b: string;
  readonly value: number;
}

export interface TicketEvaluation {
  readonly net: number;
  readonly completed: number;
  /** Chosen borrowed edge per station (null = borrowed nothing), in station order. */
  readonly borrows: readonly (Edge | null)[];
}

/**
 * Destination-ticket scoring with station borrowing (the constrained-assignment flow).
 *
 * A player connects ticket endpoints over the edges they own, plus — for each station they
 * built — ONE borrowed edge: any single opponent route incident to that station's city. We
 * choose one option per station (including "borrow nothing") to maximise net ticket points,
 * tie-broken by most completed then fewest borrows. Bounded by ≤3 stations × ≤~7 options =
 * ≤343 assignments, so we enumerate exhaustively & deterministically.
 */
export function evaluateTickets(args: {
  ownEdges: readonly Edge[];
  stationCities: readonly string[];
  /** city → candidate borrow edges (opponent routes incident to it, excluding locked). */
  borrowCandidates: ReadonlyMap<string, readonly Edge[]>;
  tickets: readonly TicketGoal[];
  vertices: readonly string[];
}): TicketEvaluation {
  const { ownEdges, stationCities, borrowCandidates, tickets, vertices } = args;

  // Per-station option list: index 0 = borrow nothing (null), then each candidate edge.
  const optionsPerStation: (Edge | null)[][] = stationCities.map((city) => {
    const cands = borrowCandidates.get(city) ?? [];
    return [null, ...cands];
  });

  let best: TicketEvaluation = { net: -Infinity, completed: -1, borrows: [] };

  const assign: (Edge | null)[] = new Array(optionsPerStation.length).fill(null);

  const evaluate = (): void => {
    const uf = new UnionFind(vertices);
    for (const e of ownEdges) uf.union(e.a, e.b);
    for (const e of assign) if (e) uf.union(e.a, e.b);

    let net = 0;
    let completed = 0;
    for (const t of tickets) {
      if (uf.connected(t.a, t.b)) {
        net += t.value;
        completed++;
      } else {
        net -= t.value;
      }
    }
    const borrowCount = assign.filter((e) => e !== null).length;
    const bestBorrowCount = best.borrows.filter((e) => e !== null).length;
    const better =
      net > best.net ||
      (net === best.net && completed > best.completed) ||
      (net === best.net && completed === best.completed && borrowCount < bestBorrowCount);
    if (better) best = { net, completed, borrows: assign.slice() };
  };

  const recurse = (idx: number): void => {
    if (idx === optionsPerStation.length) {
      evaluate();
      return;
    }
    for (const opt of optionsPerStation[idx] as (Edge | null)[]) {
      assign[idx] = opt;
      recurse(idx + 1);
    }
  };
  recurse(0);

  // With no tickets, net is 0 and the loop above still runs once (empty tickets → net 0).
  if (best.completed < 0) best = { net: 0, completed: 0, borrows: assign.slice() };
  return best;
}
