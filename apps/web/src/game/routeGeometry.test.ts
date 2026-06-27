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
    // R56 / R57 are the Tainan–Kaohsiung pair (double group I), two cars each.
    const g56 = geom('R56');
    const g57 = geom('R57');
    const a56 = g56.slots[0]!.angle;
    const a57 = g57.slots[0]!.angle;
    // Straight ⇒ every car on a track shares the same (constant) heading.
    for (const s of g56.slots) expect(Math.abs(s.angle - a56)).toBeLessThan(0.01);
    for (const s of g57.slots) expect(Math.abs(s.angle - a57)).toBeLessThan(0.01);
    // The two tracks run parallel to each other.
    expect(Math.abs(a56 - a57)).toBeLessThan(0.01);
  });

  it('gives single routes no perpendicular nudge', () => {
    // A bypass curve (not a double pair) draws on its chord, no twin-track offset.
    expect(geom('R35').perp).toEqual({ x: 0, y: 0 });
  });

  it('marks high-degree junctions as hubs and leaves through-stations plain', () => {
    expect(HUB_CITIES.has('kaohsiung')).toBe(true); // degree 8
    expect(HUB_CITIES.has('taipei')).toBe(true); // degree 6
    expect(HUB_CITIES.has('tamsui')).toBe(false); // degree 2 — a spur
    expect(HUB_CITIES.has('matsu')).toBe(false); // island ferry stub
  });

  it('arcs the Taichung→Yuanlin express east, clear of Changhua to its west', () => {
    // Changhua (x=39) sits west of the straight chord; the express must bow east around it.
    expect(geom('R35').mid.x).toBeGreaterThan(chordMid('R35').x + 1);
  });

  it('arcs the Changhua→Douliu express west, clear of Yuanlin/Ershui to its east', () => {
    expect(geom('R38').mid.x).toBeLessThan(chordMid('R38').x - 1);
  });

  it('nudges double-route siblings to opposite sides of their shared chord', () => {
    // R6 / R7 are the Taipei–Banqiao pair (double group A): same path, opposite perp offsets.
    const p6 = geom('R6').perp;
    const p7 = geom('R7').perp;
    const s6 = Math.sign(p6.x) || Math.sign(p6.y);
    const s7 = Math.sign(p7.x) || Math.sign(p7.y);
    expect(s6).not.toBe(0);
    expect(s6).toBe(-s7);
  });
});
