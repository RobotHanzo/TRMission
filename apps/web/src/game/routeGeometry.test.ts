import { describe, it, expect } from 'vitest';
import { ROUTES, cityById } from './content';
import { ROUTE_GEOMETRY, HUB_CITIES } from './routeGeometry';

const geom = (id: string) => {
  const g = ROUTE_GEOMETRY.get(id);
  if (!g) throw new Error(`no geometry for ${id}`);
  return g;
};

const chordMid = (id: string) => {
  const r = ROUTES.find((x) => (x.id as string) === id)!;
  const a = cityById.get(r.a as string)!;
  const b = cityById.get(r.b as string)!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

/** Signed deviation of a route's rendered apex from its straight chord, along the chord normal
 *  (-dy, dx)/len for a→b — i.e. the value an authored `bow` is expected to reproduce. */
const deviation = (id: string) => {
  const r = ROUTES.find((x) => (x.id as string) === id)!;
  const a = cityById.get(r.a as string)!;
  const b = cityById.get(r.b as string)!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const m = geom(id).mid;
  const cm = chordMid(id);
  return (m.x - cm.x) * nx + (m.y - cm.y) * ny;
};

describe('route geometry', () => {
  it('gives every route exactly one car per train-length', () => {
    for (const r of ROUTES) expect(geom(r.id as string).slots).toHaveLength(r.length);
  });

  it('keeps every route on its two endpoint cities (doubles separate at render time)', () => {
    for (const r of ROUTES) {
      const a = cityById.get(r.a as string)!;
      const b = cityById.get(r.b as string)!;
      const path = geom(r.id as string).path;
      expect(path.startsWith(`M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`)).toBe(true);
      expect(path.endsWith(`${b.x.toFixed(2)} ${b.y.toFixed(2)}`)).toBe(true);
    }
  });

  it('draws parallel double routes as straight, parallel tracks (not curves)', () => {
    // R30 / R31 = 嘉義–臺南 pair (double group E), four cars each, no authored bow.
    const g1 = geom('R30');
    const g2 = geom('R31');
    const a1 = g1.slots[0]!.angle;
    const a2 = g2.slots[0]!.angle;
    // Straight ⇒ every car on a track shares the same (constant) heading.
    for (const s of g1.slots) expect(Math.abs(s.angle - a1)).toBeLessThan(0.01);
    for (const s of g2.slots) expect(Math.abs(s.angle - a2)).toBeLessThan(0.01);
    // The two tracks run parallel to each other.
    expect(Math.abs(a1 - a2)).toBeLessThan(0.01);
  });

  it('gives single routes no perpendicular nudge', () => {
    // A lone route (not a double pair) draws on its chord, no twin-track offset.
    expect(geom('R13').perp).toEqual({ x: 0, y: 0 }); // 臺中–南投, single
  });

  it('marks high-degree junctions as hubs and leaves through-stations plain', () => {
    expect(HUB_CITIES.has('tainan')).toBe(true); // degree 7
    expect(HUB_CITIES.has('taipei')).toBe(true); // degree 6
    expect(HUB_CITIES.has('kaohsiung')).toBe(true); // degree 5
    expect(HUB_CITIES.has('chishang')).toBe(false); // degree 2 — a through-station
    expect(HUB_CITIES.has('matsu')).toBe(false); // island ferry stub
  });

  it("applies each route's authored bow as a perpendicular apex deviation", () => {
    // The editor-authored `bow` reproduces exactly as the apex's signed deviation from the chord.
    expect(deviation('R25')).toBeCloseTo(5.6, 1); // 澎湖–高雄 ferry arcs wide of the strait
    expect(deviation('R41')).toBeCloseTo(-1.9, 1); // 臺東–潮州
    expect(deviation('R26')).toBeCloseTo(0.8, 1); // 臺南–澎湖 ferry
    expect(deviation('R7')).toBeCloseTo(-1, 1); // 新竹–苗栗 tunnel
    expect(deviation('R27')).toBeCloseTo(0, 1); // 彰化–斗六 forced straight (bow 0)
  });

  it('nudges double-route siblings to opposite sides of their shared chord', () => {
    // R48 / R49 = 桃園–板橋 pair (double group I): same path, opposite perp offsets.
    const p1 = geom('R48').perp;
    const p2 = geom('R49').perp;
    const s1 = Math.sign(p1.x) || Math.sign(p1.y);
    const s2 = Math.sign(p2.x) || Math.sign(p2.y);
    expect(s1).not.toBe(0);
    expect(s1).toBe(-s2);
  });
});
