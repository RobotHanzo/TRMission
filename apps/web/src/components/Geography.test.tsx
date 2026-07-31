import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { MapGeography } from '@trm/map-data';
import { CustomGeography } from './Geography';

const geographyWith = (baseView: MapGeography['baseView']): MapGeography => ({
  baseView,
  land: [],
  crop: { lonMin: 0, lonMax: 1, latMin: 0, latMax: 1 },
});

const graticule = (baseView: MapGeography['baseView']) => {
  const { container } = render(
    <svg>
      <CustomGeography geography={geographyWith(baseView)} />
    </svg>,
  );
  return [...container.querySelectorAll('g.graticule line')];
};

describe('CustomGeography graticule', () => {
  it('draws the fixed 20-unit grid across an authored view', () => {
    const lines = graticule({ x: -4, y: -4, w: 100, h: 100 });
    const ys = lines.filter((l) => l.getAttribute('y1') === l.getAttribute('y2'));
    const xs = lines.filter((l) => l.getAttribute('x1') === l.getAttribute('x2'));
    expect(ys.map((l) => Number(l.getAttribute('y1')))).toEqual([0, 20, 40, 60, 80]);
    expect(xs.map((l) => Number(l.getAttribute('x1')))).toEqual([0, 20, 40, 60, 80]);
  });

  // A custom map's baseView is third-party content (a cloned shared map, or whatever map someone
  // else's room is bound to) and is bounded by no schema, so the grid must be bounded here.
  it('caps the grid for an absurd view instead of allocating a line per step', () => {
    const lines = graticule({ x: 0, y: 0, w: 1e12, h: 1e12 });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(1024); // MAX_GRATICULE_LINES per axis
  });

  it('terminates where the step is below the float ULP', () => {
    // `x += 20` at ±1e300 is a no-op, so an incrementing walk would never reach `end` at all.
    const lines = graticule({ x: -1e300, y: -1e300, w: 1e300, h: 1e300 });
    expect(lines.length).toBeLessThanOrEqual(2);
  });
});
