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

export interface IdTicketGoal {
  readonly id: string;
  readonly a: string;
  readonly b: string;
}

/**
 * Tickets whose endpoints are connected using ONLY the player's own edges (no station
 * borrowing). This is monotonic — once connected, always connected — so it is the basis for
 * *instant* ticket completion: a ticket joined by your own track is guaranteed to also count
 * under the full end-game `evaluateTickets` pass, so the two can never disagree.
 */
export function ownConnectedTicketIds(args: {
  ownEdges: readonly Edge[];
  tickets: readonly IdTicketGoal[];
  vertices?: readonly string[];
}): string[] {
  const uf = new UnionFind(args.vertices);
  for (const e of args.ownEdges) uf.union(e.a, e.b);
  return args.tickets.filter((t) => uf.connected(t.a, t.b)).map((t) => t.id);
}

/**
 * Are cities `a` and `b` connected using ONLY the supplied edges (no station borrowing)? Pure
 * union-find over `edges`; the single primitive behind the random-events charter award, where a
 * player's own claimed edges must join the two charter endpoints. Reuses {@link UnionFind} rather
 * than duplicating the union-find logic.
 */
export function citiesConnected(edges: readonly Edge[], a: string, b: string): boolean {
  const uf = new UnionFind([a, b]);
  for (const e of edges) uf.union(e.a, e.b);
  return uf.connected(a, b);
}

/**
 * Tickets connected by the player's own edges UNION all their station-borrowed edges. Under the
 * `unlimitedStationBorrow` variant every station borrows ALL its incident opponent edges, so the
 * borrow graph only grows — this union is monotonic and is the basis for instant, locked completion.
 */
