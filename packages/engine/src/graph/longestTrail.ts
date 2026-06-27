import { UnionFind } from './unionFind';

export interface TrailEdge {
  readonly u: string;
  readonly v: string;
  readonly w: number;
}

/**
 * Longest *continuous path* bonus = the maximum-weight TRAIL (no edge reused, vertices may
 * repeat) over a single player's claimed edges, weighted by route length. This is the
 * longest-trail problem (NP-hard in general) but trivial at this scale: a player owns at most
 * ~18 edges in a near-planar low-degree subgraph.
 *
 * Algorithm: split into connected components, then per component run a depth-first search over
 * edge instances with a reachable-weight upper-bound prune. Termination is guaranteed because
 * each edge is used at most once per path (finite search tree); a deterministic step budget is
 * a safety net that, if ever hit, returns the best found so far (same input → same result, so
 * replay stays deterministic).
 */
export function longestTrail(edges: readonly TrailEdge[], stepBudget = 5_000_000): number {
  if (edges.length === 0) return 0;

  // Partition edges into connected components.
  const uf = new UnionFind();
  for (const e of edges) uf.union(e.u, e.v);
  const components = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const root = uf.find(e.u);
    const arr = components.get(root) ?? [];
    arr.push(i);
    components.set(root, arr);
  });

  const steps = { n: 0 };
  let globalBest = 0;
  for (const edgeIdx of components.values()) {
    globalBest = Math.max(globalBest, longestInComponent(edges, edgeIdx, steps, stepBudget));
  }
  return globalBest;
}

function longestInComponent(
  allEdges: readonly TrailEdge[],
  edgeIdx: readonly number[],
  steps: { n: number },
  stepBudget: number,
): number {
  // Local, compact representation: vertices → incident (edgeLocalIndex, otherVertex).
  const adj = new Map<string, Array<{ e: number; to: string }>>();
  const weights: number[] = [];
  const vertices = new Set<string>();
  edgeIdx.forEach((gi, local) => {
    const e = allEdges[gi] as TrailEdge;
    weights.push(e.w);
    vertices.add(e.u);
    vertices.add(e.v);
    if (!adj.has(e.u)) adj.set(e.u, []);
    if (!adj.has(e.v)) adj.set(e.v, []);
    adj.get(e.u)!.push({ e: local, to: e.v });
    adj.get(e.v)!.push({ e: local, to: e.u });
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const used = new Array<boolean>(weights.length).fill(false);
  let best = 0;
  let remaining = totalWeight;

  // Deterministic vertex start order.
  const startVerts = [...vertices].sort();

  const dfs = (vertex: string, acc: number): void => {
    if (acc > best) best = acc;
    if (steps.n++ > stepBudget) return;
    // Upper-bound prune: even using every remaining edge can't beat best.
    if (acc + remaining <= best) return;
    const incident = adj.get(vertex);
    if (!incident) return;
    for (const { e, to } of incident) {
      if (used[e]) continue;
      used[e] = true;
      remaining -= weights[e] as number;
      dfs(to, acc + (weights[e] as number));
      used[e] = false;
      remaining += weights[e] as number;
    }
  };

  for (const s of startVerts) {
    dfs(s, 0);
    if (best === totalWeight) break; // can't do better than every edge.
  }
  return best;
}
