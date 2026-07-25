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
const ring = TAIPEI_GEOGRAPHY.land[0]!;
const cityXy = new Map(TAIPEI_CITIES.map((c) => [c.id as string, { x: c.x, y: c.y }]));

/** Even-odd ray cast against the single land ring. */
function onLand(x: number, y: number): boolean {
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
    if (!onLand(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) wet++;
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

describe('Greater Taipei map content', () => {
  it('passes every structural invariant', () => {
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has the expected size and shape (Greater Taipei v1)', () => {
    const s = result.stats;
    expect(s.cityCount).toBe(44);
    expect(s.routeCount).toBe(83);
    // 71 distinct pairs; 83 − 71 = 12 parallel edges — exactly one per grouped pair (A–L).
    expect(s.distinctPairCount).toBe(71);
    expect(s.doublePairCount).toBe(12);
    expect(s.tunnelCount).toBe(7);
    expect(s.ferryCount).toBe(2);
    expect(s.ferryLocoSymbols).toBe(2);
    expect(s.totalTrackLength).toBe(159);
    expect(s.ticketCount).toBe(56);
    expect(s.longTicketCount).toBe(8);
  });

  it('has an even colour balance', () => {
    expect(result.stats.colorBalance).toMatchObject({
      RED: 8,
      GREEN: 8,
      BLUE: 8,
      WHITE: 8,
      ORANGE: 8,
      YELLOW: 8,
      PURPLE: 8,
      BLACK: 8,
      GRAY: 19,
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
    expect(TAIPEI_CONTENT.rules).toEqual({ trainCarsStart: 32 });
    // Five players must not be able to claim the whole network outright.
    expect(5 * 32).toBeGreaterThan(result.stats.totalTrackLength);
  });

  // --- cartography: the board has to read as a map, not just validate as a graph ---

  it('places every station on land, clear of the coast', () => {
    for (const c of TAIPEI_CITIES) {
      expect({ id: c.id as string, land: onLand(c.x, c.y) }).toEqual({
        id: c.id as string,
        land: true,
      });
    }
  });

  it('runs both ferries over open water and every rail route over land', () => {
    for (const r of TAIPEI_ROUTES) {
      const wet = wetFraction(cityXy.get(r.a as string)!, cityXy.get(r.b as string)!);
      if (r.ferryLocos > 0) expect(wet).toBeGreaterThan(0.2);
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

  it('keeps every station inside the base view', () => {
    const v = TAIPEI_GEOGRAPHY.baseView;
    for (const c of TAIPEI_CITIES) {
      expect(c.x).toBeGreaterThanOrEqual(v.x);
      expect(c.x).toBeLessThanOrEqual(v.x + v.w);
      expect(c.y).toBeGreaterThanOrEqual(v.y);
      expect(c.y).toBeLessThanOrEqual(v.y + v.h);
    }
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

  it('reaches every station from at least one mission', () => {
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
    expect(OFFICIAL_MAPS.map((m) => m.mapId)).toEqual(['taiwan', 'taipei']);
    expect(resolveContentByHash(TAIPEI_CONTENT_HASH)).toBe(TAIPEI_CONTENT);
  });

  it('pins the v1 content hash', () => {
    expect(hashContent(TAIPEI_CONTENT)).toBe(
      '772122739ad2d6ea511f05d530d916e9667d7bd8fa14a33d1f25ed2473e62bf8',
    );
  });
});
