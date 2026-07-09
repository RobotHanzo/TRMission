import { describe, it, expect } from 'vitest';
import { TAIWAN_CONTENT, CONTENT_HASH, validateContent } from '../src/index';

describe('Taiwan map content', () => {
  const result = validateContent(TAIWAN_CONTENT);

  it('passes every structural invariant', () => {
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has the expected size and shape (Taiwan map v4 — the tw2.1 network)', () => {
    const s = result.stats;
    expect(s.cityCount).toBe(36);
    expect(s.routeCount).toBe(75);
    // 64 distinct pairs; 75 − 64 = 11 parallel edges — exactly one per grouped double pair (A–K).
    expect(s.distinctPairCount).toBe(64);
    expect(s.doublePairCount).toBe(11);
    expect(s.tunnelCount).toBe(9);
    expect(s.ferryCount).toBe(14);
    expect(s.ferryLocoSymbols).toBe(26);
    // Sum over ALL 75 segments.
    expect(s.totalTrackLength).toBe(221);
    expect(s.ticketCount).toBe(84);
    expect(s.longTicketCount).toBe(9);
  });

  it('has the planned colour balance', () => {
    expect(result.stats.colorBalance).toMatchObject({
      RED: 7,
      GREEN: 5,
      BLUE: 6,
      WHITE: 7,
      ORANGE: 6,
      YELLOW: 7,
      PURPLE: 6,
      BLACK: 5,
      GRAY: 26,
    });
  });

  it('produces a stable content hash', () => {
    expect(CONTENT_HASH).toHaveLength(64);
    expect(CONTENT_HASH).toMatch(/^[0-9a-f]{64}$/);
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
