import type { CityDef, RouteDef } from './types';

/** Undirected adjacency with edge weight = the minimum route length between each pair —
 *  parallel routes (including double-route siblings) only ever shorten a hop, never lengthen it. */
function buildAdjacency(
  cities: readonly CityDef[],
  routes: readonly RouteDef[],
): Map<string, Map<string, number>> {
  const adj = new Map<string, Map<string, number>>();
  for (const c of cities) adj.set(c.id as string, new Map());
  for (const r of routes) {
    const a = r.a as string;
    const b = r.b as string;
    const na = adj.get(a);
    const nb = adj.get(b);
    if (!na || !nb) continue; // route references a city outside this graph — ignore, not our job to validate
    const prevA = na.get(b);
    if (prevA === undefined || r.length < prevA) na.set(b, r.length);
    const prevB = nb.get(a);
    if (prevB === undefined || r.length < prevB) nb.set(a, r.length);
  }
  return adj;
}

/**
 * All-pairs shortest path distances over the route graph (Dijkstra per source, O(V^2) — the
 * vertex caps on custom maps keep V small enough that a heap isn't worth the complexity).
 * A pair with no path is simply absent from the inner map (not zero, not Infinity).
 */
export function shortestDistances(
  cities: readonly CityDef[],
  routes: readonly RouteDef[],
): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const adj = buildAdjacency(cities, routes);
  const ids = cities.map((c) => c.id as string);
  const result = new Map<string, Map<string, number>>();

  for (const source of ids) {
    const dist = new Map<string, number>([[source, 0]]);
    const visited = new Set<string>();
    for (;;) {
      let u: string | undefined;
      let best = Infinity;
      for (const id of ids) {
        if (visited.has(id)) continue;
        const d = dist.get(id);
        if (d !== undefined && d < best) {
          best = d;
          u = id;
        }
      }
      if (u === undefined) break;
      visited.add(u);
      const neighbors = adj.get(u);
      if (!neighbors) continue;
      for (const [v, w] of neighbors) {
        const nd = best + w;
        const existing = dist.get(v);
        if (existing === undefined || nd < existing) dist.set(v, nd);
      }
    }
    result.set(source, dist);
  }
  return result;
}
