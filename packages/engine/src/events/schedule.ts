import type { RngState, RuleParams, RouteId, CityId, EventsMode } from '@trm/shared';
import { nextInt, shuffle } from '@trm/shared';
import type { Board } from '../board';
import { groupMembersOf } from '../board';
import type { EventsState, EventScheduleEntry, RandomEventKind } from '../types/events-state';

/**
 * Seeded random-event schedule generation (genesis step 8).
 *
 * `generateSchedule` is a PURE function of `(board, ruleParams, rng)`; every random choice threads
 * the counter PRNG explicitly, so a game replays byte-identically. When `eventsMode` is `'off'` (or
 * absent, for pre-v5 recovery) it consumes ZERO draws and returns `[undefined, rng]` untouched —
 * this is what keeps an off-mode genesis identical to a pre-feature game.
 *
 * The schedule keeps generating entries for the whole `SCHEDULE_ROUND_CAP`-round span (well beyond
 * any realistic game length — greedy-policy playtests top out around 70-75 rounds), not just a
 * fixed handful near the start: a hard per-mode entry count previously stopped the schedule dead
 * around round ~15-20, leaving the back half of every real game with zero events. Intensity now
 * controls *frequency* (via `gapSpan`, the width of the random gap added between events) rather than
 * a total-for-the-game budget: light spaces events out, intense packs them tighter, and all three
 * keep firing for as long as the game runs.
 *
 * Draw order (ON mode), consumed strictly in this sequence so replays are deterministic:
 *   1. First startRound — one draw (firstStartBase + nextInt(gapSpan), floored at round 2).
 *   2. Per slot, in order, while startRound <= SCHEDULE_ROUND_CAP:
 *      a. Category      — one weighted draw over positive/mixed/restrictive weights.
 *                         (If the picked category has no placeable kind, it is dropped and a fresh
 *                          weighted draw is taken over the remaining categories; if none remain,
 *                          generation stops. On any real board every category always has a
 *                          target-less kind, so this fallback consumes no extra draws in practice.)
 *      b. Kind          — one draw over the category's kinds that have a valid target on this board.
 *      c. Targets       — kind-specific draws (see below).
 *      d. Duration      — fixed table, NO draw.
 *      e. Next start    — one draw: current + occupancy + 1 + nextInt(gapSpan).
 */
