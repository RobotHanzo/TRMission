import { describe, it, expect } from 'vitest';
import { simplifyRing, simplifyToFit } from './simplify';
import type { Ring } from './clip';

describe('simplifyRing', () => {
  it('leaves a triangle untouched (nothing to simplify)', () => {
    const ring: Ring = [
      [0, 0],
      [10, 0],
      [5, 10],
    ];
    expect(simplifyRing(ring, 1)).toEqual(ring);
  });

  it('removes a near-collinear point within tolerance', () => {
    const ring: Ring = [
      [0, 0],
      [5, 0.01], // almost exactly on the 0,0 → 10,0 line
      [10, 0],
      [5, 10],
    ];
    const simplified = simplifyRing(ring, 0.5);
    expect(simplified.length).toBeLessThan(ring.length);
  });

  it('keeps a genuine corner outside tolerance', () => {
    const ring: Ring = [
      [0, 0],
      [5, 3], // a real corner, well outside a small tolerance
      [10, 0],
      [5, 10],
    ];
    const simplified = simplifyRing(ring, 0.1);
    expect(simplified.length).toBe(ring.length);
  });

  it('may legitimately collapse below 3 points under an extreme tolerance — callers filter', () => {
    // simplifyRing itself has no floor; simplifyToFit is what guarantees every returned ring is
    // a real polygon (see the simplifyToFit tests below), dropping anything that collapses.
    const ring: Ring = [
      [0, 0],
      [1, 0.001],
      [2, 0],
      [1, 5],
    ];
    const simplified = simplifyRing(ring, 1000);
    expect(simplified.length).toBeLessThan(3);
  });
});

describe('simplifyToFit', () => {
  function wobblyCircle(n: number, r: number, wobble: number): Ring {
    return Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      const jitter = wobble * Math.sin(i * 7);
      return [
        (r + jitter) * Math.cos(a) + r,
        (r + jitter) * Math.sin(a) + r,
      ] as const;
    });
  }

  it('leaves small input alone', () => {
    const ring = wobblyCircle(20, 10, 0.01);
    const { rings, droppedRings } = simplifyToFit([ring], { maxVertices: 15000, maxRings: 400 });
    expect(rings).toHaveLength(1);
    expect(droppedRings).toBe(0);
  });

  it('simplifies down to the vertex cap for a very dense ring', () => {
    const ring = wobblyCircle(4000, 50, 3);
    const { rings } = simplifyToFit([ring], { maxVertices: 500, maxRings: 400 });
    const total = rings.reduce((s, r) => s + r.length, 0);
    expect(total).toBeLessThanOrEqual(500);
    expect(total).toBeGreaterThanOrEqual(3);
  });

  it('caps the number of rings, keeping the largest ones', () => {
    const big = wobblyCircle(50, 50, 0.01);
    const small = wobblyCircle(4, 1, 0.01);
    const rings = [big, small, small, small];
    const { rings: result } = simplifyToFit(rings, { maxVertices: 100000, maxRings: 2 });
    expect(result).toHaveLength(2);
    expect(result.some((r) => r.length === big.length)).toBe(true);
  });

  it('reports how many rings were dropped', () => {
    const big = wobblyCircle(50, 50, 0.01);
    const small = wobblyCircle(4, 1, 0.01);
    const { droppedRings } = simplifyToFit([big, small, small], {
      maxVertices: 100000,
      maxRings: 1,
    });
    expect(droppedRings).toBe(2);
  });
});
