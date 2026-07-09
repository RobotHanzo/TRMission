import { describe, it, expect } from 'vitest';
import { openTrackCount } from '../src/config';

describe('openTrackCount', () => {
  it('matches the current double behavior when the setting is on', () => {
    expect(openTrackCount(2, 2, true)).toBe(1);
    expect(openTrackCount(2, 3, true)).toBe(1);
    expect(openTrackCount(2, 4, true)).toBe(2);
    expect(openTrackCount(2, 5, true)).toBe(2);
  });

  it('scales a triple: 1 at 2-3p, 2 at 4p, 3 at 5p when the setting is on', () => {
    expect(openTrackCount(3, 2, true)).toBe(1);
    expect(openTrackCount(3, 3, true)).toBe(1);
    expect(openTrackCount(3, 4, true)).toBe(2);
    expect(openTrackCount(3, 5, true)).toBe(3);
  });

  it('opens every track regardless of player count when the setting is off', () => {
    expect(openTrackCount(2, 2, false)).toBe(2);
    expect(openTrackCount(3, 2, false)).toBe(3);
    expect(openTrackCount(3, 5, false)).toBe(3);
  });
});