export function generateSchedule(
  board: Board,
  ruleParams: RuleParams,
  rng: RngState,
): [EventsState | undefined, RngState] {
  const mode = ruleParams.eventsMode as EventsMode | undefined;
  if (mode === undefined || mode === 'off') return [undefined, rng];

  const tuning = MODE_TUNING[mode];

  // ── Precomputed, deterministic board facts (no draws) ──
  const sortedCityIds = [...board.cityIds].sort(cmpStr);
  const sortedRouteIds = board.content.routes.map((r) => r.id).sort((a, b) => cmpStr(a, b));
  const regionTouching = buildRegionTouching(board); // region → sorted touching route ids
  const allRegions = [...regionTouching.keys()].sort(cmpStr);
  const eligibleRegions = [...regionTouching.entries()]
    .filter(([, routes]) => routes.length >= 3)
    .map(([region]) => region)
    .sort(cmpStr);
  const allDist = allPairsHops(board); // cityId → (cityId → hop count)
  const processionPaths = fiveCityPaths(board);
  const auspiciousPairs = [...(board.content.auspiciousPairs ?? [])].sort((a, b) =>
    cmpStr(a.id, b.id),
  );

  // Per-schedule mutable target bookkeeping.
  const hotspotPicks: Record<string, number> = {};
  const usedOneShotKinds = new Set<RandomEventKind>();
  const usedLuckyPairIds = new Set<string>();

  // Each authored pair opens at most one lucky race per game — a repeat contract would hand its
  // +5 straight to an already-connected player at the second open.
  const remainingLuckyPairs = () => auspiciousPairs.filter((p) => !usedLuckyPairIds.has(p.id));

  const hasFarPair = (): boolean => {
    for (const a of sortedCityIds) {
      const from = allDist.get(a as string);
      if (!from) continue;
      for (const b of sortedCityIds) {
        if (a === b) continue;
        const d = from.get(b as string);
        if (d !== undefined && d >= CHARTER_MIN_HOPS) return true;
      }
    }
    return false;
  };

  const eligibleHotspotCities = (): CityId[] =>
    sortedCityIds.filter(
      (c) =>
        (board.incident.get(c as string)?.length ?? 0) >= 2 && (hotspotPicks[c as string] ?? 0) < 2,
    );

  const kindHasTarget = (kind: RandomEventKind): boolean => {
    if (ONE_SHOT_KINDS.has(kind) && usedOneShotKinds.has(kind)) return false;
    switch (kind) {
      case 'TYPHOON_LANDFALL':
      case 'SKY_LANTERN':
        return eligibleRegions.length > 0;
      case 'VIRAL_HOTSPOT':
        return eligibleHotspotCities().length > 0;
      case 'CHARTER_SPECIAL':
        return hasFarPair();
      case 'LANTERN_HOST_CITY':
      case 'BENTO_RUSH':
      case 'STATION_FRONT_NIGHT_MARKET':
        return sortedCityIds.length > 0;
      case 'SLOPE_REPAIR_ORDER':
        return sortedRouteIds.length > 0;
      case 'GODDESS_PROCESSION':
        return processionPaths.length > 0;
      case 'HARVEST_FESTIVAL_EXPRESS':
        return allRegions.length > 0;
      case 'LUCKY_TICKET_STUB':
        return remainingLuckyPairs().length > 0;
      default:
        return true; // target-less kinds
    }
  };

  let cur = rng;

  // (1) First start round.
  let startRound: number;
  {
    const [n, next] = nextInt(cur, tuning.gapSpan);
    cur = next;
    // Floor of 2: a round-2 first start has no round-1 tick, so it never gets an EVENT_ANNOUNCED
    // frame — but it's still telegraphed via the snapshot forecast, which redactFor exposes from
    // genesis, so round-2 starts are visible to clients from turn one. Intentional; see the design
    // spec (docs/superpowers/specs/2026-07-04-random-events-design.md).
    startRound = Math.max(2, tuning.firstStartBase + n);
  }

  const entries: EventScheduleEntry[] = [];
  while (startRound <= SCHEDULE_ROUND_CAP) {
    // (2a) Category — weighted, with drop-and-redraw when a category has no placeable kind.
    let available = CATEGORY_ORDER.map((cat) => ({ cat, weight: tuning.weights[cat] }));
    let chosenKind: RandomEventKind | null = null;
    while (available.length > 0) {
      const [cat, next] = pickCategory(available, cur);
      cur = next;
      const valid = CATEGORY_KINDS[cat].filter(kindHasTarget);
      if (valid.length === 0) {
        available = available.filter((a) => a.cat !== cat);
        continue;
      }
      // (2b) Kind.
      const [ki, next2] = nextInt(cur, valid.length);
      cur = next2;
      chosenKind = valid[ki] as RandomEventKind;
      break;
    }
    if (chosenKind === null) break; // no category has any placeable kind — stop generating.
    const kind = chosenKind;

    // (2c) Targets.
    let routeIds: RouteId[] | undefined;
    let region: string | undefined;
    let cityId: CityId | undefined;
    let charter: { a: CityId; b: CityId; points: number } | undefined;
    let cityPath: CityId[] | undefined;
    let pair: { a: CityId; b: CityId } | undefined;
    let markerSelector: number | undefined;

    if (kind === 'TYPHOON_LANDFALL' || kind === 'SKY_LANTERN') {
      const [ri, nextR] = nextInt(cur, eligibleRegions.length);
      cur = nextR;
      region = eligibleRegions[ri] as string;
      const touching = regionTouching.get(region) ?? [];
      // TYPHOON_LANDFALL picks 2 or 3 of the region's touching routes; SKY_LANTERN picks 3 or 4 —
      // both a random subset (shuffled), never the whole touching set.
      const pickBase = kind === 'TYPHOON_LANDFALL' ? 2 : 3;
      const [extra, nextC] = nextInt(cur, 2);
      cur = nextC;
      const pickCount = pickBase + extra;
      const [shuffled, nextS] = shuffle(touching, cur);
      cur = nextS;
      // Double-route siblings must be disrupted together — claiming one half of a pair would
      // otherwise leave the untouched parallel edge open, silently defeating the event.
      routeIds = withGroupSiblings(board, shuffled.slice(0, pickCount));
    } else if (kind === 'VIRAL_HOTSPOT') {
      const cities = eligibleHotspotCities();
      const [ci, nextC] = nextInt(cur, cities.length);
      cur = nextC;
      cityId = cities[ci] as CityId;
      hotspotPicks[cityId as string] = (hotspotPicks[cityId as string] ?? 0) + 1;
    } else if (kind === 'CHARTER_SPECIAL') {
      const [order, nextS] = shuffle(sortedCityIds, cur);
      cur = nextS;
      let picked: { a: CityId; b: CityId } | null = null;
      outer: for (let i = 0; i < order.length; i++) {
        const from = allDist.get(order[i] as string);
        if (!from) continue;
        for (let j = i + 1; j < order.length; j++) {
          const d = from.get(order[j] as string);
          if (d !== undefined && d >= CHARTER_MIN_HOPS) {
            picked = { a: order[i] as CityId, b: order[j] as CityId };
            break outer;
          }
        }
      }
      const [pts, nextP] = nextInt(cur, 5);
      cur = nextP;
      if (picked) charter = { a: picked.a, b: picked.b, points: 6 + pts };
    } else if (
      kind === 'LANTERN_HOST_CITY' ||
      kind === 'BENTO_RUSH' ||
      kind === 'STATION_FRONT_NIGHT_MARKET'
    ) {
      const [ci, nextC] = nextInt(cur, sortedCityIds.length);
      cur = nextC;
      cityId = sortedCityIds[ci] as CityId;
    } else if (kind === 'SLOPE_REPAIR_ORDER') {
      const [ri, nextR] = nextInt(cur, sortedRouteIds.length);
      cur = nextR;
      routeIds = withGroupSiblings(board, [sortedRouteIds[ri] as RouteId]);
    } else if (kind === 'GODDESS_PROCESSION') {
      const [pi, nextP] = nextInt(cur, processionPaths.length);
      cur = nextP;
      cityPath = [...(processionPaths[pi] as readonly CityId[])];
      cityId = cityPath[0];
    } else if (kind === 'HARVEST_FESTIVAL_EXPRESS') {
      const [ri, nextR] = nextInt(cur, allRegions.length);
      cur = nextR;
      region = allRegions[ri] as string;
      routeIds = [...(regionTouching.get(region) ?? [])];
    } else if (kind === 'LUCKY_TICKET_STUB') {
      const candidates = remainingLuckyPairs();
      const [pi, nextP] = nextInt(cur, candidates.length);
      cur = nextP;
      const picked = candidates[pi]!;
      usedLuckyPairIds.add(picked.id);
      pair = { a: picked.a, b: picked.b };
    } else if (kind === 'BREAKTHROUGH_BORING_MACHINE') {
      const [selector, nextM] = nextInt(cur, 0x10000);
      cur = nextM;
      markerSelector = selector;
    }

    if (ONE_SHOT_KINDS.has(kind)) usedOneShotKinds.add(kind);

    const durationRounds = DURATIONS[kind];
    const entry: EventScheduleEntry = {
      id: `ev${entries.length + 1}`,
      kind,
      startRound,
      durationRounds,
      telegraphed: TELEGRAPHED.has(kind),
      ...(routeIds ? { routeIds } : {}),
      ...(region !== undefined ? { region } : {}),
      ...(cityId !== undefined ? { cityId } : {}),
      ...(charter ? { charter } : {}),
      ...(cityPath ? { cityPath } : {}),
      ...(pair ? { pair } : {}),
      ...(markerSelector !== undefined ? { markerSelector } : {}),
    };
    entries.push(entry);

    // (2e) Next start round.
    const occupancy = CATEGORY_OF[kind] === 'positive' ? 1 : durationRounds;
    const [gap, nextG] = nextInt(cur, tuning.gapSpan);
    cur = nextG;
    startRound = startRound + occupancy + 1 + gap;
  }

  const events: EventsState = {
    mode,
    roundIndex: 1,
    nextIdx: 0,
    schedule: entries,
    suppressed: [],
    active: [],
    hotspots: {},
    charters: [],
    luckyContracts: [],
    reopenBonus: [],
    repairedRouteIds: [],
    resources: {},
  };
  return [events, cur];
}

