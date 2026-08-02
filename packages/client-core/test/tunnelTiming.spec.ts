// Replay autoplay shortens the gap between actions by its rate, so the tunnel reveal has to
// shrink by exactly the same factor — otherwise 2×/4× closes the dialog part-way through the
// flip it is waiting on.
import { describe, it, expect } from 'vitest';
import {
  REVEAL_FLIP_MS,
  REVEAL_STAGGER_MS,
  tunnelRevealMs,
  tunnelRevealTiming,
} from '../src/game/tunnel';

describe('tunnelRevealTiming', () => {
  it('runs at the authored timings at 1×', () => {
    const t = tunnelRevealTiming(3, false);
    expect(t.staggerMs).toBe(REVEAL_STAGGER_MS);
    expect(t.flipMs).toBe(REVEAL_FLIP_MS);
    expect(t.totalMs).toBe(2 * REVEAL_STAGGER_MS + REVEAL_FLIP_MS + 120);
  });

  it('divides every part of the reveal by the playback rate', () => {
    const base = tunnelRevealTiming(3, false);
    for (const speed of [2, 4]) {
      const t = tunnelRevealTiming(3, false, speed);
      expect(t.staggerMs).toBe(base.staggerMs / speed);
      expect(t.flipMs).toBe(base.flipMs / speed);
      // The whole reveal scales, so the shortened autoplay hold still contains it.
      expect(t.totalMs).toBe(base.totalMs / speed);
    }
  });

  it('collapses to instant under reduced motion, at any rate', () => {
    expect(tunnelRevealTiming(3, true, 4)).toEqual({ staggerMs: 0, flipMs: 0, totalMs: 0 });
  });

  it('falls back to real time for a nonsense rate', () => {
    const base = tunnelRevealTiming(3, false);
    for (const speed of [0, -2, NaN, Infinity]) {
      expect(tunnelRevealTiming(3, false, speed)).toEqual(base);
    }
  });

  it('tunnelRevealMs is the timing total', () => {
    expect(tunnelRevealMs(3, false, 4)).toBe(tunnelRevealTiming(3, false, 4).totalMs);
    expect(tunnelRevealMs(1, false)).toBe(REVEAL_FLIP_MS + 120);
  });
});
