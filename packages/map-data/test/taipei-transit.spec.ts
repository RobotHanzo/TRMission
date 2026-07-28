import { describe, it, expect } from 'vitest';
import {
  TAIPEI_TRANSIT_CONTENT,
  TAIPEI_TRANSIT_CONTENT_HASH,
  TAIPEI_TRANSIT_CITIES,
  TAIPEI_TRANSIT_ROUTES,
  TAIPEI_TRANSIT_GEOGRAPHY,
  TAIPEI_TRANSIT_BASE_VIEW,
  OFFICIAL_MAPS,
  officialMapById,
  resolveContentByHash,
  hashContent,
  validateContent,
  validateGeography,
  validateForPlay,
} from '../src/index';

const result = validateContent(TAIPEI_TRANSIT_CONTENT);
const land = TAIPEI_TRANSIT_GEOGRAPHY.land[0]!;
const cityXy = new Map(TAIPEI_TRANSIT_CITIES.map((c) => [c.id as string, { x: c.x, y: c.y }]));

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

type Pt = { x: number; y: number };
const turn = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = turn(p3, p4, p1);
  const d2 = turn(p3, p4, p2);
  const d3 = turn(p1, p2, p3);
  const d4 = turn(p1, p2, p4);
  return (d1 > 0 !== d2 > 0 || d1 === 0 || d2 === 0) && (d3 > 0 !== d4 > 0 || d3 === 0 || d4 === 0);
}

