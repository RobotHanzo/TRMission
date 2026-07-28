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

  it('keeps island stops in frame — they are places a ferry can be claimed to', () => {
    const b = homeBounds(
      [
        { x: 20, y: 30 },
        { x: 40, y: 50 },
        { x: 2, y: 90 },
      ],
      FALLBACK,
    );
    expect(b).toEqual({
      x: 2 - HOME_PAD,
      y: 30 - HOME_PAD,
      w: 38 + 2 * HOME_PAD,
      h: 60 + 2 * HOME_PAD,
    });
  });

  it('falls back to the base view when there is nothing to frame yet (an empty draft)', () => {
    expect(homeBounds([], FALLBACK)).toEqual(FALLBACK);
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
    expect(b.w).toBeLessThan(landW * 0.75);
    expect(b.h).toBeLessThan(landH * 0.85);
    // Every stop stays inside the frame — the land is what gets cut, never a station.
    for (const c of TAIPEI_TRANSIT_CONTENT.cities) {
      expect(c.x).toBeGreaterThanOrEqual(b.x);
      expect(c.x).toBeLessThanOrEqual(b.x + b.w);
      expect(c.y).toBeGreaterThanOrEqual(b.y);
      expect(c.y).toBeLessThanOrEqual(b.y + b.h);
    }
  });

  // Taiwan is tall, so its height sets the fit either way — carrying Kinmen (x=4) and Orchid
  // Island (y=85) costs almost nothing and keeps every ferry stop on screen.
  it('carries Taiwan’s outlying stops without widening the frame past its height', () => {
    const b = homeBounds(TAIWAN_CONTENT.cities, TAIWAN_BASE_VIEW);
    expect(b.x).toBeCloseTo(3, 5); // Kinmen − HOME_PAD
    expect(b.y).toBeCloseTo(6, 5); // Matsu − HOME_PAD
    expect(b.w).toBeCloseTo(75.3, 5);
    expect(b.h).toBeCloseTo(82.3, 5);
    expect(b.h).toBeGreaterThan(b.w); // still height-led, as the island itself is
  });
});
