import { describe, it, expect } from 'vitest';
import { makeRng, DEFAULT_RULE_PARAMS, asCityId, asRouteId } from '@trm/shared';
import type { EventsMode, RuleParams } from '@trm/shared';
import type { GameContent, CityDef, RouteDef } from '@trm/map-data';
import { taiwanBoard, CONTENT_HASH } from '../src/taiwan';
import { buildBoard } from '../src/board';
import type { Board } from '../src/board';
import { generateSchedule, fiveCityPaths, PROCESSION_PATH_CAP } from '../src/events/schedule';
import { initGame } from '../src/setup';
import { makeConfig } from './helpers';
import type { EventScheduleEntry, RandomEventKind } from '../src/types/events-state';

const board = taiwanBoard();

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
const TELEGRAPHED = new Set<RandomEventKind>([
  'TYPHOON_LANDFALL',
  'TYPHOON_DAY_OFF',
  'SKY_LANTERN',
  'AFTERSHOCK',
  'SLOPE_REPAIR_ORDER',
  'SPRING_FESTIVAL_RUSH',
  'ALL_SEATS_RESERVED',
]);
const RESTRICTIVE_OR_MIXED = new Set<RandomEventKind>([
  'TYPHOON_LANDFALL',
  'TYPHOON_DAY_OFF',
  'SKY_LANTERN',
  'AFTERSHOCK',
  'SLOPE_REPAIR_ORDER',
  'SPRING_FESTIVAL_RUSH',
  'ALL_SEATS_RESERVED',
]);
const FIRST_BASE: Record<Exclude<EventsMode, 'off'>, number> = {
  light: 4,
  moderate: 3,
  intense: 2,
};
const GAP_SPAN: Record<Exclude<EventsMode, 'off'>, number> = { light: 6, moderate: 4, intense: 2 };
const SCHEDULE_ROUND_CAP = 300;
const FUTURE_KINDS = new Set<RandomEventKind>([
  'LANTERN_HOST_CITY',
  'BENTO_RUSH',
  'SLOPE_REPAIR_ORDER',
  'STATION_FRONT_NIGHT_MARKET',
  'GODDESS_PROCESSION',
  'SPRING_FESTIVAL_RUSH',
  'ROLLING_STOCK_ALLOCATION_DAY',
  'HIVE_OF_SPARKS',
  'BREAKTHROUGH_BORING_MACHINE',
  'INTERIM_OPERATIONS_REPORT',
  'HARVEST_FESTIVAL_EXPRESS',
  'ALL_SEATS_RESERVED',
  'LUCKY_TICKET_STUB',
]);

function gen(mode: EventsMode, seed: string) {
  const rp: RuleParams = { ...DEFAULT_RULE_PARAMS, eventsMode: mode };
  return generateSchedule(board, rp, makeRng(seed));
}

/** occupancy used for the inter-event gap: durationRounds for restrictive/mixed, else 1. */
function occupancy(e: EventScheduleEntry): number {
  return RESTRICTIVE_OR_MIXED.has(e.kind) ? DURATIONS[e.kind] : 1;
}

/** Unweighted BFS hop distance on the full board graph. */
function hops(b: Board, a: string, z: string): number {
  const adj = new Map<string, string[]>();
  for (const c of b.cityIds) adj.set(c as string, []);
  for (const r of b.content.routes) {
    adj.get(r.a as string)?.push(r.b as string);
    adj.get(r.b as string)?.push(r.a as string);
  }
  const dist = new Map<string, number>([[a, 0]]);
  const q = [a];
  for (let h = 0; h < q.length; h++) {
    const u = q[h]!;
    for (const v of adj.get(u) ?? []) {
      if (!dist.has(v)) {
        dist.set(v, (dist.get(u) as number) + 1);
        q.push(v);
      }
    }
  }
  return dist.get(z) ?? Infinity;
}

