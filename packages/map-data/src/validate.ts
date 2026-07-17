import { ROUTE_LENGTHS, TRAIN_COLORS, DEFAULT_RULE_PARAMS } from '@trm/shared';
import type { RouteColor, RuleParams } from '@trm/shared';
import type { GameContent, RouteDef, MapGeography, MapRules, TicketView } from './types';
import { isFerry, MAP_RULE_KEYS } from './types';
import { BOW_LIMIT } from './geometry';

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

/**
 * A locale-agnostic validation finding: a stable `code` plus the values needed to render it,
 * for a client to translate (see apps/web's ValidationPanel). `formatIssue` below is the
 * canonical English rendering — every other consumer of the `string[]` APIs (the server's
 * `BadRequestException` message, this package's own tests) goes through it, so the wording
 * here IS the wording everywhere else; keep them in sync by construction, not by hand.
 */
export interface ValidationIssue {
  code: string;
  params: Record<string, string | number>;
}

export function formatIssue(issue: ValidationIssue): string {
  const p = issue.params;
  switch (issue.code) {
    case 'duplicateCityId':
      return 'duplicate city id(s) present';
    case 'duplicateRouteId':
      return `duplicate route id ${p.routeId}`;
    case 'unknownCityA':
      return `${p.routeId}: unknown city A ${p.cityId}`;
    case 'unknownCityB':
      return `${p.routeId}: unknown city B ${p.cityId}`;
    case 'selfLoop':
      return `${p.routeId}: self-loop`;
    case 'invalidLength':
      return `${p.routeId}: invalid length ${p.length} (only 1,2,3,4,6,8 allowed)`;
    case 'ferryMustBeGray':
      return `${p.routeId}: ferry must be GRAY, got ${p.color}`;
    case 'ferryLocosExceedLength':
      return `${p.routeId}: ferryLocos ${p.ferryLocos} exceeds length ${p.length}`;
    case 'ferryAndTunnel':
      return `${p.routeId}: route cannot be both ferry and tunnel`;
    case 'bowOutOfRange':
      return `${p.routeId}: bow ${p.bow} is outside the allowed range [-${p.limit}, ${p.limit}]`;
    case 'brokenCarriagesInvalid':
      return `${p.routeId}: brokenCarriages ${p.brokenCarriages} must be one of 1,2,3,4,6,8`;
    case 'brokenCarriagesExceedLength':
      return `${p.routeId}: brokenCarriages ${p.brokenCarriages} exceeds length ${p.length}`;
    case 'doubleGroupInvalidSize':
      return `parallel group ${p.group}: expected 2 or 3 routes, got ${p.count}`;
    case 'tooManyParallelRoutes':
      return `city pair ${p.pair}: ${p.count} parallel routes exceeds the maximum of 3`;
    case 'multipleGroupsOnPair':
      return `city pair ${p.pair}: has more than one parallel group (${p.groups})`;
    case 'doubleGroupDifferentPairs':
      return `double group ${p.group}: the two routes connect different city pairs`;
    case 'doubleGroupLengthMismatch':
      return `double group ${p.group}: parallel routes must have equal length`;
    case 'ticketUnknownCityA':
      return `ticket ${p.ticketId}: unknown city A ${p.cityId}`;
    case 'ticketUnknownCityB':
      return `ticket ${p.ticketId}: unknown city B ${p.cityId}`;
    case 'ticketEndpointsIdentical':
      return `ticket ${p.ticketId}: endpoints identical`;
    case 'ticketValueNotPositive':
      return `ticket ${p.ticketId}: value must be positive`;
    case 'duplicateAuspiciousPairId':
      return `duplicate auspicious pair id ${p.pairId}`;
    case 'auspiciousPairUnknownCityA':
      return `auspicious pair ${p.pairId}: unknown city A ${p.cityId}`;
    case 'auspiciousPairUnknownCityB':
      return `auspicious pair ${p.pairId}: unknown city B ${p.cityId}`;
    case 'auspiciousPairEndpointsIdentical':
      return `auspicious pair ${p.pairId}: endpoints identical`;
    case 'graphNotConnected':
      return `graph is not connected: ${p.components} components`;
    case 'ticketViewInvalidMode':
      return `${p.where}: unknown display-area mode ${p.mode}`;
    case 'ticketViewLevelOutOfRange':
      return `${p.where}: zoom level ${p.level} is outside the allowed range [0, 1]`;
    case 'baseViewInvalid':
      return 'baseView must have finite x/y and positive width/height';
    case 'tooManyLandRings':
      return `too many land rings: ${p.count} exceeds the maximum of ${p.max}`;
    case 'landRingTooFewVertices':
      return `land ring ${p.index} has fewer than 3 vertices`;
    case 'landRingNonFiniteCoordinate':
      return `land ring ${p.index} has a non-finite coordinate`;
    case 'landRingCoordinateOutOfRange':
      return `land ring ${p.index} has a coordinate outside the allowed board range`;
    case 'tooManyVertices':
      return `total land vertices ${p.count} exceeds the maximum of ${p.max}`;
    case 'tooManyBorderRings':
      return `too many border rings: ${p.count} exceeds the maximum of ${p.max}`;
    case 'borderRingTooFewVertices':
      return `border ring ${p.index} has fewer than 3 vertices`;
    case 'borderRingNonFiniteCoordinate':
      return `border ring ${p.index} has a non-finite coordinate`;
    case 'borderRingCoordinateOutOfRange':
      return `border ring ${p.index} has a coordinate outside the allowed board range`;
    case 'tooManyBorderVertices':
      return `total border vertices ${p.count} exceeds the maximum of ${p.max}`;
    case 'cropBboxInvalid':
      return 'crop bbox must have lonMin < lonMax and latMin < latMax';
    case 'ruleOutOfRange':
      return `${p.key}: ${p.value} is outside the allowed range [${p.min}, ${p.max}]`;
    case 'initialOfferBelowMinKeep':
      return `initial ticket offer (${p.long} LONG + ${p.short} SHORT) cannot satisfy the minimum keep of ${p.minKeep}`;
    case 'longDeckTooSmall':
      return `LONG ticket deck has ${p.count} but at least ${p.needed} are needed for ${p.maxPlayers} players`;
    case 'shortDeckTooSmall':
      return `SHORT ticket deck has ${p.count} but at least ${p.needed} are needed for ${p.maxPlayers} players`;
    case 'trackTooShort':
      return `total track length (${p.total}) is less than trainCarsStart (${p.trainCarsStart}) — trains may never run out`;
    default:
      return issue.code;
  }
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  issues: ValidationIssue[];
  stats: ContentStats;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Structural check for a {@link TicketView} — a known `mode`, and for `zoom` a finite `level` in
 * [0,1]. `where` labels the offending object (a ticket id, or a token for the map default) so the
 * issue renders usefully. Accepts possibly-malformed authored data, hence the runtime mode check.
 */
export function ticketViewIssues(view: TicketView, where: string): ValidationIssue[] {
  const mode = (view as { mode?: unknown }).mode;
  if (mode !== 'full' && mode !== 'auto' && mode !== 'zoom') {
    return [{ code: 'ticketViewInvalidMode', params: { where, mode: String(mode) } }];
  }
  if (mode === 'zoom') {
    const level = (view as { level?: unknown }).level;
    if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1) {
      return [{ code: 'ticketViewLevelOutOfRange', params: { where, level: Number(level) } }];
    }
  }
  return [];
}

