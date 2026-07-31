import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPreloadRecovery, loadChunk } from './preloadRecovery';

/**
 * Its own file, not a block in preloadRecovery.test.ts: the recovery handler latches a
 * module-level "reloading" flag that is deliberately one-way (the page is going away), so the
 * tests that fire a preload error must not run before the ones that need it unset. Vitest gives
 * each file its own module instance; **within** this file the reloading case is still last.
 */

/** jsdom refuses to navigate; stub reload so firing the handler doesn't fail the test. */
const reload = vi.fn();

describe('loadChunk', () => {
  beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    vi.useFakeTimers();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a chunk that loads first time, with no retry', async () => {
    const load = vi.fn().mockResolvedValue({ default: 'GameScreen' });
    await expect(loadChunk(load)).resolves.toEqual({ default: 'GameScreen' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  // TRMISSION-WEB-8: a phone changing networks mid-game fails the fetch once. Reloading is not
  // the fix (the deploy is current) — asking again is.
  it('retries a transient chunk failure once and resolves', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Importing a module script failed.'))
      .mockResolvedValueOnce({ default: 'GameScreen' });

    const pending = loadChunk(load);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual({ default: 'GameScreen' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('gives a still-failing chunk to the caller after the retry, not an endless spinner', async () => {
    const load = vi.fn().mockRejectedValue(new TypeError('Importing a module script failed.'));

    // Assert first, advance second: attaching the rejection handler only after the retry has
    // already failed would surface as an unhandled rejection.
    const rejects = expect(loadChunk(load)).rejects.toThrow('Importing a module script failed.');
    await vi.advanceTimersByTimeAsync(1_000);

    await rejects;
    expect(load).toHaveBeenCalledTimes(2);
  });

  // TRMISSION-WEB-7. Vite resolves a cancelled `vite:preloadError` with `undefined`, and
  // `location.reload()` does not stop the microtasks already queued — so React.lazy's module
  // mapper ran on `undefined` and threw `undefined is not an object (evaluating 'e.GameScreen')`
  // on the way out. Keep this case LAST: it latches the one-way reloading flag.
  it('stops on an undefined module once a recovery reload is in flight', async () => {
    installPreloadRecovery();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).toHaveBeenCalledTimes(1);

    const load = vi.fn().mockResolvedValue(undefined); // what a cancelled Vite import resolves to
    const settled = vi.fn();
    void loadChunk(load).then(settled, settled);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).not.toHaveBeenCalled();
  });
});
