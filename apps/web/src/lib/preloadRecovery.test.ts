import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPreloadRecovery } from './preloadRecovery';

/** jsdom refuses to navigate; stub reload so the handler's effect is observable. */
const reload = vi.fn();

const firePreloadError = (): Event => {
  const event = new Event('vite:preloadError', { cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('installPreloadRecovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00Z'));
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    installPreloadRecovery();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reloads on a stale chunk and cancels the throw', () => {
    const event = firePreloadError();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets a repeat failure through to the error boundary instead of reload-looping', () => {
    firePreloadError();
    reload.mockClear();

    vi.advanceTimersByTime(5_000);
    const event = firePreloadError();
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('recovers again once the cooldown has passed', () => {
    firePreloadError();
    reload.mockClear();

    vi.advanceTimersByTime(61_000);
    firePreloadError();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
