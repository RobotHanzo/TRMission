import { describe, it, expect } from 'vitest';
import { TAIWAN_CITIES } from './taiwanCities';

describe('TAIWAN_CITIES', () => {
  it('carries all 22 of Taiwan’s administrative divisions', () => {
    expect(TAIWAN_CITIES.length).toBe(22);
  });

  it('has no duplicate ids', () => {
    const ids = new Set(TAIWAN_CITIES.map((c) => c.id));
    expect(ids.size).toBe(TAIWAN_CITIES.length);
  });

  it('uses ISO 3166-2 (TW-*) ids', () => {
    for (const c of TAIWAN_CITIES) expect(c.id).toMatch(/^TW-[A-Z]{2,3}$/);
  });

  it('gives every ring at least 3 points', () => {
    for (const c of TAIWAN_CITIES) {
      expect(c.rings.length).toBeGreaterThan(0);
      for (const ring of c.rings) expect(ring.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('includes 連江縣 (Matsu), which Natural Earth omits, spliced from TW open data', () => {
    const lie = TAIWAN_CITIES.find((c) => c.id === 'TW-LIE');
    expect(lie).toBeDefined();
    expect(lie!.nameZh).toBe('連江縣');
  });

  it("normalizes Natural Earth's 臺 to this app's 台 convention", () => {
    for (const c of TAIWAN_CITIES) expect(c.nameZh).not.toContain('臺');
    expect(TAIWAN_CITIES.some((c) => c.nameZh === '台北市')).toBe(true);
    expect(TAIWAN_CITIES.some((c) => c.nameZh === '台南市')).toBe(true);
  });

  it('disambiguates the Hsinchu and Chiayi city/county pairs in English', () => {
    const en = new Set(TAIWAN_CITIES.map((c) => c.nameEn));
    expect(en.has('Hsinchu City')).toBe(true);
    expect(en.has('Hsinchu County')).toBe(true);
    expect(en.has('Chiayi City')).toBe(true);
    expect(en.has('Chiayi County')).toBe(true);
    expect(en.size).toBe(TAIWAN_CITIES.length); // every English name is unique
  });

  it('places every vertex inside Taiwan’s lon/lat envelope', () => {
    for (const c of TAIWAN_CITIES) {
      for (const ring of c.rings) {
        for (const [lon, lat] of ring) {
          expect(lon).toBeGreaterThan(118);
          expect(lon).toBeLessThan(123);
          expect(lat).toBeGreaterThan(21);
          expect(lat).toBeLessThan(27);
        }
      }
    }
  });
});
