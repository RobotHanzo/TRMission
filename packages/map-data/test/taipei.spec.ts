import { describe, it, expect } from 'vitest';
import {
  TAIPEI_CONTENT,
  TAIPEI_CONTENT_HASH,
  TAIPEI_CITIES,
  TAIPEI_ROUTES,
  TAIPEI_GEOGRAPHY,
  OFFICIAL_MAPS,
  officialMapById,
  resolveContentByHash,
  hashContent,
  validateContent,
  validateGeography,
  validateForPlay,
  shortestDistances,
} from '../src/index';

const result = validateContent(TAIPEI_CONTENT);
const land = TAIPEI_GEOGRAPHY.land[0]!;
const borders = TAIPEI_GEOGRAPHY.borders!;
const taipeiCity = borders[0]!;
const newTaipeiCity = borders[1]!;
const keelungCity = borders[2]!;
const cityXy = new Map(TAIPEI_CITIES.map((c) => [c.id as string, { x: c.x, y: c.y }]));

type Ring = readonly (readonly [number, number])[];
/** Even-odd ray cast against one ring. */
function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Fraction of a straight a→b chord that runs over open water. */
function wetFraction(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const steps = 40;
  let wet = 0;
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    if (!inRing(land, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) wet++;
  }
  return wet / (steps - 1);
}

type Pt = { x: number; y: number };
const turn = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = turn(p3, p4, p1);
  const d2 = turn(p3, p4, p2);
  const d3 = turn(p1, p2, p3);
  const d4 = turn(p1, p2, p4);
  return (d1 > 0 !== d2 > 0 || d1 === 0 || d2 === 0) && (d3 > 0 !== d4 > 0 || d3 === 0 || d4 === 0);
}

/** Which of the three city outlines a point falls inside; New Taipei is "the rest of the land". */
function cityOf(x: number, y: number): string {
  if (inRing(taipeiCity, x, y)) return 'taipei';
  if (inRing(keelungCity, x, y)) return 'keelung';
  return 'newtaipei';
}

/** Distance from a point to a ring's edge. */
function distToRing(ring: Ring, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const dx = xj - xi;
    const dy = yj - yi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - (xi + t * dx), y - (yi + t * dy)));
  }
  return best;
}

/**
 * The drawn boundaries are Natural Earth admin-1 polygons rounded to 0.01° and then
 * Douglas–Peucker simplified, so their position is only good to about a board unit. A stop that
 * genuinely sits ON a city line (Maokong at the Wenshan/Xindian/Shiding corner, Guandu at the
 * Beitou/Tamsui corner) can therefore fall the wrong side of the drawn ring by a fraction of a
 * unit. That is the data's resolution, not a misplaced stop — so membership is checked with a
 * tolerance of this many board units.
 */
const BORDER_RESOLUTION = 1.5;

const TAIPEI_CITY_STOPS = new Set([
  'tp_guandu',
  'tp_beitou',
  'tp_shilin',
  'tp_taipeimain',
  'tp_taipei101',
  'tp_songshanairport',
  'tp_neihu',
  'tp_nangang',
  'tp_gongguan',
  'tp_taipeizoo',
  'tp_maokong',
]);

