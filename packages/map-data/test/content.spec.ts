import { describe, it, expect } from 'vitest';
import { TAIWAN_CONTENT, CONTENT_HASH, validateContent } from '../src/index';

describe('Taiwan map content', () => {
  const result = validateContent(TAIWAN_CONTENT);

  it('passes every structural invariant', () => {
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has the expected size and shape (Taiwan map v6 — the 2026-07-19 route changelog)', () => {
    const s = result.stats;
    expect(s.cityCount).toBe(36);
    expect(s.routeCount).toBe(77);
    // 64 distinct pairs; 77 − 64 = 13 parallel edges — exactly one per grouped double pair (A–M).
    expect(s.distinctPairCount).toBe(64);
    expect(s.doublePairCount).toBe(13);
    expect(s.tunnelCount).toBe(9);
    expect(s.ferryCount).toBe(14);
    expect(s.ferryLocoSymbols).toBe(25);
    // Sum over ALL 77 segments.
    expect(s.totalTrackLength).toBe(217);
    expect(s.ticketCount).toBe(84);
    expect(s.longTicketCount).toBe(9);
  });

  it('has the planned colour balance', () => {
    expect(result.stats.colorBalance).toMatchObject({
      RED: 6,
      GREEN: 5,
      BLUE: 7,
      WHITE: 7,
      ORANGE: 7,
      YELLOW: 6,
      PURPLE: 7,
      BLACK: 6,
      GRAY: 26,
    });
  });

  it('produces a stable content hash', () => {
    expect(CONTENT_HASH).toHaveLength(64);
    expect(CONTENT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it('assigns tier matching the retired lod.ts major/secondary/tertiary lists', () => {
    const major = new Set([
      'taipei',
      'hsinchu',
      'taichung',
      'chiayi',
      'tainan',
      'kaohsiung',
      'hualien',
      'taitung',
      'yilan',
      'hengchun',
    ]);
    const secondary = new Set([
      'keelung',
      'taoyuan',
      'miaoli',
      'changhua',
      'douliu',
      'pingtung',
      'nantou',
      'alishan',
      'yuli',
      'luodong',
    ]);
    const tertiary = new Set(['zhunan', 'banqiao', 'shalu', 'huwei', 'zuoying', 'chaozhou']);
    for (const city of TAIWAN_CONTENT.cities) {
      const id = city.id as string;
      const expected = major.has(id)
        ? 'major'
        : secondary.has(id)
          ? 'secondary'
          : tertiary.has(id)
            ? 'tertiary'
            : 'minor';
      expect(city.tier ?? 'minor').toBe(expected);
    }
  });

  it('accepts a valid broken rail and rejects invalid brokenCarriages', () => {
    const withBroken = {
      ...TAIWAN_CONTENT,
      routes: TAIWAN_CONTENT.routes.map((r) => (r.length >= 3 ? { ...r, brokenCarriages: 2 } : r)),
    };
    expect(validateContent(withBroken).ok).toBe(true);

    const notALength = {
      ...TAIWAN_CONTENT,
      routes: TAIWAN_CONTENT.routes.map((r, i) => (i === 0 ? { ...r, brokenCarriages: 5 } : r)),
    };
    const r1 = validateContent(notALength);
    expect(r1.ok).toBe(false);
    expect(r1.issues.some((i) => i.code === 'brokenCarriagesInvalid')).toBe(true);

    const tooLong = {
      ...TAIWAN_CONTENT,
      routes: TAIWAN_CONTENT.routes.map((r) => (r.length < 8 ? { ...r, brokenCarriages: 8 } : r)),
    };
    const r2 = validateContent(tooLong);
    expect(r2.ok).toBe(false);
    expect(r2.issues.some((i) => i.code === 'brokenCarriagesExceedLength')).toBe(true);
  });

  it('catches a broken graph (disconnected city)', () => {
    const broken = {
      ...TAIWAN_CONTENT,
      routes: TAIWAN_CONTENT.routes.filter((r) => r.a !== 'matsu' && r.b !== 'matsu'),
    };
    const r = validateContent(broken);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('not connected'))).toBe(true);
  });
});
