import { describe, it, expect } from 'vitest';
import { selectionBounds } from './selectionBounds';

describe('selectionBounds', () => {
  it('returns null for an empty selection', () => {
    expect(selectionBounds([])).toBeNull();
  });

  it('spans every point and centres on the extent, not on the crowd', () => {
    // Three stations bunched left and one far right: the centre sits between the extremes, so the
    // frame the user sees and the point a group move lands on are the same place.
    const bounds = selectionBounds([
      { x: 10, y: 50 },
      { x: 11, y: 52 },
      { x: 12, y: 48 },
      { x: 60, y: 20 },
    ]);
    expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 60, maxY: 52, cx: 35, cy: 36 });
  });

  it('collapses to the point itself for a single station', () => {
    expect(selectionBounds([{ x: 7, y: -3 }])).toEqual({
      minX: 7,
      minY: -3,
      maxX: 7,
      maxY: -3,
      cx: 7,
      cy: -3,
    });
  });
});
