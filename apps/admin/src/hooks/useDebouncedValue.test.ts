import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  it('returns the debounced value only after the delay elapses', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
        initialProps: { value: 'a' },
      });
      expect(result.current).toBe('a');

      rerender({ value: 'ab' });
      expect(result.current).toBe('a'); // not yet — delay hasn't elapsed

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(result.current).toBe('ab');
    } finally {
      vi.useRealTimers();
    }
  });

  it('only applies the last of several rapid changes', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
        initialProps: { value: 'a' },
      });

      rerender({ value: 'ab' });
      act(() => {
        vi.advanceTimersByTime(150); // less than the delay
      });
      rerender({ value: 'abc' }); // supersedes the pending 'ab' update

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(result.current).toBe('abc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a zero delay on the same tick', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 0), {
        initialProps: { value: '' },
      });
      rerender({ value: 'x' });
      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(result.current).toBe('x');
    } finally {
      vi.useRealTimers();
    }
  });
});
