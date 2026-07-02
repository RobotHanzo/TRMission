import { ROUTE_LENGTHS, TRAIN_COLORS, DEFAULT_RULE_PARAMS } from '@trm/shared';
import type { RouteColor, RuleParams } from '@trm/shared';
import type { GameContent, RouteDef, MapGeography, MapRules } from './types';
import { isFerry, MAP_RULE_KEYS } from './types';

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

const MAX_GEOGRAPHY_RINGS = 400;
const MAX_GEOGRAPHY_VERTICES = 15000;
const GEOGRAPHY_COORD_MIN = -50;
const GEOGRAPHY_COORD_MAX = 150;

/** Validate a custom map's presentation cartography (bounds a builder draft can't exceed). */
export function validateGeography(geo: MapGeography): string[] {
  const errors: string[] = [];
  const { baseView, land, crop } = geo;

  if (
    !Number.isFinite(baseView.x) ||
    !Number.isFinite(baseView.y) ||
    !(baseView.w > 0) ||
    !(baseView.h > 0)
  ) {
    errors.push('baseView must have finite x/y and positive width/height');
  }

  if (land.length > MAX_GEOGRAPHY_RINGS) {
    errors.push(`too many land rings: ${land.length} exceeds the maximum of ${MAX_GEOGRAPHY_RINGS}`);
  }

  let totalVertices = 0;
  land.forEach((ring, i) => {
    totalVertices += ring.length;
    if (ring.length < 3) {
      errors.push(`land ring ${i} has fewer than 3 vertices`);
      return;
    }
    for (const [x, y] of ring) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        errors.push(`land ring ${i} has a non-finite coordinate`);
        break;
      }
      if (
        x < GEOGRAPHY_COORD_MIN ||
        x > GEOGRAPHY_COORD_MAX ||
        y < GEOGRAPHY_COORD_MIN ||
        y > GEOGRAPHY_COORD_MAX
      ) {
        errors.push(`land ring ${i} has a coordinate outside the allowed board range`);
        break;
      }
    }
  });

  if (totalVertices > MAX_GEOGRAPHY_VERTICES) {
    errors.push(`total land vertices ${totalVertices} exceeds the maximum of ${MAX_GEOGRAPHY_VERTICES}`);
  }

  if (crop.lonMin >= crop.lonMax || crop.latMin >= crop.latMax) {
    errors.push('crop bbox must have lonMin < lonMax and latMin < latMax');
  }

  return errors;
}

export interface RuleBound {
  readonly min: number;
  readonly max: number;
}

/** Builder-form / server-schema bounds for the curated map rule keys, one source of truth. */
export const RULE_BOUNDS: Readonly<Record<(typeof MAP_RULE_KEYS)[number], RuleBound>> = {
  trainCarsStart: { min: 15, max: 90 },
  stationsPerPlayer: { min: 0, max: 5 },
  longestPathBonus: { min: 0, max: 30 },
  stationBonus: { min: 0, max: 10 },
  initialLongOffer: { min: 0, max: 2 },
  initialShortOffer: { min: 1, max: 4 },
  ticketDrawCount: { min: 1, max: 5 },
};

export interface PlayValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validate that content + rules can actually be played (deck sufficiency, rule bounds), on top
 * of validateContent's structural checks. `rulesOverride` wins over `content.rules`, which wins
 * over the engine defaults — the same precedence the room/start seam applies.
 */
export function validateForPlay(
  content: GameContent,
  rulesOverride: MapRules = {},
  maxPlayers = 5,
): PlayValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rules: MapRules = { ...content.rules, ...rulesOverride };

  for (const key of MAP_RULE_KEYS) {
    const value = rules[key];
    if (value === undefined) continue;
    const bound = RULE_BOUNDS[key];
    if (value < bound.min || value > bound.max) {
      errors.push(`${key}: ${value} is outside the allowed range [${bound.min}, ${bound.max}]`);
    }
  }

  const resolved = <K extends (typeof MAP_RULE_KEYS)[number]>(key: K): RuleParams[K] =>
    rules[key] ?? DEFAULT_RULE_PARAMS[key];

  const initialLongOffer = resolved('initialLongOffer');
  const initialShortOffer = resolved('initialShortOffer');
  const ticketDrawCount = resolved('ticketDrawCount');
  const trainCarsStart = resolved('trainCarsStart');
  const { minKeepInitial } = DEFAULT_RULE_PARAMS;

  if (initialLongOffer + initialShortOffer < minKeepInitial) {
    errors.push(
      `initial ticket offer (${initialLongOffer} LONG + ${initialShortOffer} SHORT) cannot satisfy the minimum keep of ${minKeepInitial}`,
    );
  }

  const longCount = content.tickets.filter((t) => t.deck === 'LONG').length;
  const shortCount = content.tickets.filter((t) => t.deck === 'SHORT').length;
  const neededLong = maxPlayers * initialLongOffer;
  const neededShort = maxPlayers * initialShortOffer + ticketDrawCount;

  if (longCount < neededLong) {
    errors.push(
      `LONG ticket deck has ${longCount} but at least ${neededLong} are needed for ${maxPlayers} players`,
    );
  }
  if (shortCount < neededShort) {
    errors.push(
      `SHORT ticket deck has ${shortCount} but at least ${neededShort} are needed for ${maxPlayers} players`,
    );
  }

  const totalTrackLength = content.routes.reduce((sum, r) => sum + r.length, 0);
  if (totalTrackLength < trainCarsStart) {
    warnings.push(
      `total track length (${totalTrackLength}) is less than trainCarsStart (${trainCarsStart}) — trains may never run out`,
    );
  }

  return { errors, warnings };
}
