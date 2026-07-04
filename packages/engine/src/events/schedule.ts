import type { RngState, RuleParams, RouteId, CityId, EventsMode } from '@trm/shared';
import { nextInt, shuffle } from '@trm/shared';
import type { Board } from '../board';
import type { EventsState, EventScheduleEntry, RandomEventKind } from '../types/events-state';

/**
 * Seeded random-event schedule generation (genesis step 8).
 *
 * `generateSchedule` is a PURE function of `(board, ruleParams, rng)`; every random choice threads
 * the counter PRNG explicitly, so a game replays byte-identically. When `eventsMode` is `'off'` (or
 * absent, for pre-v5 recovery) it consumes ZERO draws and returns `[undefined, rng]` untouched —
 * this is what keeps an off-mode genesis identical to a pre-feature game.
 *
 * Draw order (ON mode), consumed strictly in this sequence so replays are deterministic:
 *   1. Count            — NO draw (light 2 / moderate 4 / intense 6).
 *   2. First startRound — one draw (light 4+nextInt(2) / moderate 3+nextInt(2) / intense 2+nextInt(2)).
 *   3. Per slot, in order:
 *      a. Category      — one weighted draw over positive/mixed/restrictive weights.
 *                         (If the picked category has no placeable kind, it is dropped and a fresh
 *                          weighted draw is taken over the remaining categories; if none remain,
 *                          generation stops. On any real board every category always has a
 *                          target-less kind, so this fallback consumes no extra draws in practice.)
 *      b. Kind          — one draw over the category's kinds that have a valid target on this board.
 *      c. Targets       — kind-specific draws (see below).
 *      d. Duration      — fixed table, NO draw.
 *      e. Next start    — one draw: current + occupancy + 1 + nextInt(2).
 *   4. Drop entries whose startRound > 20 (a strictly-increasing suffix).
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
  const regionTouching = buildRegionTouching(board); // region → sorted touching route ids
  const eligibleRegions = [...regionTouching.entries()]
    .filter(([, routes]) => routes.length >= 3)
    .map(([region]) => region)
    .sort(cmpStr);
  const allDist = allPairsHops(board); // cityId → (cityId → hop count)

  // Per-schedule mutable target bookkeeping.
  const hotspotPicks: Record<string, number> = {};

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
    switch (kind) {
      case 'TYPHOON_LANDFALL':
      case 'SKY_LANTERN':
        return eligibleRegions.length > 0;
      case 'VIRAL_HOTSPOT':
        return eligibleHotspotCities().length > 0;
      case 'CHARTER_SPECIAL':
        return hasFarPair();
      default:
        return true; // target-less kinds
    }
  };

  let cur = rng;

  // (1)+(2) count and first start round.
  const count = tuning.count;
  let startRound: number;
  {
    const [n, next] = nextInt(cur, 2);
    cur = next;
    startRound = Math.max(2, tuning.firstStartBase + n);
  }

  const entries: EventScheduleEntry[] = [];
  for (let slot = 0; slot < count; slot++) {
    // (3a) Category — weighted, with drop-and-redraw when a category has no placeable kind.
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
      // (3b) Kind.
      const [ki, next2] = nextInt(cur, valid.length);
      cur = next2;
      chosenKind = valid[ki] as RandomEventKind;
      break;
    }
    if (chosenKind === null) break; // no category has any placeable kind — stop generating.
    const kind = chosenKind;

    // (3c) Targets.
    let routeIds: RouteId[] | undefined;
    let region: string | undefined;
    let cityId: CityId | undefined;
    let charter: { a: CityId; b: CityId; points: number } | undefined;

    if (kind === 'TYPHOON_LANDFALL' || kind === 'SKY_LANTERN') {
      const [ri, nextR] = nextInt(cur, eligibleRegions.length);
      cur = nextR;
      region = eligibleRegions[ri] as string;
      const touching = regionTouching.get(region) ?? [];
      if (kind === 'TYPHOON_LANDFALL') {
        const [extra, nextC] = nextInt(cur, 2);
        cur = nextC;
        const pickCount = 2 + extra;
        const [shuffled, nextS] = shuffle(touching, cur);
        cur = nextS;
        routeIds = shuffled.slice(0, pickCount);
      } else {
        routeIds = [...touching]; // SKY_LANTERN: ALL touching routes, no further draw.
      }
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
    }

    const durationRounds = DURATIONS[kind];
    const entry: EventScheduleEntry = {
      id: `ev${slot + 1}`,
      kind,
      startRound,
      durationRounds,
      telegraphed: TELEGRAPHED.has(kind),
      ...(routeIds ? { routeIds } : {}),
      ...(region !== undefined ? { region } : {}),
      ...(cityId !== undefined ? { cityId } : {}),
      ...(charter ? { charter } : {}),
    };
    entries.push(entry);

    // (3e) Next start round.
    const occupancy = CATEGORY_OF[kind] === 'positive' ? 1 : durationRounds;
    const [gap, nextG] = nextInt(cur, 2);
    cur = nextG;
    startRound = startRound + occupancy + 1 + gap;
  }

  // (4) Drop the >20 suffix.
  const schedule = entries.filter((e) => e.startRound <= 20);

  const events: EventsState = {
    mode,
    roundIndex: 1,
    nextIdx: 0,
    schedule,
    suppressed: [],
    active: [],
    hotspots: {},
    charters: [],
    reopenBonus: [],
  };
  return [events, cur];
}

// ─────────────────────────────────────────────── tables ─────────────────────────────────────────

type Category = 'positive' | 'mixed' | 'restrictive';

/** Canonical category order for the cumulative-weight mapping (must stay stable for determinism). */
const CATEGORY_ORDER: readonly Category[] = ['positive', 'mixed', 'restrictive'];

const CATEGORY_KINDS: Record<Category, readonly RandomEventKind[]> = {
  positive: ['VIRAL_HOTSPOT', 'CHARTER_SPECIAL', 'RAILWAY_GALA', 'STAMP_RALLY'],
  mixed: ['SKY_LANTERN', 'AFTERSHOCK'],
  restrictive: ['TYPHOON_LANDFALL', 'TYPHOON_DAY_OFF'],
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
};

const TELEGRAPHED: ReadonlySet<RandomEventKind> = new Set<RandomEventKind>([
  'TYPHOON_LANDFALL',
  'TYPHOON_DAY_OFF',
  'SKY_LANTERN',
  'AFTERSHOCK',
]);

const CHARTER_MIN_HOPS = 4;

interface ModeTuning {
  readonly count: number;
  readonly firstStartBase: number;
  readonly weights: Record<Category, number>;
}

const MODE_TUNING: Record<Exclude<EventsMode, 'off'>, ModeTuning> = {
  light: { count: 2, firstStartBase: 4, weights: { positive: 3, mixed: 1, restrictive: 1 } },
  moderate: { count: 4, firstStartBase: 3, weights: { positive: 2, mixed: 2, restrictive: 2 } },
  intense: { count: 6, firstStartBase: 2, weights: { positive: 2, mixed: 3, restrictive: 3 } },
};

// ────────────────────────────────────────────── helpers ─────────────────────────────────────────

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
