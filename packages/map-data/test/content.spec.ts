import { describe, it, expect } from 'vitest';
import { TAIWAN_CONTENT, CONTENT_HASH, validateContent } from '../src/index';

describe('Taiwan map content', () => {
  const result = validateContent(TAIWAN_CONTENT);

  it('passes every structural invariant', () => {
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('has the expected size and shape after the one-station-per-county reduction', () => {
    const s = result.stats;
    expect(s.cityCount).toBe(39);
    expect(s.routeCount).toBe(67);
    expect(s.distinctPairCount).toBe(59); // 59 distinct pairs + 8 second-of-pair double edges
    expect(s.doublePairCount).toBe(8);
    expect(s.tunnelCount).toBe(14);
    expect(s.ferryCount).toBe(9);
    expect(s.ferryLocoSymbols).toBe(15);
    // Sum over ALL 67 segments. (Counting each double-route pair once gives 160, the
    // usable track in 2–3p where only one parallel is claimable.)
    expect(s.totalTrackLength).toBe(173);
    expect(s.ticketCount).toBe(42);
    expect(s.longTicketCount).toBe(6);
  });

  it('has the planned colour balance', () => {
    expect(result.stats.colorBalance).toMatchObject({
      RED: 7,
      GREEN: 8,
      BLUE: 8,
      WHITE: 8,
      ORANGE: 5,
      YELLOW: 6,
      PURPLE: 6,
      BLACK: 5,
      GRAY: 14,
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