describe('generateSchedule — determinism & structure', () => {
  it('is a pure function of (seed, mode): two runs deep-equal', () => {
    for (const mode of ['light', 'moderate', 'intense'] as const) {
      const [a] = gen(mode, 'same-seed');
      const [b] = gen(mode, 'same-seed');
      expect(a).toEqual(b);
    }
  });

  it("mode 'off' draws ZERO and leaves no events state on initGame", () => {
    const { board: b, config: cfgNoMode } = makeConfig(3, 'off-check');
    const { config: cfgOff } = makeConfig(3, 'off-check', { eventsMode: 'off' });
    const s1 = initGame(b, cfgNoMode);
    const s2 = initGame(b, cfgOff);
    expect('events' in s1).toBe(false);
    expect('events' in s2).toBe(false);
    expect(s1.rng.counter).toBe(s2.rng.counter);
    // generateSchedule itself returns the rng untouched.
    const r0 = makeRng('untouched');
    const [ev, r1] = generateSchedule(b, { ...DEFAULT_RULE_PARAMS, eventsMode: 'off' }, r0);
    expect(ev).toBeUndefined();
    expect(r1.counter).toBe(r0.counter);
  });

  it('keeps generating events for the whole game span, not just an initial burst', () => {
    for (const mode of ['light', 'moderate', 'intense'] as const) {
      for (let s = 0; s < 20; s++) {
        const [ev] = gen(mode, `span-${mode}-${s}`);
        const sched = ev!.schedule;
        expect(sched.length).toBeGreaterThan(0);
        // A real greedy-policy game routinely runs 45-75 rounds (see the schedule.ts doc comment);
        // the schedule must keep reaching well past that, not stop dead after a fixed handful of
        // entries the way the old count-capped generator did.
        const last = sched[sched.length - 1]!;
        expect(last.startRound + occupancy(last)).toBeGreaterThan(60);
      }
    }
  });

  it('intensity controls frequency: higher intensity packs in more entries over the same span', () => {
    const avgCount: Record<Exclude<EventsMode, 'off'>, number> = {
      light: 0,
      moderate: 0,
      intense: 0,
    };
    const seeds = 40;
    for (const mode of ['light', 'moderate', 'intense'] as const) {
      let total = 0;
      for (let s = 0; s < seeds; s++) {
        const [ev] = gen(mode, `density-${mode}-${s}`);
        total += ev!.schedule.length;
      }
      avgCount[mode] = total / seeds;
    }
    expect(avgCount.light).toBeLessThan(avgCount.moderate);
    expect(avgCount.moderate).toBeLessThan(avgCount.intense);
  });

  it('respects the first-start-round bounds, gap minimums, and non-overlapping windows', () => {
    for (const mode of ['light', 'moderate', 'intense'] as const) {
      for (let s = 0; s < 40; s++) {
        const [ev] = gen(mode, `struct-${mode}-${s}`);
        const sched = ev!.schedule;
        if (sched.length === 0) continue;
        // First start round ∈ [base, base + gapSpan - 1], never below 2.
        expect(sched[0]!.startRound).toBeGreaterThanOrEqual(Math.max(2, FIRST_BASE[mode]));
        expect(sched[0]!.startRound).toBeLessThanOrEqual(FIRST_BASE[mode] + GAP_SPAN[mode] - 1);
        // All within the generation round cap; strictly increasing; gap ≥ occupancy + 1.
        for (let i = 0; i < sched.length; i++) {
          expect(sched[i]!.startRound).toBeLessThanOrEqual(SCHEDULE_ROUND_CAP);
          if (i > 0) {
            const gap = sched[i]!.startRound - sched[i - 1]!.startRound;
            expect(gap).toBeGreaterThanOrEqual(occupancy(sched[i - 1]!) + 1);
          }
        }
        // Restrictive/mixed active windows never overlap each other.
        const windows = sched
          .filter((e) => RESTRICTIVE_OR_MIXED.has(e.kind))
          .map((e) => [e.startRound, e.startRound + DURATIONS[e.kind] - 1] as const);
        for (let i = 1; i < windows.length; i++) {
          expect(windows[i]![0]).toBeGreaterThan(windows[i - 1]![1]);
        }
      }
    }
  });

  it('sets telegraphed flags and durations correctly per kind', () => {
    for (const mode of ['light', 'moderate', 'intense'] as const) {
      for (let s = 0; s < 20; s++) {
        const [ev] = gen(mode, `flags-${mode}-${s}`);
        for (const e of ev!.schedule) {
          expect(e.telegraphed).toBe(TELEGRAPHED.has(e.kind));
          expect(e.durationRounds).toBe(DURATIONS[e.kind]);
        }
      }
    }
  });

  it('keeps every expansion kind reachable from seeded schedule generation', () => {
    const seen = new Set<RandomEventKind>();
    for (let seed = 0; seed < 80 && seen.size < FUTURE_KINDS.size; seed++) {
      const [ev] = gen('intense', `future-kind-${seed}`);
      for (const entry of ev!.schedule) if (FUTURE_KINDS.has(entry.kind)) seen.add(entry.kind);
    }
    expect(seen).toEqual(FUTURE_KINDS);
  });

  it('gives charter pairs ≥ 4 hops apart and typhoon routes that touch the drawn region', () => {
    for (let s = 0; s < 60; s++) {
      const [ev] = gen('intense', `targets-${s}`);
      for (const e of ev!.schedule) {
        if (e.kind === 'CHARTER_SPECIAL' && e.charter) {
          expect(hops(board, e.charter.a as string, e.charter.b as string)).toBeGreaterThanOrEqual(
            4,
          );
        }
        if ((e.kind === 'TYPHOON_LANDFALL' || e.kind === 'SKY_LANTERN') && e.region && e.routeIds) {
          for (const rid of e.routeIds) {
            const r = board.routeById.get(rid as string)!;
            const touches =
              board.cityById.get(r.a as string)?.region === e.region ||
              board.cityById.get(r.b as string)?.region === e.region;
            expect(touches).toBe(true);
          }
          if (e.kind === 'TYPHOON_LANDFALL') {
            expect(e.routeIds.length).toBeGreaterThanOrEqual(2);
            expect(e.routeIds.length).toBeLessThanOrEqual(3);
          }
          if (e.kind === 'SKY_LANTERN') {
            expect(e.routeIds.length).toBeGreaterThanOrEqual(3);
            expect(e.routeIds.length).toBeLessThanOrEqual(4);
          }
        }
      }
    }
  });

  it('falls back gracefully on a sparse board (no region ≥ 3 routes, no far pair)', () => {
    // A tiny 3-city single-region path: no region has ≥ 3 touching routes, and no pair is ≥ 4 hops.
    const city = (id: string, x: number): CityDef => ({
      id: asCityId(id),
      nameZh: id,
      nameEn: id,
      x,
      y: 0,
      region: 'X',
      isIsland: false,
    });
    const route = (id: string, a: string, z: string): RouteDef => ({
      id: asRouteId(id),
      a: asCityId(a),
      b: asCityId(z),
      color: 'GRAY',
      length: 2,
      ferryLocos: 0,
      isTunnel: false,
    });
    const content: GameContent = {
      meta: { mapId: 'sparse', version: 1, nameZh: 's', nameEn: 's' },
      cities: [city('c1', 0), city('c2', 10), city('c3', 20)],
      routes: [route('r1', 'c1', 'c2'), route('r2', 'c2', 'c3')],
      tickets: [],
    };
    const sparse = buildBoard(content);
    for (const mode of ['light', 'moderate', 'intense'] as const) {
      const [ev] = generateSchedule(
        sparse,
        { ...DEFAULT_RULE_PARAMS, eventsMode: mode },
        makeRng('sparse'),
      );
      expect(ev).toBeDefined();
      for (const e of ev!.schedule) {
        expect(e.kind).not.toBe('TYPHOON_LANDFALL');
        expect(e.kind).not.toBe('SKY_LANTERN');
        expect(e.kind).not.toBe('CHARTER_SPECIAL');
      }
    }
  });

  it('keeps CONTENT_HASH-pinned Taiwan content intact (sanity)', () => {
    expect(board.content.meta).toBeDefined();
    expect(typeof CONTENT_HASH).toBe('string');
  });

  it('never schedules the same auspicious pair twice in one game', () => {
    // The official map authors only two pairs; a 300-round schedule draws many positive events,
    // so without per-pair dedup the same pair would recur and hand its +5 to an already-connected
    // player for free at the second open.
    for (let seed = 0; seed < 40; seed++) {
      const [ev] = gen('intense', `lucky-dedup-${seed}`);
      const pairKeys = ev!.schedule
        .filter((entry) => entry.kind === 'LUCKY_TICKET_STUB')
        .map((entry) => `${entry.pair!.a as string}|${entry.pair!.b as string}`);
      expect(new Set(pairKeys).size).toBe(pairKeys.length);
    }
  });

  it('caps procession-path enumeration deterministically on a dense custom map', () => {
    // A 12-city clique (66 routes — well inside the 300-route custom-map limit) holds
    // 12·11·10·9·8/2 = 47,520 canonical simple 5-city paths; unbounded enumeration on maps
    // like this is a genesis-time DoS. The walk order is canonical, so the capped prefix is
    // identical on every run.
    const city = (id: string, x: number): CityDef => ({
      id: asCityId(id),
      nameZh: id,
      nameEn: id,
      x,
      y: 0,
      region: 'X',
      isIsland: false,
    });
    const cities = Array.from({ length: 12 }, (_, i) => city(`d${String(i).padStart(2, '0')}`, i));
    const routes: RouteDef[] = [];
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        routes.push({
          id: asRouteId(`dr${i}-${j}`),
          a: cities[i]!.id,
          b: cities[j]!.id,
          color: 'GRAY',
          length: 2,
          ferryLocos: 0,
          isTunnel: false,
        });
      }
    }
    const dense = buildBoard({
      meta: { mapId: 'dense', version: 1, nameZh: 'd', nameEn: 'd' },
      cities,
      routes,
      tickets: [],
    });

    const capped = fiveCityPaths(dense);
    expect(capped.length).toBe(PROCESSION_PATH_CAP);
    for (const path of capped.slice(0, 50)) {
      expect(new Set(path).size).toBe(5);
    }
    const again = fiveCityPaths(dense);
    expect(again).toEqual(capped);

    // The official map sits far below the cap — its path set is never truncated.
    expect(fiveCityPaths(board).length).toBeLessThan(PROCESSION_PATH_CAP);
  });
});
