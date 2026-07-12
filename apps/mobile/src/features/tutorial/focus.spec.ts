import { describe, it, expect } from 'vitest';
import {
  selectorsForSpotlight,
  isAllowedHudSelector,
  coachPosition,
  HUD_SPOTLIGHT_SELECTORS,
} from './focus';

describe('selectorsForSpotlight', () => {
  it('maps cities to data-city-id selectors', () => {
    expect(selectorsForSpotlight({ kind: 'cities', ids: ['taipei', 'yilan'] })).toEqual([
      '[data-city-id="taipei"]',
      '[data-city-id="yilan"]',
    ]);
  });
  it('maps routes to data-route-id selectors', () => {
    expect(selectorsForSpotlight({ kind: 'route', ids: ['R18'] })).toEqual([
      '[data-route-id="R18"]',
    ]);
  });
  it('passes a hud selector through', () => {
    expect(selectorsForSpotlight({ kind: 'hud', selector: '.market' })).toEqual(['.market']);
  });
  it('returns nothing for a whole-board spotlight or undefined', () => {
    expect(selectorsForSpotlight({ kind: 'board' })).toEqual([]);
    expect(selectorsForSpotlight(undefined)).toEqual([]);
  });
});

describe('isAllowedHudSelector', () => {
  it('accepts allow-listed selectors and rejects others', () => {
    expect(isAllowedHudSelector(HUD_SPOTLIGHT_SELECTORS[0]!)).toBe(true);
    expect(isAllowedHudSelector('.market')).toBe(true);
    expect(isAllowedHudSelector('.trackers')).toBe(true);
    expect(isAllowedHudSelector('.board-viewport')).toBe(true);
    expect(isAllowedHudSelector('.ticket-chooser')).toBe(true);
    expect(isAllowedHudSelector('[data-anim="draw-tickets"]')).toBe(true);
    expect(isAllowedHudSelector('.deck-area')).toBe(false); // phantom selector, no longer allowed
    expect(isAllowedHudSelector('.evil-selector')).toBe(false);
  });
});

describe('coachPosition', () => {
  it('moves the coachmark to the top when a target sits in the lower half', () => {
    // 1000x1000 viewport; a short rect whose centre is below the midline → coach flips to the top.
    expect(coachPosition([{ x: 400, y: 850, w: 200, h: 80 }], 1000, 1000)).toBe('top');
  });
  it('keeps the coachmark at the bottom when targets are high', () => {
    expect(coachPosition([{ x: 400, y: 100, w: 200, h: 80 }], 1000, 1000)).toBe('bottom');
  });
  it('keeps the coachmark at the bottom when there are no targets', () => {
    expect(coachPosition([], 1000, 1000)).toBe('bottom');
  });
  it('docks to the right when a tall target fills the left of the viewport', () => {
    // A full-height target on the left (the board) can't be cleared vertically → dock to the right.
    expect(coachPosition([{ x: 0, y: 0, w: 300, h: 900 }], 1000, 1000)).toBe('right');
  });
  it('docks to the left when a tall target fills the right of the viewport', () => {
    // A full-height target on the right (the ticket chooser) → dock to the left.
    expect(coachPosition([{ x: 700, y: 0, w: 300, h: 900 }], 1000, 1000)).toBe('left');
  });
});
