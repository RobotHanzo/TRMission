import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLeaveWarning } from './useLeaveWarning';
import { useUi } from '../store/ui';

const dispatchBeforeUnload = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('useLeaveWarning', () => {
  afterEach(() => {
    useUi.setState({ view: 'home' });
  });

  it('does not warn on a screen with nothing to lose', () => {
    useUi.setState({ view: 'home' });
    renderHook(() => useLeaveWarning());
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it('warns while in a room', () => {
    useUi.setState({ view: 'room' });
    renderHook(() => useLeaveWarning());
    expect(dispatchBeforeUnload()).toBe(true);
  });

  it('warns during an active game', () => {
    useUi.setState({ view: 'game' });
    renderHook(() => useLeaveWarning());
    expect(dispatchBeforeUnload()).toBe(true);
  });

  it('stops warning once the view changes away from room/game', () => {
    useUi.setState({ view: 'game' });
    renderHook(() => useLeaveWarning());
    act(() => {
      useUi.setState({ view: 'home' });
    });
    expect(dispatchBeforeUnload()).toBe(false);
  });
});
