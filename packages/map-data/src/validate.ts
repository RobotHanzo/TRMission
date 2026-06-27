import { ROUTE_LENGTHS, TRAIN_COLORS } from '@trm/shared';
import type { RouteColor } from '@trm/shared';
import type { GameContent, RouteDef } from './types';
import { isFerry } from './types';

export interface ContentStats {
  cityCount: number;
  routeCount: number;
  distinctPairCount: number;
  doublePairCount: number;
  tunnelCount: number;
  ferryCount: number;
  ferryLocoSymbols: number;
  totalTrackLength: number;
  colorBalance: Record<RouteColor, number>;
  ticketCount: number;
  longTicketCount: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  stats: ContentStats;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Validate authored content against every structural game invariant; also compute stats. */
export function validateContent(content: GameContent): ValidationResult {
  const errors: string[] = [];
  const { cities, routes, tickets } = content;

  const cityIds = new Set(cities.map((c) => c.id as string));
  if (cityIds.size !== cities.length) errors.push('duplicate city id(s) present');

  // --- routes ---
  const routeIds = new Set<string>();
  const colorBalance = { GRAY: 0 } as Record<RouteColor, number>;
  for (const tc of TRAIN_COLORS) colorBalance[tc] = 0;

  const doubleGroups = new Map<string, RouteDef[]>();
  let totalTrackLength = 0;
  let tunnelCount = 0;
  let ferryCount = 0;
  let ferryLocoSymbols = 0;
  const distinctPairs = new Set<string>();

  for (const r of routes) {
    const rid = r.id as string;
    if (routeIds.has(rid)) errors.push(`duplicate route id ${rid}`);
    routeIds.add(rid);

    if (!cityIds.has(r.a as string)) errors.push(`${rid}: unknown city A ${r.a}`);
    if (!cityIds.has(r.b as string)) errors.push(`${rid}: unknown city B ${r.b}`);
    if ((r.a as string) === (r.b as string)) errors.push(`${rid}: self-loop`);

    if (!(ROUTE_LENGTHS as readonly number[]).includes(r.length)) {
      errors.push(`${rid}: invalid length ${r.length} (only 1,2,3,4,6,8 allowed)`);
    }

    if (isFerry(r)) {
      if (r.color !== 'GRAY') errors.push(`${rid}: ferry must be GRAY, got ${r.color}`);
      if (r.ferryLocos > r.length) errors.push(`${rid}: ferryLocos ${r.ferryLocos} exceeds length ${r.length}`);
      if (r.isTunnel) errors.push(`${rid}: route cannot be both ferry and tunnel`);
      ferryCount++;
      ferryLocoSymbols += r.ferryLocos;
    }
    if (r.isTunnel) tunnelCount++;

    colorBalance[r.color] = (colorBalance[r.color] ?? 0) + 1;
    totalTrackLength += r.length;
    distinctPairs.add(pairKey(r.a as string, r.b as string));

    if (r.doubleGroup) {
      const g = doubleGroups.get(r.doubleGroup) ?? [];
      g.push(r);
      doubleGroups.set(r.doubleGroup, g);
    }
  }

  // --- double-route pairs ---
  for (const [group, members] of doubleGroups) {
    if (members.length !== 2) {
      errors.push(`double group ${group}: expected exactly 2 routes, got ${members.length}`);
      continue;
    }
    const [m0, m1] = members as [RouteDef, RouteDef];
    if (pairKey(m0.a as string, m0.b as string) !== pairKey(m1.a as string, m1.b as string)) {
      errors.push(`double group ${group}: the two routes connect different city pairs`);
    }
    if (m0.length !== m1.length) {
      errors.push(`double group ${group}: parallel routes must have equal length`);
    }
  }

  // --- tickets ---
  for (const t of tickets) {
    const tid = t.id as string;
    if (!cityIds.has(t.a as string)) errors.push(`ticket ${tid}: unknown city A ${t.a}`);
    if (!cityIds.has(t.b as string)) errors.push(`ticket ${tid}: unknown city B ${t.b}`);
    if ((t.a as string) === (t.b as string)) errors.push(`ticket ${tid}: endpoints identical`);
    if (t.value <= 0) errors.push(`ticket ${tid}: value must be positive`);
  }

  // --- connectivity (union-find over all routes; every city reachable) ---
  const parent = new Map<string, string>();
  for (const id of cityIds) parent.set(id, id);
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    // path compression
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const r of routes) {
    if (cityIds.has(r.a as string) && cityIds.has(r.b as string)) union(r.a as string, r.b as string);
  }
  const roots = new Set<string>();
  for (const id of cityIds) roots.add(find(id));
  if (roots.size !== 1) {
    errors.push(`graph is not connected: ${roots.size} components`);
  }

  const longTicketCount = tickets.filter((t) => t.deck === 'LONG').length;

  const stats: ContentStats = {
    cityCount: cities.length,
    routeCount: routes.length,
    distinctPairCount: distinctPairs.size,
    doublePairCount: doubleGroups.size,
    tunnelCount,
    ferryCount,
    ferryLocoSymbols,
    totalTrackLength,
    colorBalance,
    ticketCount: tickets.length,
    longTicketCount,
  };

  return { ok: errors.length === 0, errors, stats };
}

/** Throwing variant for build-time / seed-time guards. */
export function assertValidContent(content: GameContent): void {
  const { ok, errors } = validateContent(content);
  if (!ok) {
    throw new Error(`Invalid map content:\n - ${errors.join('\n - ')}`);
  }
}
