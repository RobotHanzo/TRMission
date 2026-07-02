import { describe, it, expect } from 'vitest';
import { TAIWAN_CONTENT, validateForPlay, RULE_BOUNDS } from '../src/index';
import { testContent, ticketsFor } from './fixtures';

describe('validateForPlay', () => {
  it('accepts the Taiwan content with default rules', () => {
    const r = validateForPlay(TAIWAN_CONTENT);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('errors when the LONG deck cannot cover the initial offer for 5 players', () => {
    // Taiwan has 6 LONG tickets; initialLongOffer 2 needs 10.
    const r = validateForPlay(TAIWAN_CONTENT, { initialLongOffer: 2 });
    expect(r.errors.some((e) => /LONG/.test(e))).toBe(true);
  });

  it('errors when the SHORT deck cannot cover offers plus one draw', () => {
    // 10 SHORT < 5×3 + 3 = 18 needed with default rules.
    const content = testContent({ tickets: ticketsFor(6, 10, 12) });
    const r = validateForPlay(content);
    expect(r.errors.some((e) => /SHORT/.test(e))).toBe(true);
  });

  it('scales the ticket requirements down with maxPlayers', () => {
    // 10 SHORT ≥ 2×3 + 3 = 9 for a 2-player cap.
    const content = testContent({ tickets: ticketsFor(6, 10, 12) });
    const r = validateForPlay(content, {}, 2);
    expect(r.errors).toEqual([]);
  });

  it('errors on out-of-bounds rule values', () => {
    const r = validateForPlay(TAIWAN_CONTENT, { trainCarsStart: 5 });
    expect(r.errors.some((e) => /trainCarsStart/.test(e))).toBe(true);
  });

  it('errors when the initial ticket offer cannot satisfy the minimum keep', () => {
    const r = validateForPlay(TAIWAN_CONTENT, { initialLongOffer: 0, initialShortOffer: 1 });
    expect(r.errors.some((e) => /keep/i.test(e))).toBe(true);
  });

  it('reads rules from the content when none are passed explicitly', () => {
    const content = testContent({ rules: { initialLongOffer: 2 } });
    const r = validateForPlay(content);
    expect(r.errors.some((e) => /LONG/.test(e))).toBe(true);
  });

  it('warns when total track length cannot exhaust the starting trains', () => {
    // Ring fixture total track = 36 < default trainCarsStart 45 − endgame threshold.
    const r = validateForPlay(testContent());
    expect(r.warnings.some((w) => /train/i.test(w))).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('exports sane RULE_BOUNDS for every curated key', () => {
    for (const [key, bound] of Object.entries(RULE_BOUNDS)) {
      expect(bound.min, key).toBeLessThanOrEqual(bound.max);
    }
    expect(RULE_BOUNDS.trainCarsStart.min).toBeGreaterThan(0);
  });
});