describe('Greater Taipei map content', () => {
  it('passes every structural invariant', () => {
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has the expected size and shape (Greater Taipei v1)', () => {
    const s = result.stats;
    expect(s.cityCount).toBe(38);
    expect(s.routeCount).toBe(72);
    // 64 distinct pairs; 72 − 64 = 8 parallel edges — exactly one per grouped pair (A–H).
    expect(s.distinctPairCount).toBe(64);
    expect(s.doublePairCount).toBe(8);
    expect(s.tunnelCount).toBe(7);
    expect(s.ferryCount).toBe(2);
    expect(s.ferryLocoSymbols).toBe(2);
    expect(s.totalTrackLength).toBe(150);
    expect(s.ticketCount).toBe(56);
    expect(s.longTicketCount).toBe(8);
  });

  it('has an even colour balance', () => {
    expect(result.stats.colorBalance).toMatchObject({
      RED: 7,
      GREEN: 7,
      BLUE: 7,
      WHITE: 7,
      ORANGE: 7,
      YELLOW: 7,
      PURPLE: 7,
      BLACK: 7,
      GRAY: 16,
    });
  });

  it('is playable at every supported table size', () => {
    expect(validateGeography(TAIPEI_GEOGRAPHY)).toEqual([]);
    for (const maxPlayers of [2, 3, 4, 5]) {
      const play = validateForPlay(TAIPEI_CONTENT, {}, maxPlayers);
      expect(play.errors).toEqual([]);
      expect(play.warnings).toEqual([]);
    }
  });

  it('carries a lighter train supply than Taiwan, matched to the shorter segments', () => {
    expect(TAIPEI_CONTENT.rules).toEqual({ trainCarsStart: 31 });
    // Five players must not be able to claim the whole network outright.
    expect(5 * 31).toBeGreaterThan(result.stats.totalTrackLength);
  });

  // --- cartography: the stops are projected into the region, so the map has to agree with itself ---

  it('places every stop inside the region', () => {
    for (const c of TAIPEI_CITIES) {
      expect({ id: c.id as string, land: inRing(land, c.x, c.y) }).toEqual({
        id: c.id as string,
        land: true,
      });
    }
  });

  it('places every stop inside the city it actually belongs to', () => {
    const misplaced: string[] = [];
    for (const c of TAIPEI_CITIES) {
      const id = c.id as string;
      const expected =
        id === 'tp_keelung' ? 'keelung' : TAIPEI_CITY_STOPS.has(id) ? 'taipei' : 'newtaipei';
      if (cityOf(c.x, c.y) === expected) continue;
      // Otherwise it must be a border town, inside the drawn ring's own resolution.
      const ring = expected === 'keelung' ? keelungCity : taipeiCity;
      const slack =
        expected === 'newtaipei' ? distToRing(taipeiCity, c.x, c.y) : distToRing(ring, c.x, c.y);
      if (slack > BORDER_RESOLUTION) {
        misplaced.push(
          `${id}: drawn in ${cityOf(c.x, c.y)}, belongs to ${expected} (${slack.toFixed(2)} away)`,
        );
      }
    }
    expect(misplaced).toEqual([]);
    // New Taipei's ring is the region's outline minus the two enclaves, so its own stops sit
    // inside it and Keelung's does not.
    for (const c of TAIPEI_CITIES) {
      const id = c.id as string;
      if (id === 'tp_keelung' || TAIPEI_CITY_STOPS.has(id)) continue;
      expect({ id, inNewTaipei: inRing(newTaipeiCity, c.x, c.y) }).toEqual({
        id,
        inNewTaipei: true,
      });
    }
    expect(inRing(newTaipeiCity, 57.5, 25.9)).toBe(false);
  });

  it('runs both ferries over open water and every rail route over land', () => {
    for (const r of TAIPEI_ROUTES) {
      const wet = wetFraction(cityXy.get(r.a as string)!, cityXy.get(r.b as string)!);
      if (r.ferryLocos > 0) expect(wet).toBeGreaterThan(0.1);
      else expect({ id: r.id as string, wet }).toEqual({ id: r.id as string, wet: 0 });
    }
  });

  it('draws no route across another (the bundled Taiwan map holds the same property)', () => {
    const crossings: string[] = [];
    for (let i = 0; i < TAIPEI_ROUTES.length; i++) {
      for (let j = i + 1; j < TAIPEI_ROUTES.length; j++) {
        const x = TAIPEI_ROUTES[i]!;
        const y = TAIPEI_ROUTES[j]!;
        if (x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b) continue;
        if (
          segmentsCross(
            cityXy.get(x.a as string)!,
            cityXy.get(x.b as string)!,
            cityXy.get(y.a as string)!,
            cityXy.get(y.b as string)!,
          )
        ) {
          crossings.push(`${x.id as string} x ${y.id as string}`);
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  it('keeps every pair of stops far enough apart to be separate markers', () => {
    const tight: string[] = [];
    for (let i = 0; i < TAIPEI_CITIES.length; i++) {
      for (let j = i + 1; j < TAIPEI_CITIES.length; j++) {
        const a = TAIPEI_CITIES[i]!;
        const b = TAIPEI_CITIES[j]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        // The bundled Taiwan map's own closest pair (Taipei–Banqiao) sits at 3.08.
        if (d < 3) tight.push(`${a.id as string}-${b.id as string} ${d.toFixed(2)}`);
      }
    }
    expect(tight).toEqual([]);
  });

  // --- missions ---

  it('prices every mission off its shortest legal path (LONG carries a +2 premium)', () => {
    const dist = shortestDistances(TAIPEI_CITIES, TAIPEI_ROUTES);
    for (const t of TAIPEI_CONTENT.tickets) {
      const d = dist.get(t.a as string)?.get(t.b as string);
      expect({ id: t.id as string, value: t.value }).toEqual({
        id: t.id as string,
        value: (d as number) + (t.deck === 'LONG' ? 2 : 0),
      });
    }
  });

  it('reaches every stop from at least one mission', () => {
    const used = new Set<string>();
    for (const t of TAIPEI_CONTENT.tickets) {
      used.add(t.a as string);
      used.add(t.b as string);
    }
    expect([...cityXy.keys()].filter((id) => !used.has(id))).toEqual([]);
  });

  // --- registry wiring ---

  it('ships as an official map resolvable by id and by content hash', () => {
    const official = officialMapById('taipei');
    expect(official).toBeDefined();
    expect(official!.content).toBe(TAIPEI_CONTENT);
    expect(official!.hash).toBe(TAIPEI_CONTENT_HASH);
    // Its geography is content, so a fork needs no separately-generated silhouette.
    expect(official!.forkGeography).toBeUndefined();
    expect(OFFICIAL_MAPS.map((m) => m.mapId)).toEqual(['taiwan', 'taipei', 'taipei-transit']);
    expect(resolveContentByHash(TAIPEI_CONTENT_HASH)).toBe(TAIPEI_CONTENT);
  });

  it('pins the v1 content hash', () => {
    expect(hashContent(TAIPEI_CONTENT)).toBe(TAIPEI_CONTENT_HASH);
    expect(TAIPEI_CONTENT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});