/** Generation stops once a slot's `startRound` would exceed this — generously above any realistic
 * game length (greedy-policy playtests top out around 70-75 rounds; see schedule.ts's doc comment). */
const SCHEDULE_ROUND_CAP = 300;

// ─────────────────────────────────────────────── tables ─────────────────────────────────────────

type Category = 'positive' | 'mixed' | 'restrictive';

/** Canonical category order for the cumulative-weight mapping (must stay stable for determinism). */
const CATEGORY_ORDER: readonly Category[] = ['positive', 'mixed', 'restrictive'];

const CATEGORY_KINDS: Record<Category, readonly RandomEventKind[]> = {
  positive: [
    'VIRAL_HOTSPOT',
    'CHARTER_SPECIAL',
    'RAILWAY_GALA',
    'STAMP_RALLY',
    'LANTERN_HOST_CITY',
    'BENTO_RUSH',
    'STATION_FRONT_NIGHT_MARKET',
    'GODDESS_PROCESSION',
    'ROLLING_STOCK_ALLOCATION_DAY',
    'HIVE_OF_SPARKS',
    'BREAKTHROUGH_BORING_MACHINE',
    'INTERIM_OPERATIONS_REPORT',
    'HARVEST_FESTIVAL_EXPRESS',
    'LUCKY_TICKET_STUB',
  ],
  mixed: ['SKY_LANTERN', 'AFTERSHOCK', 'SPRING_FESTIVAL_RUSH', 'ALL_SEATS_RESERVED'],
  restrictive: ['TYPHOON_LANDFALL', 'TYPHOON_DAY_OFF', 'SLOPE_REPAIR_ORDER'],
};

