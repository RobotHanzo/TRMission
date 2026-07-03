import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmAction } from './useConfirmAction';

describe('useConfirmAction', () => {
  it('starts closed, opens on request, and runs the action exactly once on confirm', () => {
    const { result } = renderHook(() => useConfirmAction());
    expect(result.current.open).toBe(false);

    const action = vi.fn();
    act(() => result.current.request(action));
    expect(result.current.open).toBe(true);
    expect(action).not.toHaveBeenCalled();

    act(() => result.current.confirm());
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);
  });

  it('cancel closes without running the pending action', () => {
    const { result } = renderHook(() => useConfirmAction());
    const action = vi.fn();
    act(() => result.current.request(action));
    act(() => result.current.cancel());
    expect(result.current.open).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('a fresh request replaces the pending action', () => {
    const { result } = renderHook(() => useConfirmAction());
    const first = vi.fn();
    const second = vi.fn();
    act(() => result.current.request(first));
    act(() => result.current.request(second));
    act(() => result.current.confirm());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