describe('大臺北軌道交通 (Greater Taipei Rail Transit) map content', () => {
  it('passes every structural invariant', () => {
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('credits the community author', () => {
    expect(TAIPEI_TRANSIT_CONTENT.meta.author).toBe('嶼翼');
    expect(TAIPEI_TRANSIT_CONTENT.meta.nameZh).toBe('大臺北軌道交通');
  });

  it('has the expected size and shape (v1, adopted from the author draft verbatim)', () => {
    const s = result.stats;
    expect(s.cityCount).toBe(46);
    expect(s.routeCount).toBe(91);
    // 84 distinct pairs; 91 − 84 = 7 parallel edges — exactly one per grouped pair.
    expect(s.distinctPairCount).toBe(84);
    expect(s.doublePairCount).toBe(7);
    expect(s.tunnelCount).toBe(8);
    expect(s.ferryCount).toBe(8);
    expect(s.ferryLocoSymbols).toBe(14);
    expect(s.totalTrackLength).toBe(239);
    expect(s.ticketCount).toBe(63);
    expect(s.longTicketCount).toBe(8);
    expect(s.colorBalance).toMatchObject({
      RED: 10,
      GREEN: 10,
      BLUE: 10,
      WHITE: 7,
      ORANGE: 9,
      YELLOW: 9,
      PURPLE: 4,
      BLACK: 8,
      GRAY: 24,
    });
  });

  it('keeps the author rule sheet (only the deltas from the engine defaults)', () => {
    expect(TAIPEI_TRANSIT_CONTENT.rules).toEqual({
      trainCarsStart: 55,
      initialShortOffer: 4,
      ticketDrawCount: 5,
    });
  });

  it('is playable at every supported table size', () => {
    expect(validateGeography(TAIPEI_TRANSIT_GEOGRAPHY)).toEqual([]);
    for (const maxPlayers of [2, 3, 4, 5]) {
      const play = validateForPlay(TAIPEI_TRANSIT_CONTENT, {}, maxPlayers);
      expect(play.errors).toEqual([]);
      expect(play.warnings).toEqual([]);
    }
  });

  // --- cartography ---

  it('trims the excess Taoyuan/Yilan county area: every ring stays inside the cut window', () => {
    const rings = [
      ...TAIPEI_TRANSIT_GEOGRAPHY.land,
      ...(TAIPEI_TRANSIT_GEOGRAPHY.borders ?? []),
      ...(TAIPEI_TRANSIT_GEOGRAPHY.relief ?? []),
    ];
    for (const ring of rings) {
      for (const [x, y] of ring) {
        expect(x).toBeGreaterThanOrEqual(14);
        expect(y).toBeLessThanOrEqual(57);
      }
    }
    // The cut edges sit just OUTSIDE the home view, so the land runs off-frame there.
    expect(TAIPEI_TRANSIT_BASE_VIEW.x).toBeGreaterThan(14);
    expect(TAIPEI_TRANSIT_BASE_VIEW.y + TAIPEI_TRANSIT_BASE_VIEW.h).toBeLessThan(57);
  });

  it('marks 陽明山 and the 雪山山脈 as relief, like the Taiwan map marks its Central Range', () => {
    const relief = TAIPEI_TRANSIT_GEOGRAPHY.relief!;
    expect(relief).toHaveLength(2);
    const [yangmingshan, xueshan] = relief;
    // The 陽明山 stop sits on its own massif.
    const ym = cityXy.get('tt_yangmingshan')!;
    expect(inRing(yangmingshan!, ym.x, ym.y)).toBe(true);
    // The 雪山山脈 wall separates the basin from the Yilan-side stops: the two long tunnels
    // (礁溪–石碇 8, 烏來–礁溪 6) cross it, and the Yilan stops themselves stay off it.
    for (const [a, b] of [
      ['tt_jiaoxi', 'tt_shiding'],
      ['tt_wulai', 'tt_jiaoxi'],
    ] as const) {
      const pa = cityXy.get(a)!;
      const pb = cityXy.get(b)!;
      const crossesRange = xueshan!.some((p, i) => {
        const q = xueshan![(i + 1) % xueshan!.length]!;
        return segmentsCross(pa, pb, { x: p[0], y: p[1] }, { x: q[0], y: q[1] });
      });
      expect({ pair: `${a}-${b}`, crossesRange }).toEqual({
        pair: `${a}-${b}`,
        crossesRange: true,
      });
    }
    for (const id of ['tt_jiaoxi', 'tt_daxi', 'tt_xindian', 'tt_shiding']) {
      const p = cityXy.get(id)!;
      expect({ id, onRange: inRing(xueshan!, p.x, p.y) }).toEqual({ id, onRange: false });
    }
  });

  it('places every stop on land (the islet and the wharf deliberately sit in the water)', () => {
    for (const c of TAIPEI_TRANSIT_CITIES) {
      const id = c.id as string;
      // 基隆嶼 is an island stop; 漁人碼頭 is a pier jutting past the simplified shoreline.
      const expectLand = id !== 'tt_keelungislet' && id !== 'tt_fishermanswharf';
      expect({ id, land: inRing(land, c.x, c.y) }).toEqual({ id, land: expectLand });
    }
  });

  it('draws no route across another (straight chords, as the author placed them)', () => {
    const crossings: string[] = [];
    for (let i = 0; i < TAIPEI_TRANSIT_ROUTES.length; i++) {
      for (let j = i + 1; j < TAIPEI_TRANSIT_ROUTES.length; j++) {
        const x = TAIPEI_TRANSIT_ROUTES[i]!;
        const y = TAIPEI_TRANSIT_ROUTES[j]!;
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

  // --- missions ---

  it('reaches every stop from at least one mission', () => {
    const used = new Set<string>();
    for (const t of TAIPEI_TRANSIT_CONTENT.tickets) {
      used.add(t.a as string);
      used.add(t.b as string);
    }
    expect([...cityXy.keys()].filter((id) => !used.has(id))).toEqual([]);
  });

  // --- registry wiring ---

  it('ships as an official map resolvable by id and by content hash', () => {
    const official = officialMapById('taipei-transit');
    expect(official).toBeDefined();
    expect(official!.content).toBe(TAIPEI_TRANSIT_CONTENT);
    expect(official!.hash).toBe(TAIPEI_TRANSIT_CONTENT_HASH);
    // Its geography is content, so a fork needs no separately-generated silhouette.
    expect(official!.forkGeography).toBeUndefined();
    // The author's map is a team-mode map; the flag is registry-only, so the pinned hash below
    // is what proves tagging it moved no content.
    expect(official!.recommendedTeamMode).toBe(true);
    expect(OFFICIAL_MAPS.map((m) => m.mapId)).toEqual(['taiwan', 'taipei', 'taipei-transit']);
    expect(resolveContentByHash(TAIPEI_TRANSIT_CONTENT_HASH)).toBe(TAIPEI_TRANSIT_CONTENT);
  });

  it('pins the v1 content hash', () => {
    expect(hashContent(TAIPEI_TRANSIT_CONTENT)).toBe(TAIPEI_TRANSIT_CONTENT_HASH);
    expect(TAIPEI_TRANSIT_CONTENT_HASH).toBe(
      '00214d544da8b26e7ab34e855ff5d32cc2e3765d1f437d54d93b4946de8924ab',
    );
  });
});