export function borrowConnectedTicketIds(args: {
  ownEdges: readonly Edge[];
  borrowEdges: readonly Edge[];
  tickets: readonly IdTicketGoal[];
  vertices?: readonly string[];
}): string[] {
  const uf = new UnionFind(args.vertices);
  for (const e of args.ownEdges) uf.union(e.a, e.b);
  for (const e of args.borrowEdges) uf.union(e.a, e.b);
  return args.tickets.filter((t) => uf.connected(t.a, t.b)).map((t) => t.id);
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
 * Ticket endpoints are joined over the owned edges, plus — for each station — ONE borrowed edge:
 * any single opponent route incident to that station's city. We choose one option per station
 * (including "borrow nothing") to maximise net ticket points, tie-broken by most completed then
 * fewest borrows. In a v15+ team game the caller passes the whole SIDE's stations and the whole
 * side's tickets, so one assignment serves the team: up to 9 stations (a trio × 3) rather than 3,
 * which is why the naive product enumeration is not viable and the search below is contracted and
 * pruned instead. Every step is order-deterministic — no Set/Map iteration feeds a decision.
 *
 * The search is exhaustive up to `stepBudget`, and returns the SAME optimum (and the same
 * canonical assignment) as the plain product enumeration it replaces:
 *
 * - **Contract the own network.** A borrow can only ever merge the component holding one end with
 *   the component holding the other, so the whole search runs over own-edge components — a tiny
 *   integer union-find with rollback instead of a fresh city-level one per assignment.
 * - **Collapse equivalent options.** Two candidate edges at one station that merge the same pair of
 *   components are interchangeable, and one whose ends already share a component is a no-op that
 *   only burns a borrow, so it loses the fewest-borrows tiebreak to "borrow nothing" (explored
 *   first). Both are dropped, keeping the earliest survivor of each pair to preserve the winner.
 * - **Prune and stop early.** A greedy pass supplies an achievable net floor; a branch is cut when
 *   even every ticket its remaining stations could still reach leaves it below that floor, since the
 *   winner's net IS the optimum and the optimum is at least the floor. A node whose tickets are all
 *   either connected or out of reach returns at once — its descendants can only add borrows.
 *   Equal-net branches are always explored, so the completed/borrows tiebreaks resolve exactly as the
 *   product enumeration resolved them (cross-checked against it in the tests).
 */
export function evaluateTickets(args: {
  ownEdges: readonly Edge[];
  stationCities: readonly string[];
  /** city → candidate borrow edges (opponent routes incident to it, excluding locked). */
  borrowCandidates: ReadonlyMap<string, readonly Edge[]>;
  tickets: readonly TicketGoal[];
  vertices: readonly string[];
  /** Variant: unfinished tickets contribute 0 instead of −value. */
  noUnfinishedTicketPenalty?: boolean;
  /** Deterministic node ceiling; if ever hit, the best found so far wins (same input → same
   *  result, so replay stays deterministic). Mirrors `longestTrail`'s step budget. */
  stepBudget?: number;
}): TicketEvaluation {
  const { ownEdges, stationCities, borrowCandidates, tickets, vertices } = args;
  const noUnfinishedTicketPenalty = args.noUnfinishedTicketPenalty ?? false;
  const stepBudget = args.stepBudget ?? 1_000_000;

  // ── contract the own network into components ───────────────────────────────────────────────
  const base = new UnionFind(vertices);
  for (const e of ownEdges) base.union(e.a, e.b);
  const compOfRoot = new Map<string, number>();
  const comp = (v: string): number => {
    const root = base.find(v);
    let id = compOfRoot.get(root);
    if (id === undefined) {
      id = compOfRoot.size;
      compOfRoot.set(root, id);
    }
    return id;
  };

  // Ticket goals as component pairs. `gain` is what completing one adds to `net`: the ticket flips
  // from −value to +value when unfinished tickets are penalised, else from 0 to +value.
  const goals = tickets.map((t) => ({
    a: comp(t.a),
    b: comp(t.b),
    gain: noUnfinishedTicketPenalty ? t.value : t.value * 2,
  }));
  let net0 = 0;
  if (!noUnfinishedTicketPenalty) for (const t of tickets) net0 -= t.value;

  // Per-station options, in the caller's candidate order, deduped by the component pair they merge.
  interface Option {
    readonly edge: Edge;
    readonly u: number;
    readonly v: number;
  }
  const options: Option[][] = stationCities.map((city) => {
    const out: Option[] = [];
    const seen = new Set<string>();
    for (const edge of borrowCandidates.get(city) ?? []) {
      const u = comp(edge.a);
      const v = comp(edge.b);
      if (u === v) continue; // a no-op merge: dominated by borrowing nothing
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ edge, u, v });
    }
    return out;
  });
  // Station indices that actually have a choice to make; the rest keep their null slot.
  const active = stationCities.map((_, i) => i).filter((i) => (options[i] as Option[]).length > 0);

  // ── rollback union-find over components (union by size, no path compression) ───────────────
  const n = compOfRoot.size;
  const parent = new Int32Array(n);
  const size = new Int32Array(n).fill(1);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] as number;
    return r;
  };
  /** Merge, returning the [child, parent] roots to undo — or null when already merged. */
  const merge = (a: number, b: number): [number, number] | null => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return null;
    if ((size[ra] as number) < (size[rb] as number)) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    size[ra] = (size[ra] as number) + (size[rb] as number);
    return [rb, ra];
  };
  const unmerge = ([child, root]: [number, number]): void => {
    parent[child] = child;
    size[root] = (size[root] as number) - (size[child] as number);
  };
  /** Scratch partition for the reachability bound, refilled from `parent` at each node. */
  const reach = new Int32Array(n);

  /**
   * A feasible assignment found greedily (each station takes whatever completes the most value right
   * now), used ONLY as a pruning floor. Its net is achievable, so the true optimum is at least as
   * high, so a branch that cannot even reach it cannot hold the winner either — which is what makes
   * this safe despite it never being recorded as a candidate. Without it the bound below has nothing
   * to bite on until the search stumbles onto a good assignment by itself.
   */
  const greedyNet = ((): number => {
    let net = net0;
    // Tickets the own network already joins (same component id, nothing merged yet) are banked up
    // front, so no station wastes its pick on a gain it was going to get anyway.
    let pending: number[] = [];
    goals.forEach((g, i) => {
      if (g.a === g.b) net += g.gain;
      else pending.push(i);
    });
    for (const si of active) {
      if (pending.length === 0) break;
      let bestGain = 0;
      let bestOpt: Option | null = null;
      for (const opt of options[si] as Option[]) {
        const undo = merge(opt.u, opt.v);
        if (!undo) continue;
        let gain = 0;
        for (const gi of pending) {
          const g = goals[gi] as { a: number; b: number; gain: number };
          if (find(g.a) === find(g.b)) gain += g.gain;
        }
        unmerge(undo);
        if (gain > bestGain) {
          bestGain = gain;
          bestOpt = opt;
        }
      }
      if (!bestOpt) continue;
      merge(bestOpt.u, bestOpt.v);
      net += bestGain;
      pending = pending.filter((gi) => {
        const g = goals[gi] as { a: number; b: number };
        return find(g.a) !== find(g.b);
      });
    }
    for (let i = 0; i < n; i++) {
      parent[i] = i;
      size[i] = 1;
    }
    return net;
  })();

  // ── branch & bound ────────────────────────────────────────────────────────────────────────
  const assign: (Edge | null)[] = new Array(stationCities.length).fill(null);
  let best: TicketEvaluation = { net: -Infinity, completed: -1, borrows: [] };
  let bestBorrows = Infinity;
  /** Highest net known to be achievable — the greedy assignment, then any better candidate. */
  let floor = greedyNet;
  let steps = 0;

  const consider = (net: number, completed: number, borrowCount: number): void => {
    const better =
      net > best.net ||
      (net === best.net && completed > best.completed) ||
      (net === best.net && completed === best.completed && borrowCount < bestBorrows);
    if (better) {
      best = { net, completed, borrows: assign.slice() };
      bestBorrows = borrowCount;
      if (net > floor) floor = net;
    }
  };

  const dfs = (
    idx: number,
    netIn: number,
    completedIn: number,
    pendingIn: readonly number[],
    borrowCount: number,
  ): void => {
    // Fold in whatever the last merge just connected (connectivity only ever grows).
    let net = netIn;
    let completed = completedIn;
    const pending: number[] = [];
    for (const gi of pendingIn) {
      const g = goals[gi] as { a: number; b: number; gain: number };
      if (find(g.a) === find(g.b)) {
        net += g.gain;
        completed++;
      } else {
        pending.push(gi);
      }
    }
    consider(net, completed, borrowCount);
    // Nothing left to connect: every descendant ties this net/completed with MORE borrows.
    if (pending.length === 0) return;
    if (idx === active.length) return;
    if (steps++ > stepBudget) return;

    // Which pending tickets are still *reachable*: union EVERY option of every station still to come
    // (ignoring the one-borrow-each limit) and see whose endpoints could still meet. A descendant can
    // only ever add a subset of those edges, so an unreachable ticket is dead for good and its value
    // drops out of the branch's ceiling. Below the achievable `floor` the branch cannot hold the
    // winner — whose net IS the optimum, and the optimum is ≥ floor — whatever the tiebreaks say.
    for (let i = 0; i < n; i++) reach[i] = find(i);
    const reachFind = (x: number): number => {
      let r = x;
      while (reach[r] !== r) r = reach[r] as number;
      return r;
    };
    for (let k = idx; k < active.length; k++)
      for (const opt of options[active[k] as number] as Option[]) {
        const ra = reachFind(opt.u);
        const rb = reachFind(opt.v);
        if (ra !== rb) reach[rb] = ra;
      }
    const live: number[] = [];
    let bound = net;
    for (const gi of pending) {
      const g = goals[gi] as { a: number; b: number; gain: number };
      if (reachFind(g.a) === reachFind(g.b)) {
        live.push(gi);
        bound += g.gain;
      }
    }
    if (live.length === 0) return; // as good as this branch gets; descendants only add borrows
    if (bound < floor) return;

    const si = active[idx] as number;
    // "Borrow nothing" first, so the canonical winner among equal-scoring assignments is the one
    // with the earliest options — the same one the old product enumeration reported.
    dfs(idx + 1, net, completed, live, borrowCount);
    for (const opt of options[si] as Option[]) {
      const undo = merge(opt.u, opt.v);
      if (!undo) continue; // already merged by an earlier station: dominated by borrowing nothing
      assign[si] = opt.edge;
      dfs(idx + 1, net, completed, live, borrowCount + 1);
      assign[si] = null;
      unmerge(undo);
    }
  };

  dfs(
    0,
    net0,
    0,
    goals.map((_, i) => i),
    0,
  );

  // Unreachable (the root node always `consider`s the borrow-nothing assignment), but keeps the
  // "no tickets ⇒ 0/0" contract explicit.
  if (best.completed < 0) best = { net: 0, completed: 0, borrows: assign.slice() };
  return best;
}
