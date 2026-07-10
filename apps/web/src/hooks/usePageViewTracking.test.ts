import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../store/ui';
import { usePageViewTracking } from './usePageViewTracking';

const track = vi.hoisted(() => vi.fn());
vi.mock('../lib/analytics', () => ({ trackPageView: (s: string) => track(s) }));

afterEach(() => {
  track.mockClear();
  useUi.setState({ view: 'home' });
});

describe('usePageViewTracking', () => {
  it('fires on mount and on each view change, skipping admin views', () => {
    renderHook(() => usePageViewTracking());
    expect(track).toHaveBeenLastCalledWith('home');

    act(() => useUi.setState({ view: 'room' }));
    expect(track).toHaveBeenLastCalledWith('room');

    track.mockClear();
    act(() => useUi.setState({ view: 'adminReplay' }));
    expect(track).not.toHaveBeenCalled();
  });
});