const CATEGORY_OF: Record<RandomEventKind, Category> = {
  VIRAL_HOTSPOT: 'positive',
  CHARTER_SPECIAL: 'positive',
  RAILWAY_GALA: 'positive',
  STAMP_RALLY: 'positive',
  SKY_LANTERN: 'mixed',
  AFTERSHOCK: 'mixed',
  TYPHOON_LANDFALL: 'restrictive',
  TYPHOON_DAY_OFF: 'restrictive',
  LANTERN_HOST_CITY: 'positive',
  BENTO_RUSH: 'positive',
  SLOPE_REPAIR_ORDER: 'restrictive',
  STATION_FRONT_NIGHT_MARKET: 'positive',
  GODDESS_PROCESSION: 'positive',
  SPRING_FESTIVAL_RUSH: 'mixed',
  ROLLING_STOCK_ALLOCATION_DAY: 'positive',
  HIVE_OF_SPARKS: 'positive',
  BREAKTHROUGH_BORING_MACHINE: 'positive',
  INTERIM_OPERATIONS_REPORT: 'positive',
  HARVEST_FESTIVAL_EXPRESS: 'positive',
  ALL_SEATS_RESERVED: 'mixed',
  LUCKY_TICKET_STUB: 'positive',
};

const DURATIONS: Record<RandomEventKind, number> = {
  TYPHOON_LANDFALL: 2,
  TYPHOON_DAY_OFF: 1,
  SKY_LANTERN: 2,
  AFTERSHOCK: 1,
  RAILWAY_GALA: 1,
  STAMP_RALLY: 3,
  CHARTER_SPECIAL: 4,
  VIRAL_HOTSPOT: 0,
  LANTERN_HOST_CITY: 0,
  BENTO_RUSH: 3,
  SLOPE_REPAIR_ORDER: 3,
  STATION_FRONT_NIGHT_MARKET: 2,
  GODDESS_PROCESSION: 5,
  SPRING_FESTIVAL_RUSH: 2,
  ROLLING_STOCK_ALLOCATION_DAY: 0,
  HIVE_OF_SPARKS: 1,
  BREAKTHROUGH_BORING_MACHINE: 0,
  INTERIM_OPERATIONS_REPORT: 0,
  HARVEST_FESTIVAL_EXPRESS: 3,
  ALL_SEATS_RESERVED: 1,
  LUCKY_TICKET_STUB: 0,
};

const TELEGRAPHED: ReadonlySet<RandomEventKind> = new Set<RandomEventKind>([
  'TYPHOON_LANDFALL',
  'TYPHOON_DAY_OFF',
  'SKY_LANTERN',
  'AFTERSHOCK',
  'SLOPE_REPAIR_ORDER',
  'SPRING_FESTIVAL_RUSH',
  'ALL_SEATS_RESERVED',
]);

const ONE_SHOT_KINDS: ReadonlySet<RandomEventKind> = new Set<RandomEventKind>([
  'LANTERN_HOST_CITY',
  'ROLLING_STOCK_ALLOCATION_DAY',
  'BREAKTHROUGH_BORING_MACHINE',
]);

const CHARTER_MIN_HOPS = 4;

interface ModeTuning {
  readonly firstStartBase: number;
  /** Width of the `nextInt` draw added to each inter-event gap (drawn from [0, gapSpan)) — the
   * frequency knob. A smaller span means a shorter average gap between events, i.e. denser play. */
  readonly gapSpan: number;
  readonly weights: Record<Category, number>;
}

const MODE_TUNING: Record<Exclude<EventsMode, 'off'>, ModeTuning> = {
  light: { firstStartBase: 4, gapSpan: 6, weights: { positive: 3, mixed: 1, restrictive: 1 } },
  moderate: { firstStartBase: 3, gapSpan: 4, weights: { positive: 2, mixed: 2, restrictive: 2 } },
  intense: { firstStartBase: 2, gapSpan: 2, weights: { positive: 2, mixed: 3, restrictive: 3 } },
};

