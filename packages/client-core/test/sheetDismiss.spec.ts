import { describe, it, expect } from 'vitest';
import {
  SHEET_DISMISS_DISTANCE,
  SHEET_DISMISS_VELOCITY,
  shouldDismissSheet,
  sheetDragOffset,
} from '../src/game/sheetDismiss';

describe('sheet swipe-down dismissal (issue #65)', () => {
  it('keeps the sheet open for a short, slow pull', () => {
    expect(shouldDismissSheet(SHEET_DISMISS_DISTANCE - 1, 10)).toBe(false);
  });

  it('dismisses once the pull passes the distance, at any speed', () => {
    expect(shouldDismissSheet(SHEET_DISMISS_DISTANCE, 0)).toBe(true);
  });

  it('dismisses a short flick that is fast enough', () => {
    expect(shouldDismissSheet(20, SHEET_DISMISS_VELOCITY)).toBe(true);
  });

  it('never dismisses on an upward drag, however fast', () => {
    expect(shouldDismissSheet(-200, -2000)).toBe(false);
    expect(shouldDismissSheet(0, 5000)).toBe(false);
  });

  it('follows the finger downward and resists upward', () => {
    expect(sheetDragOffset(40)).toBe(40);
    expect(sheetDragOffset(-40)).toBe(-10);
  });
});
