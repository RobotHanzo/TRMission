import { describe, expect, it } from 'vitest';
import { MAX_SEATS } from '@trm/shared';
import { SEAT_COLORS, seatColor } from '../src/theme/colors';

describe('seatColor', () => {
  it('covers every seat a table can seat', () => {
    expect(SEAT_COLORS.length).toBeGreaterThanOrEqual(MAX_SEATS);
  });

  it('gives every seat at a full table a distinct colour', () => {
    // Regression: a hand-rolled `SEAT_COLORS[seat % 5]` wrapped seat 5 onto seat 0's colour, so
    // the 6th player at a team table shared the 1st player's dot.
    const used = Array.from({ length: MAX_SEATS }, (_, seat) => seatColor(seat));
    expect(new Set(used).size).toBe(MAX_SEATS);
  });
});
