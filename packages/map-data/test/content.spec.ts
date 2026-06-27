import { describe, it, expect } from 'vitest';
import { TAIWAN_CONTENT, CONTENT_HASH, validateContent } from '../src/index';

describe('Taiwan map content', () => {
  const result = validateContent(TAIWAN_CONTENT);

  it('passes every structural invariant', () => {
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has the expected size and shape (plan §6)', () => {
    const s = result.stats;
    expect(s.cityCount).toBe(43);
    expect(s.routeCount).toBe(85);
    expect(s.distinctPairCount).toBe(75); // 75 distinct pairs + 10 second-of-pair double edges
    expect(s.doublePairCount).toBe(10);
    expect(s.tunnelCount).toBe(18);
    expect(s.ferryCount).toBe(10);
    expect(s.ferryLocoSymbols).toBe(16);
    // Sum over ALL 85 segments. (Counting each double-route pair once gives 194, the
    // usable track in 2–3p where only one parallel is claimable.)
    expect(s.totalTrackLength).toBe(210);
    expect(s.ticketCount).toBe(46);
    expect(s.longTicketCount).toBe(6);
  });

  it('has the planned colour balance', () => {
    expect(result.stats.colorBalance).toMatchObject({
      RED: 8,
      GREEN: 9,
      BLUE: 9,
      WHITE: 9,
      ORANGE: 8,
      YELLOW: 9,
      PURPLE: 8,
      BLACK: 8,
      GRAY: 17,
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
