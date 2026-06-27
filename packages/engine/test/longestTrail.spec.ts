import { describe, it, expect } from 'vitest';
import { makeRng, nextInt } from '@trm/shared';
import { longestTrail } from '../src/graph/longestTrail';
import type { TrailEdge } from '../src/graph/longestTrail';

/** Independent reference: exhaustive BFS over (vertex, used-edge bitmask) states. */
function longestTrailDP(edges: readonly TrailEdge[]): number {
  const n = edges.length;
  if (n === 0) return 0;
  const adj = new Map<string, number[]>();
  const verts = new Set<string>();
  edges.forEach((e, i) => {
    verts.add(e.u);
    verts.add(e.v);
    (adj.get(e.u) ?? adj.set(e.u, []).get(e.u)!).push(i);
    (adj.get(e.v) ?? adj.set(e.v, []).get(e.v)!).push(i);
  });
  const wsum = (mask: number): number => {
    let s = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) s += edges[i]!.w;
    return s;
  };
  let best = 0;
  const seen = new Set<string>();
  const stack: Array<{ v: string; mask: number }> = [];
  for (const v of verts) stack.push({ v, mask: 0 });
  while (stack.length) {
    const { v, mask } = stack.pop()!;
    const key = `${v}|${mask}`;
    if (seen.has(key)) continue;
    seen.add(key);
    best = Math.max(best, wsum(mask));
    for (const ei of adj.get(v) ?? []) {
      if (mask & (1 << ei)) continue;
      const e = edges[ei]!;
      const to = e.u === v ? e.v : e.u;
      stack.push({ v: to, mask: mask | (1 << ei) });
    }
  }
  return best;
}

describe('longestTrail', () => {
  it('handles trivial cases', () => {
    expect(longestTrail([])).toBe(0);
    expect(longestTrail([{ u: 'a', v: 'b', w: 4 }])).toBe(4);
  });

  it('sums a simple path', () => {
    // a-b (1) - c (2) - d (4): trail = 7
    const edges: TrailEdge[] = [
      { u: 'a', v: 'b', w: 1 },
      { u: 'b', v: 'c', w: 2 },
      { u: 'c', v: 'd', w: 4 },
    ];
    expect(longestTrail(edges)).toBe(7);
  });

  it('takes the max across disconnected components', () => {
    const edges: TrailEdge[] = [
      { u: 'a', v: 'b', w: 2 },
      { u: 'x', v: 'y', w: 3 },
      { u: 'y', v: 'z', w: 4 },
    ];
    expect(longestTrail(edges)).toBe(7); // the x-y-z component
  });

  it('traverses an Euler component using every edge once (triangle)', () => {
    // Triangle a-b-c-a, all even degree → Euler trail uses all 3 edges.
    const edges: TrailEdge[] = [
      { u: 'a', v: 'b', w: 1 },
      { u: 'b', v: 'c', w: 2 },
      { u: 'c', v: 'a', w: 3 },
    ];
    expect(longestTrail(edges)).toBe(6);
  });

  it('handles a figure-eight through a shared junction', () => {
    // Two triangles sharing vertex 'm': all edges form one trail through m.
    const edges: TrailEdge[] = [
      { u: 'm', v: 'a', w: 1 },
      { u: 'a', v: 'b', w: 1 },
      { u: 'b', v: 'm', w: 1 },
      { u: 'm', v: 'c', w: 1 },
      { u: 'c', v: 'd', w: 1 },
      { u: 'd', v: 'm', w: 1 },
    ];
    expect(longestTrail(edges)).toBe(6); // all six edges (Euler trail, m has degree 4)
  });

  it('matches the brute-force DP on random small multigraphs', () => {
    let rng = makeRng('trail-fuzz');
    for (let t = 0; t < 200; t++) {
      const [vCount, r1] = nextInt(rng, 4);
      rng = r1;
      const V = vCount + 2; // 2..5 vertices
      const [eCount, r2] = nextInt(rng, 9);
      rng = r2;
      const E = eCount + 1; // 1..9 edges
      const edges: TrailEdge[] = [];
      for (let i = 0; i < E; i++) {
        const [u, ra] = nextInt(rng, V);
        rng = ra;
        const [vv, rb] = nextInt(rng, V);
        rng = rb;
        const [w, rc] = nextInt(rng, 4);
        rng = rc;
        if (u === vv) continue; // skip self-loops
        edges.push({ u: `v${u}`, v: `v${vv}`, w: w + 1 });
      }
      expect(longestTrail(edges)).toBe(longestTrailDP(edges));
    }
  });
});
