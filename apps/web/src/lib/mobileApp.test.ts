import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectMobilePlatform, isAppPromptDismissed, dismissAppPrompt } from './mobileApp';

/** jsdom's navigator is read-only; redefine the two properties the detection reads. */
function asDevice(userAgent: string, platform = 'MacIntel', maxTouchPoints = 0): void {
  for (const [key, value] of Object.entries({ userAgent, platform, maxTouchPoints })) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
}

const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const SAFARI_IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

describe('detectMobilePlatform', () => {
  const original = navigator.userAgent;
  afterEach(() => asDevice(original));

  it('offers the iOS store to an iPhone', () => {
    asDevice(SAFARI_IPHONE, 'iPhone', 5);
    expect(detectMobilePlatform()).toBe('ios');
  });

  it('offers it to an iPad even in desktop mode, where the UA claims to be a Mac', () => {
    asDevice(SAFARI_IPAD_DESKTOP_MODE, 'MacIntel', 5);
    expect(detectMobilePlatform()).toBe('ios');
  });

  it('offers nothing to a real Mac/desktop browser', () => {
    asDevice(SAFARI_IPAD_DESKTOP_MODE, 'MacIntel', 0);
    expect(detectMobilePlatform()).toBeNull();
    asDevice(CHROME_DESKTOP, 'Win32', 0);
    expect(detectMobilePlatform()).toBeNull();
  });

  it('offers nothing on Android while the Play listing is internal-testing only', () => {
    asDevice(CHROME_ANDROID, 'Linux armv8l', 5);
    expect(detectMobilePlatform()).toBeNull();
  });
});

describe('app-prompt dismissal', () => {
  beforeEach(() => localStorage.clear());

  it('persists per device', () => {
    expect(isAppPromptDismissed()).toBe(false);
    dismissAppPrompt();
    expect(isAppPromptDismissed()).toBe(true);
    expect(localStorage.getItem('trm.appPromptDismissed')).toBe('1');
  });
});
