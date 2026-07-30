import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useGame } from '@trm/client-core/store/game';
import { useAutoReload, useReloadHold } from './useAutoReload';
import { useBuildVersion } from '../store/buildVersion';

const THIS_BUILD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEW_BUILD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function servesBuild(buildId: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ buildId })))),
  );
}

function Harness({ hold = false }: { hold?: boolean }) {
  useAutoReload();
  useReloadHold(hold);
  return null;
}

/** jsdom's `visibilityState` is read-only; override the prototype getter the hook reads. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

const reload = vi.fn();

beforeEach(() => {
  reload.mockClear();
  // The bundle claims to be THIS_BUILD; /build.json decides whether that is still current.
  vi.stubEnv('VITE_COMMIT_HASH', THIS_BUILD);
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  sessionStorage.clear();
  useBuildVersion.setState({ served: null, outdated: false, holds: 0 });
  useGame.setState({ status: 'open' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('useAutoReload', () => {
  it('reloads silently when the web tier serves a newer bundle', async () => {
    servesBuild(NEW_BUILD);
    render(<Harness />);
    await act(async () => {});
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when the served bundle is this one', async () => {
    servesBuild(THIS_BUILD);
    render(<Harness />);
    await act(async () => {});
    expect(reload).not.toHaveBeenCalled();
    expect(useBuildVersion.getState().outdated).toBe(false);
  });

  // The safe-boundary rule: a reload never loses game state, but it would discard a payment the
  // player is still assembling.
  it('waits for a hold to clear before reloading', async () => {
    servesBuild(NEW_BUILD);
    const view = render(<Harness hold />);
    await act(async () => {});
    expect(reload).not.toHaveBeenCalled();
    expect(useBuildVersion.getState().outdated).toBe(true);

    view.rerender(<Harness hold={false} />);
    await act(async () => {});
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('defers a hidden tab until it is focused again', async () => {
    servesBuild(NEW_BUILD);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    render(<Harness />);
    await act(async () => {});
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility('visible');
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // A socket drop is what a deploy looks like from inside a game, so it is a trigger in its own right.
  it('checks immediately when the socket drops', async () => {
    servesBuild(THIS_BUILD);
    render(<Harness />);
    await act(async () => {});
    expect(reload).not.toHaveBeenCalled();

    servesBuild(NEW_BUILD);
    await act(async () => {
      useGame.setState({ status: 'reconnecting' });
    });
    await act(async () => {});
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // Without this a bad build.json (or a CDN serving a stale shell) would spin the tab forever.
  it('only reloads once per served build id', async () => {
    servesBuild(NEW_BUILD);
    const first = render(<Harness />);
    await act(async () => {});
    expect(reload).toHaveBeenCalledTimes(1);
    first.unmount();

    // The reload "happened", but the tab came back on the same old bundle.
    useBuildVersion.setState({ served: null, outdated: false, holds: 0 });
    render(<Harness />);
    await act(async () => {});
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stays dormant in an unstamped local build', async () => {
    vi.stubEnv('VITE_COMMIT_HASH', '');
    servesBuild(NEW_BUILD);
    render(<Harness />);
    await act(async () => {});
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
