const mockLockAsync = jest.fn().mockResolvedValue(undefined);
const mockUnlockAsync = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-screen-orientation', () => ({
  lockAsync: (...a: unknown[]) => mockLockAsync(...a),
  unlockAsync: (...a: unknown[]) => mockUnlockAsync(...a),
  OrientationLock: { PORTRAIT_UP: 1 },
}));

import { Dimensions } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { orientationLockFor, useOrientationPolicy } from './useOrientationPolicy';

describe('orientationLockFor (pure: smallest side < 600dp ⇒ phone ⇒ portrait)', () => {
  it.each([
    [390, 844, 'portrait'], // iPhone portrait
    [844, 390, 'portrait'], // iPhone landscape (smallest side still < 600)
    [360, 800, 'portrait'], // small Android phone
    [599, 900, 'portrait'], // just under the tablet boundary
    [600, 900, 'unlocked'], // the 600dp tablet boundary itself
    [768, 1024, 'unlocked'], // iPad portrait
    [1024, 768, 'unlocked'], // iPad landscape
  ] as const)('%d×%d → %s', (w, h, expected) => {
    expect(orientationLockFor(w, h)).toBe(expected);
  });
});

describe('useOrientationPolicy', () => {
  beforeEach(() => jest.clearAllMocks());

  it('applies the policy for the current window on mount', () => {
    renderHook(() => useOrientationPolicy());
    const { width, height } = Dimensions.get('window');
    if (orientationLockFor(width, height) === 'portrait') {
      expect(mockLockAsync).toHaveBeenCalledWith(1);
      expect(mockUnlockAsync).not.toHaveBeenCalled();
    } else {
      expect(mockUnlockAsync).toHaveBeenCalled();
      expect(mockLockAsync).not.toHaveBeenCalled();
    }
  });
});
