import { describe, it, expect } from 'vitest';
import {
  TAIWAN_CONTENT,
  TAIWAN_BASE_VIEW,
  TAIPEI_TRANSIT_CONTENT,
  TAIPEI_TRANSIT_GEOGRAPHY,
} from '@trm/map-data';
import { homeBounds, HOME_PAD } from '../src/game/boardModel';

const FALLBACK = { x: 0, y: 0, w: 100, h: 100 };

describe('homeBounds', () => {
  it('frames the mainland stops with a margin', () => {
    const b = homeBounds(
      [
        { x: 20, y: 30 },
        { x: 40, y: 50 },
      ],
      FALLBACK,
    );
    expect(b).toEqual({
      x: 20 - HOME_PAD,
      y: 30 - HOME_PAD,
      w: 20 + 2 * HOME_PAD,
      h: 20 + 2 * HOME_PAD,
    });
  });

  it('ignores island stops, which sit alone out in the sea', () => {
    const cities = [
      { x: 20, y: 30 },
      { x: 40, y: 50 },
      { x: 2, y: 90, isIsland: true },
    ];
    expect(homeBounds(cities, FALLBACK)).toEqual(homeBounds(cities.slice(0, 2), FALLBACK));
  });

  it('falls back to the base view when there is nothing to frame yet (an empty draft)', () => {
    expect(homeBounds([], FALLBACK)).toEqual(FALLBACK);
  });

  it('frames an all-island map by its islands rather than falling back', () => {
    expect(homeBounds([{ x: 10, y: 10, isIsland: true }], FALLBACK)).toEqual({
      x: 10 - HOME_PAD,
      y: 10 - HOME_PAD,
      w: 2 * HOME_PAD,
      h: 2 * HOME_PAD,
    });
  });

  // Issue #71: 大臺北軌道交通 crops whole counties, so its land keeps an empty plain west of 桃園
  // and a mountain block south of 礁溪 that no railway reaches. Framing the land there left the
  // network small and sitting high in the frame.
  it('drops the unplayable land 大臺北軌道交通 carries', () => {
    const b = homeBounds(TAIPEI_TRANSIT_CONTENT.cities, TAIPEI_TRANSIT_GEOGRAPHY.baseView);
    const landX = TAIPEI_TRANSIT_GEOGRAPHY.land.flat().map(([x]) => x);
    const landY = TAIPEI_TRANSIT_GEOGRAPHY.land.flat().map(([, y]) => y);
    const landW = Math.max(...landX) - Math.min(...landX);
    const landH = Math.max(...landY) - Math.min(...landY);
    expect(b.w).toBeLessThan(landW * 0.85);
    expect(b.h).toBeLessThan(landH * 0.95);
    // Every stop stays inside the frame.
    for (const c of TAIPEI_TRANSIT_CONTENT.cities) {
      if (c.isIsland) continue;
      expect(c.x).toBeGreaterThanOrEqual(b.x);
      expect(c.x).toBeLessThanOrEqual(b.x + b.w);
      expect(c.y).toBeGreaterThanOrEqual(b.y);
      expect(c.y).toBeLessThanOrEqual(b.y + b.h);
    }
  });

  // Taiwan's silhouette IS its network, so the flagship map's home view barely moves.
  it('keeps Taiwan framed on its main island', () => {
    const b = homeBounds(TAIWAN_CONTENT.cities, TAIWAN_BASE_VIEW);
    expect(b.x).toBeCloseTo(27.5, 5);
    expect(b.y).toBeCloseTo(6.5, 5);
    expect(b.w).toBeCloseTo(47.2, 5);
    expect(b.h).toBeCloseTo(84.8, 5);
  });
});
