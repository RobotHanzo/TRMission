import { describe, it, expect } from 'vitest';
import { ROUTES, cityById } from './content';
import { ROUTE_GEOMETRY } from './routeGeometry';

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

  it('starts and ends each curve on its two endpoint cities', () => {
    for (const r of ROUTES) {
      const a = cityById.get(r.a as string)!;
      const b = cityById.get(r.b as string)!;
      const path = geom(r.id as string).path;
      expect(path.startsWith(`M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`)).toBe(true);
      expect(path.endsWith(`${b.x.toFixed(2)} ${b.y.toFixed(2)}`)).toBe(true);
    }
  });

  it('arcs the Taichung→Yuanlin express east, clear of Changhua to its west', () => {
    // Changhua (x=39) sits west of the straight chord; the express must bow east around it.
    expect(geom('R35').mid.x).toBeGreaterThan(chordMid('R35').x + 1);
  });

  it('arcs the Changhua→Douliu express west, clear of Yuanlin/Ershui to its east', () => {
    expect(geom('R38').mid.x).toBeLessThan(chordMid('R38').x - 1);
  });

  it('bows double-route siblings to opposite sides of their shared chord', () => {
    // R6 / R7 are the Taipei–Banqiao pair (double group A).
    const mid = chordMid('R6');
    const s6 = Math.sign(geom('R6').mid.x - mid.x) || Math.sign(geom('R6').mid.y - mid.y);
    const s7 = Math.sign(geom('R7').mid.x - mid.x) || Math.sign(geom('R7').mid.y - mid.y);
    expect(s6).not.toBe(0);
    expect(s6).toBe(-s7);
  });
});
