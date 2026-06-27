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
    expect(s.cityCount).toBe(46);
    expect(s.routeCount).toBe(90);
    expect(s.distinctPairCount).toBe(80); // 80 distinct pairs + 10 double pairs
    expect(s.doublePairCount).toBe(10);
    expect(s.tunnelCount).toBe(15);
    expect(s.ferryCount).toBe(10);
    expect(s.ferryLocoSymbols).toBe(16);
    // Sum over ALL 90 segments. (Counting each double-route pair once gives 188, the
    // usable track in 2–3p where only one parallel is claimable.)
    expect(s.totalTrackLength).toBe(204);
    expect(s.ticketCount).toBe(46);
    expect(s.longTicketCount).toBe(6);
  });

  it('has the planned colour balance', () => {
    expect(result.stats.colorBalance).toMatchObject({
      RED: 10,
      GREEN: 10,
      BLUE: 10,
      WHITE: 10,
      ORANGE: 9,
      YELLOW: 9,
      PURPLE: 8,
      BLACK: 8,
      GRAY: 16,
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