// ────────────────────────────────────────────── helpers ─────────────────────────────────────────

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Pulls in each picked route's double-route siblings so a disruptive event never leaves an
 * untouched parallel edge as an escape hatch. Pure post-process — draws zero extra RNG so the
 * consumption sequence for everything scheduled after stays byte-identical. */
function withGroupSiblings(board: Board, ids: readonly RouteId[]): RouteId[] {
  const out = [...ids];
  const seen = new Set<string>(out.map((id) => id as string));
  for (const id of ids) {
    for (const sib of groupMembersOf(board, id)) {
      if (!seen.has(sib as string)) {
        seen.add(sib as string);
        out.push(sib);
      }
    }
  }
  return out;
}

function pickCategory(
  available: readonly { cat: Category; weight: number }[],
  rng: RngState,
): [Category, RngState] {
  const total = available.reduce((s, a) => s + a.weight, 0);
  const [r, next] = nextInt(rng, total);
  let acc = 0;
  for (const a of available) {
    acc += a.weight;
    if (r < acc) return [a.cat, next];
  }
  return [available[available.length - 1]!.cat, next];
}

/** region string → sorted (by route id) list of route ids that touch it (either endpoint's region). */
function buildRegionTouching(board: Board): Map<string, RouteId[]> {
  const out = new Map<string, RouteId[]>();
  const push = (region: string | undefined, id: RouteId): void => {
    if (region === undefined) return;
    const arr = out.get(region);
    if (arr) arr.push(id);
    else out.set(region, [id]);
  };
  for (const r of board.content.routes) {
    const ra = board.cityById.get(r.a as string)?.region;
    const rb = board.cityById.get(r.b as string)?.region;
    push(ra, r.id);
    if (rb !== ra) push(rb, r.id);
  }
  for (const arr of out.values()) arr.sort((x, y) => cmpStr(x as string, y as string));
  return out;
}

/** All-pairs unweighted hop distances via BFS from each city (reachable pairs only). */
function allPairsHops(board: Board): Map<string, Map<string, number>> {
  const adj = new Map<string, string[]>();
  for (const c of board.cityIds) adj.set(c as string, []);
  for (const r of board.content.routes) {
    adj.get(r.a as string)?.push(r.b as string);
    adj.get(r.b as string)?.push(r.a as string);
  }
  const out = new Map<string, Map<string, number>>();
  for (const source of board.cityIds) {
    const dist = new Map<string, number>();
    dist.set(source as string, 0);
    const queue: string[] = [source as string];
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head] as string;
      const du = dist.get(u) as number;
      for (const v of adj.get(u) ?? []) {
        if (!dist.has(v)) {
          dist.set(v, du + 1);
          queue.push(v);
        }
      }
    }
    out.set(source as string, dist);
  }
  return out;
}

/**
 * Deterministic ceiling on enumerated procession paths. A dense custom map (up to 120 cities /
 * 300 routes) can hold millions of simple 5-city paths — unbounded enumeration would stall
 * genesis on the server. The walk order is canonical (sorted cities, sorted neighbours), so the
 * retained prefix is identical on every run; the official map (~1.2k paths) never hits the cap.
 */
export const PROCESSION_PATH_CAP = 20_000;

/** Every deterministic simple five-city path, canonicalized against its reverse (capped). */
export function fiveCityPaths(board: Board): CityId[][] {
  const adj = new Map<string, string[]>();
  for (const c of board.cityIds) adj.set(c as string, []);
  for (const r of board.content.routes) {
    adj.get(r.a as string)?.push(r.b as string);
    adj.get(r.b as string)?.push(r.a as string);
  }
  for (const neighbors of adj.values()) neighbors.sort(cmpStr);

  const byKey = new Map<string, CityId[]>();
  const walk = (path: string[]): void => {
    if (byKey.size >= PROCESSION_PATH_CAP) return;
    if (path.length === 5) {
      const forward = path.join('|');
      const reverse = [...path].reverse().join('|');
      const key = forward < reverse ? forward : reverse;
      if (!byKey.has(key))
        byKey.set(
          key,
          path.map((c) => c as CityId),
        );
      return;
    }
    const tail = path[path.length - 1] as string;
    for (const next of adj.get(tail) ?? []) {
      if (byKey.size >= PROCESSION_PATH_CAP) return;
      if (!path.includes(next)) walk([...path, next]);
    }
  };
  for (const city of [...board.cityIds].sort(cmpStr)) {
    if (byKey.size >= PROCESSION_PATH_CAP) break;
    walk([city as string]);
  }
  return [...byKey.entries()].sort(([a], [b]) => cmpStr(a, b)).map(([, path]) => path);
}
