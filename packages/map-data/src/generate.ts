import { makeRng, nextInt, asCityId, asTicketId } from '@trm/shared';
import type { CityDef, RouteDef, TicketDef } from './types';
import { shortestDistances } from './graph';

export interface GenerateTicketsOptions {
  /** Same seed + same map ⇒ identical output; exposed to the builder UI for reroll. */
  readonly seed: number;
  readonly longCount?: number;
  readonly shortCount?: number;
  readonly shortMinDistance?: number;
}

interface Candidate {
  readonly a: string;
  readonly b: string;
  readonly d: number;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Deterministically author a destination-ticket set from the city graph. LONG tickets are a
 * greedy pick of the longest distinct-pair distances (with a relaxing per-endpoint usage cap
 * for spread); SHORT tickets are a seeded weighted sample over the remaining shorter band,
 * favouring cities not yet used. Throws if the graph isn't fully connected — a partial ticket
 * set silently missing unreachable cities would be worse than a loud failure.
 */
export function generateTickets(
  cities: readonly CityDef[],
  routes: readonly RouteDef[],
  opts: GenerateTicketsOptions,
): TicketDef[] {
  const { seed, longCount = 6, shortCount = 36, shortMinDistance = 4 } = opts;
  const dist = shortestDistances(cities, routes);
  const ids = cities.map((c) => c.id as string);

  for (const id of ids) {
    if ((dist.get(id)?.size ?? 0) !== ids.length) {
      throw new Error('generateTickets requires a fully connected city graph');
    }
  }

  const islandIds = new Set(cities.filter((c) => c.isIsland).map((c) => c.id as string));
  const valueOf = (d: number, a: string, b: string): number =>
    Math.max(2, d + (islandIds.has(a) || islandIds.has(b) ? 1 : 0));

  const candidates: Candidate[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as string;
      const b = ids[j] as string;
      const d = dist.get(a)?.get(b);
      if (d !== undefined && d > 0) candidates.push({ a, b, d });
    }
  }
  candidates.sort((x, y) => y.d - x.d || pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)));

  const usedPairs = new Set<string>();
  const longUsage = new Map<string, number>();
  const longPicks: Candidate[] = [];

  let limit = 1;
  while (longPicks.length < longCount && usedPairs.size < candidates.length) {
    let addedThisRound = false;
    for (const cand of candidates) {
      if (longPicks.length >= longCount) break;
      const key = pairKey(cand.a, cand.b);
      if (usedPairs.has(key)) continue;
      const ua = longUsage.get(cand.a) ?? 0;
      const ub = longUsage.get(cand.b) ?? 0;
      if (ua < limit && ub < limit) {
        longPicks.push(cand);
        usedPairs.add(key);
        longUsage.set(cand.a, ua + 1);
        longUsage.set(cand.b, ub + 1);
        addedThisRound = true;
      }
    }
    if (longPicks.length >= longCount) break;
    if (!addedThisRound) {
      limit++;
      if (limit > ids.length) break;
    }
  }

  const minLongDistance = longPicks.length > 0 ? Math.min(...longPicks.map((p) => p.d)) : Infinity;
  const remaining = candidates.filter(
    (c) => !usedPairs.has(pairKey(c.a, c.b)) && c.d >= shortMinDistance && c.d < minLongDistance,
  );

  let rng = makeRng(seed);
  const shortUsage = new Map<string, number>();
  const shortPicks: Candidate[] = [];

  while (shortPicks.length < shortCount && remaining.length > 0) {
    const weights = remaining.map((c) => {
      const ua = shortUsage.get(c.a) ?? 0;
      const ub = shortUsage.get(c.b) ?? 0;
      return Math.max(1, Math.floor(1000 / (1 + ua + ub)));
    });
    const total = weights.reduce((s, w) => s + w, 0);
    const [draw, nextRng] = nextInt(rng, total);
    rng = nextRng;
    let cum = 0;
    let idx = weights.length - 1;
    for (let k = 0; k < weights.length; k++) {
      cum += weights[k] as number;
      if (draw < cum) {
        idx = k;
        break;
      }
    }
    const picked = remaining[idx] as Candidate;
    remaining.splice(idx, 1);
    shortPicks.push(picked);
    usedPairs.add(pairKey(picked.a, picked.b));
    shortUsage.set(picked.a, (shortUsage.get(picked.a) ?? 0) + 1);
    shortUsage.set(picked.b, (shortUsage.get(picked.b) ?? 0) + 1);
  }

  const tickets: TicketDef[] = [];
  let idx = 0;
  for (const p of longPicks) {
    tickets.push({
      id: asTicketId(`TG${seed}_${idx++}`),
      a: asCityId(p.a),
      b: asCityId(p.b),
      value: valueOf(p.d, p.a, p.b),
      deck: 'LONG',
    });
  }
  for (const p of shortPicks) {
    tickets.push({
      id: asTicketId(`TG${seed}_${idx++}`),
      a: asCityId(p.a),
      b: asCityId(p.b),
      value: valueOf(p.d, p.a, p.b),
      deck: 'SHORT',
    });
  }
  return tickets;
}