/** Validate authored content against every structural game invariant; also compute stats. */
export function validateContent(content: GameContent): ValidationResult {
  const issues: ValidationIssue[] = [];
  const push = (code: string, params: Record<string, string | number> = {}): void => {
    issues.push({ code, params });
  };
  const { cities, routes, tickets } = content;

  const cityIds = new Set(cities.map((c) => c.id as string));
  if (cityIds.size !== cities.length) push('duplicateCityId');

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
    if (routeIds.has(rid)) push('duplicateRouteId', { routeId: rid });
    routeIds.add(rid);

    if (!cityIds.has(r.a as string)) push('unknownCityA', { routeId: rid, cityId: r.a as string });
    if (!cityIds.has(r.b as string)) push('unknownCityB', { routeId: rid, cityId: r.b as string });
    if ((r.a as string) === (r.b as string)) push('selfLoop', { routeId: rid });

    if (!(ROUTE_LENGTHS as readonly number[]).includes(r.length)) {
      push('invalidLength', { routeId: rid, length: r.length });
    }

    if (isFerry(r)) {
      if (r.color !== 'GRAY') push('ferryMustBeGray', { routeId: rid, color: r.color });
      if (r.ferryLocos > r.length) {
        push('ferryLocosExceedLength', {
          routeId: rid,
          ferryLocos: r.ferryLocos,
          length: r.length,
        });
      }
      if (r.isTunnel) push('ferryAndTunnel', { routeId: rid });
      ferryCount++;
      ferryLocoSymbols += r.ferryLocos;
    }
    if (r.isTunnel) tunnelCount++;

    if (r.bow !== undefined && (!Number.isFinite(r.bow) || Math.abs(r.bow) > BOW_LIMIT)) {
      push('bowOutOfRange', { routeId: rid, bow: r.bow, limit: BOW_LIMIT });
    }

    if (r.brokenCarriages !== undefined && r.brokenCarriages !== 0) {
      // Must be a scorable route length — repair points come from the routePoints table.
      if (!(ROUTE_LENGTHS as readonly number[]).includes(r.brokenCarriages)) {
        push('brokenCarriagesInvalid', { routeId: rid, brokenCarriages: r.brokenCarriages });
      } else if (r.brokenCarriages > r.length) {
        push('brokenCarriagesExceedLength', {
          routeId: rid,
          brokenCarriages: r.brokenCarriages,
          length: r.length,
        });
      }
    }

    colorBalance[r.color] = (colorBalance[r.color] ?? 0) + 1;
    totalTrackLength += r.length;
    distinctPairs.add(pairKey(r.a as string, r.b as string));

    if (r.doubleGroup) {
      const g = doubleGroups.get(r.doubleGroup) ?? [];
      g.push(r);
      doubleGroups.set(r.doubleGroup, g);
    }
  }

  // --- parallel-route groups (2 or 3 members between one city pair) ---
  for (const [group, members] of doubleGroups) {
    if (members.length < 2 || members.length > 3) {
      push('doubleGroupInvalidSize', { group, count: members.length });
      continue;
    }
    const first = members[0] as RouteDef;
    const firstPair = pairKey(first.a as string, first.b as string);
    if (members.some((m) => pairKey(m.a as string, m.b as string) !== firstPair)) {
      push('doubleGroupDifferentPairs', { group });
    }
    if (members.some((m) => m.length !== first.length)) {
      push('doubleGroupLengthMismatch', { group });
    }
  }

  // --- per-pair parallelism cap: at most 3 routes and at most 1 group per city pair ---
  const routesByPair = new Map<string, RouteDef[]>();
  for (const r of routes) {
    const k = pairKey(r.a as string, r.b as string);
    const arr = routesByPair.get(k) ?? [];
    arr.push(r);
    routesByPair.set(k, arr);
  }
  for (const [pair, rs] of routesByPair) {
    if (rs.length > 3) push('tooManyParallelRoutes', { pair, count: rs.length });
    const groups = new Set(rs.map((r) => r.doubleGroup).filter(Boolean));
    if (groups.size > 1) push('multipleGroupsOnPair', { pair, groups: [...groups].join(',') });
  }

  // --- tickets ---
  for (const t of tickets) {
    const tid = t.id as string;
    if (!cityIds.has(t.a as string))
      push('ticketUnknownCityA', { ticketId: tid, cityId: t.a as string });
    if (!cityIds.has(t.b as string))
      push('ticketUnknownCityB', { ticketId: tid, cityId: t.b as string });
    if ((t.a as string) === (t.b as string)) push('ticketEndpointsIdentical', { ticketId: tid });
    if (t.value <= 0) push('ticketValueNotPositive', { ticketId: tid });
    if (t.view) for (const issue of ticketViewIssues(t.view, tid)) issues.push(issue);
  }

  // --- authored Lucky Ticket Stub targets ---
  const auspiciousIds = new Set<string>();
  for (const pair of content.auspiciousPairs ?? []) {
    if (auspiciousIds.has(pair.id)) push('duplicateAuspiciousPairId', { pairId: pair.id });
    auspiciousIds.add(pair.id);
    if (!cityIds.has(pair.a as string))
      push('auspiciousPairUnknownCityA', { pairId: pair.id, cityId: pair.a as string });
    if (!cityIds.has(pair.b as string))
      push('auspiciousPairUnknownCityB', { pairId: pair.id, cityId: pair.b as string });
    if (pair.a === pair.b) push('auspiciousPairEndpointsIdentical', { pairId: pair.id });
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
    if (cityIds.has(r.a as string) && cityIds.has(r.b as string))
      union(r.a as string, r.b as string);
  }
  const roots = new Set<string>();
  for (const id of cityIds) roots.add(find(id));
  if (roots.size !== 1) {
    push('graphNotConnected', { components: roots.size });
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

  return { ok: issues.length === 0, errors: issues.map(formatIssue), issues, stats };
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

/** Structured variant of {@link validateGeography} — see {@link ValidationIssue}. */
export function validateGeographyIssues(geo: MapGeography): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, params: Record<string, string | number> = {}): void => {
    issues.push({ code, params });
  };
  const { baseView, land, crop } = geo;

  if (
    !Number.isFinite(baseView.x) ||
    !Number.isFinite(baseView.y) ||
    !(baseView.w > 0) ||
    !(baseView.h > 0)
  ) {
    push('baseViewInvalid');
  }

  if (land.length > MAX_GEOGRAPHY_RINGS) {
    push('tooManyLandRings', { count: land.length, max: MAX_GEOGRAPHY_RINGS });
  }

  let totalVertices = 0;
  land.forEach((ring, i) => {
    totalVertices += ring.length;
    if (ring.length < 3) {
      push('landRingTooFewVertices', { index: i });
      return;
    }
    for (const [x, y] of ring) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        push('landRingNonFiniteCoordinate', { index: i });
        break;
      }
      if (
        x < GEOGRAPHY_COORD_MIN ||
        x > GEOGRAPHY_COORD_MAX ||
        y < GEOGRAPHY_COORD_MIN ||
        y > GEOGRAPHY_COORD_MAX
      ) {
        push('landRingCoordinateOutOfRange', { index: i });
        break;
      }
    }
  });

  if (totalVertices > MAX_GEOGRAPHY_VERTICES) {
    push('tooManyVertices', { count: totalVertices, max: MAX_GEOGRAPHY_VERTICES });
  }

  if (crop.lonMin >= crop.lonMax || crop.latMin >= crop.latMax) {
    push('cropBboxInvalid');
  }

  if (geo.defaultTicketView) {
    for (const issue of ticketViewIssues(geo.defaultTicketView, 'defaultTicketView'))
      push(issue.code, issue.params);
  }

  if (geo.borders) {
    if (geo.borders.length > MAX_GEOGRAPHY_RINGS) {
      push('tooManyBorderRings', { count: geo.borders.length, max: MAX_GEOGRAPHY_RINGS });
    }
    let borderVertices = 0;
    geo.borders.forEach((ring, i) => {
      borderVertices += ring.length;
      if (ring.length < 3) {
        push('borderRingTooFewVertices', { index: i });
        return;
      }
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          push('borderRingNonFiniteCoordinate', { index: i });
          break;
        }
        if (
          x < GEOGRAPHY_COORD_MIN ||
          x > GEOGRAPHY_COORD_MAX ||
          y < GEOGRAPHY_COORD_MIN ||
          y > GEOGRAPHY_COORD_MAX
        ) {
          push('borderRingCoordinateOutOfRange', { index: i });
          break;
        }
      }
    });
    if (borderVertices > MAX_GEOGRAPHY_VERTICES) {
      push('tooManyBorderVertices', { count: borderVertices, max: MAX_GEOGRAPHY_VERTICES });
    }
  }

  return issues;
}

