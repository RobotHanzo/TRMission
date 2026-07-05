import { describe, it, expect } from 'vitest';
import { WORLD_COUNTRIES } from './worldCountries';

describe('WORLD_COUNTRIES', () => {
  it('has exactly 175 countries (tied to this Natural Earth snapshot)', () => {
    expect(WORLD_COUNTRIES.length).toBe(175);
  });

  it('has no duplicate ids', () => {
    const ids = new Set(WORLD_COUNTRIES.map((c) => c.id));
    expect(ids.size).toBe(WORLD_COUNTRIES.length);
  });

  it('excludes Antarctica and the open-ocean bucket', () => {
    const continents = new Set(WORLD_COUNTRIES.map((c) => c.continent));
    expect(continents.has('Antarctica')).toBe(false);
    expect(continents.has('Seven seas (open ocean)')).toBe(false);
    expect([...continents].sort()).toEqual([
      'Africa',
      'Asia',
      'Europe',
      'North America',
      'Oceania',
      'South America',
    ]);
  });

  it('gives every ring at least 3 points', () => {
    for (const c of WORLD_COUNTRIES) {
      for (const ring of c.rings) {
        expect(ring.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("carries Taiwan with this game's own display name, not the formal Natural Earth one", () => {
    const twn = WORLD_COUNTRIES.find((c) => c.id === 'TWN');
    expect(twn).toBeDefined();
    expect(twn!.nameEn).toBe('Taiwan');
    expect(twn!.nameZh).toBe('台灣');
    expect(twn!.continent).toBe('Asia');
  });

  it('includes real high-latitude countries the widened isValidCrop bound now permits', () => {
    for (const id of ['GRL', 'CAN', 'RUS', 'NOR']) {
      expect(WORLD_COUNTRIES.some((c) => c.id === id)).toBe(true);
    }
  });
});
