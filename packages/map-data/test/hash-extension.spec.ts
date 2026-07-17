import { describe, it, expect } from 'vitest';
import { TAIWAN_CONTENT, CONTENT_HASH, hashContent } from '../src/index';
import type { GameContent, MapGeography } from '../src/index';
import { CONTENT_V4 } from '../src/archive/v4';

/**
 * Tripwire for the hashContent formula extension (custom maps): geography/rules enter the
 * digest ONLY when present, so every hash minted before the extension stays byte-identical.
 */
const PINNED_HASH = '6e06eb39c90aa6c82db20638f84b200d9a46bbd4f6777e883e6bab4840dbf26f';
const V4_HASH = 'e211b5d98bd7142b8c52e63bf681a57dfab903375c95cee4c0dbc165ecc6f4ba';

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
  it('pins the current Taiwan (v5) hash', () => {
    expect(CONTENT_HASH).toBe(PINNED_HASH);
  });

  it('hashes content without geography/rules exactly as before the extension', () => {
    expect(hashContent({ ...TAIWAN_CONTENT })).toBe(PINNED_HASH);
  });

  it('keeps v4 content byte-identical when auspiciousPairs is absent', () => {
    expect(hashContent(CONTENT_V4)).toBe(V4_HASH);
  });

  it('authored auspicious pairs change the hash', () => {
    expect(hashContent(TAIWAN_CONTENT)).not.toBe(hashContent(CONTENT_V4));
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

  it('a broken rail changes the hash; content without one hashes exactly as before', () => {
    const withBroken: GameContent = {
      ...TAIWAN_CONTENT,
      routes: TAIWAN_CONTENT.routes.map((r, i) => (i === 0 ? { ...r, brokenCarriages: 2 } : r)),
    };
    expect(hashContent(withBroken)).not.toBe(PINNED_HASH);
    // The type extension alone must not move any pre-existing hash.
    expect(hashContent({ ...TAIWAN_CONTENT })).toBe(PINNED_HASH);
  });

  it('a ticket view changes the hash; content without one hashes exactly as before', () => {
    const withView: GameContent = {
      ...TAIWAN_CONTENT,
      tickets: TAIWAN_CONTENT.tickets.map((t, i) =>
        i === 0 ? { ...t, view: { mode: 'auto' as const } } : t,
      ),
    };
    expect(hashContent(withView)).not.toBe(PINNED_HASH);
    expect(hashContent({ ...TAIWAN_CONTENT })).toBe(PINNED_HASH);
  });

  it('a geography defaultTicketView changes the hash vs geography alone', () => {
    const geoOnly: GameContent = { ...TAIWAN_CONTENT, geography: GEO };
    const geoWithDefault: GameContent = {
      ...TAIWAN_CONTENT,
      geography: { ...GEO, defaultTicketView: { mode: 'auto' as const } },
    };
    expect(hashContent(geoWithDefault)).not.toBe(hashContent(geoOnly));
  });

  it('a geography borders overlay changes the hash vs geography alone', () => {
    const geoOnly: GameContent = { ...TAIWAN_CONTENT, geography: GEO };
    const geoWithBorders: GameContent = {
      ...TAIWAN_CONTENT,
      geography: {
        ...GEO,
        borders: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
        ],
      },
    };
    expect(hashContent(geoWithBorders)).not.toBe(hashContent(geoOnly));
    // The type extension alone must not move any pre-existing hash.
    expect(hashContent({ ...TAIWAN_CONTENT })).toBe(PINNED_HASH);
  });
});