/** Validate a custom map's presentation cartography (bounds a builder draft can't exceed). */
export function validateGeography(geo: MapGeography): string[] {
  return validateGeographyIssues(geo).map(formatIssue);
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

export interface PlayValidationIssues {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Structured variant of {@link validateForPlay} — see {@link ValidationIssue}. Validates that
 * content + rules can actually be played (deck sufficiency, rule bounds), on top of
 * validateContent's structural checks. `rulesOverride` wins over `content.rules`, which wins
 * over the engine defaults — the same precedence the room/start seam applies.
 */
export function validateForPlayIssues(
  content: GameContent,
  rulesOverride: MapRules = {},
  maxPlayers = 5,
): PlayValidationIssues {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const rules: MapRules = { ...content.rules, ...rulesOverride };

  for (const key of MAP_RULE_KEYS) {
    const value = rules[key];
    if (value === undefined) continue;
    const bound = RULE_BOUNDS[key];
    if (value < bound.min || value > bound.max) {
      errors.push({
        code: 'ruleOutOfRange',
        params: { key, value, min: bound.min, max: bound.max },
      });
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
    errors.push({
      code: 'initialOfferBelowMinKeep',
      params: { long: initialLongOffer, short: initialShortOffer, minKeep: minKeepInitial },
    });
  }

  const longCount = content.tickets.filter((t) => t.deck === 'LONG').length;
  const shortCount = content.tickets.filter((t) => t.deck === 'SHORT').length;
  const neededLong = maxPlayers * initialLongOffer;
  const neededShort = maxPlayers * initialShortOffer + ticketDrawCount;

  if (longCount < neededLong) {
    errors.push({
      code: 'longDeckTooSmall',
      params: { count: longCount, needed: neededLong, maxPlayers },
    });
  }
  if (shortCount < neededShort) {
    errors.push({
      code: 'shortDeckTooSmall',
      params: { count: shortCount, needed: neededShort, maxPlayers },
    });
  }

  const totalTrackLength = content.routes.reduce((sum, r) => sum + r.length, 0);
  if (totalTrackLength < trainCarsStart) {
    warnings.push({ code: 'trackTooShort', params: { total: totalTrackLength, trainCarsStart } });
  }

  return { errors, warnings };
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
  const { errors, warnings } = validateForPlayIssues(content, rulesOverride, maxPlayers);
  return { errors: errors.map(formatIssue), warnings: warnings.map(formatIssue) };
}
