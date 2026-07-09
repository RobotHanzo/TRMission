import { describe, it, expect } from 'vitest';
import { TAIWAN_CONTENT, CONTENT_HASH, hashContent } from '../src/index';
import type { GameContent, MapGeography } from '../src/index';

/**
 * Tripwire for the hashContent formula extension (custom maps): geography/rules enter the
 * digest ONLY when present, so every hash minted before the extension stays byte-identical.
 */
const PINNED_HASH = '1977feaae22361e837a17763b12f07b919913fce107e435858df09cb3a88d930';

const GEO: MapGeography = {
  baseView: { x: 0, y: 0, w: 100, h: 100 },
  land: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
  ],
  crop: { lonMin: 120, lonMax: 122, latMin: 21, latMax: 25 },
};

describe('hashContent extension', () => {
  it('pins the current Taiwan (v4) hash', () => {
    expect(CONTENT_HASH).toBe(PINNED_HASH);
  });

  it('hashes content without geography/rules exactly as before the extension', () => {
    expect(hashContent({ ...TAIWAN_CONTENT })).toBe(PINNED_HASH);
  });

  it('geography changes the hash', () => {
    const withGeo: GameContent = { ...TAIWAN_CONTENT, geography: GEO };
    expect(hashContent(withGeo)).not.toBe(PINNED_HASH);
  });

  it('rules change the hash', () => {
    const withRules: GameContent = { ...TAIWAN_CONTENT, rules: { trainCarsStart: 30 } };
    expect(hashContent(withRules)).not.toBe(PINNED_HASH);
  });

  it('geography-only and rules-only variants hash differently from each other', () => {
    const withGeo: GameContent = { ...TAIWAN_CONTENT, geography: GEO };
    const withRules: GameContent = { ...TAIWAN_CONTENT, rules: { trainCarsStart: 30 } };
    expect(hashContent(withGeo)).not.toBe(hashContent(withRules));
  });

  it('a route bow changes the hash; content without one hashes exactly as before', () => {
    const withBow: GameContent = {
      ...TAIWAN_CONTENT,
      routes: TAIWAN_CONTENT.routes.map((r, i) => (i === 0 ? { ...r, bow: 3 } : r)),
    };
    expect(hashContent(withBow)).not.toBe(PINNED_HASH);
    // The type extension alone must not move any pre-existing hash.
    expect(hashContent({ ...TAIWAN_CONTENT })).toBe(PINNED_HASH);
  });
});
