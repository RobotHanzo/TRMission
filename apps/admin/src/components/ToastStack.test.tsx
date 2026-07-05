import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '../i18n';
import { useToast } from '../store/toast';
import { ToastStack } from './ToastStack';

describe('ToastStack', () => {
  beforeEach(() => {
    useToast.getState().reset();
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastStack />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a pushed toast with its kind class', () => {
    useToast.getState().push('success', '已停權');
    render(<ToastStack />);
    expect(screen.getByText('已停權')).toHaveClass('oc-toast-chip--success');
  });

  it('stacks multiple concurrent toasts in push order', () => {
    useToast.getState().push('success', 'first');
    useToast.getState().push('error', 'second');
    render(<ToastStack />);
    const chips = screen.getAllByRole('status');
    expect(chips.map((c) => c.textContent)).toEqual(['first', 'second']);
  });

  it('auto-dismisses a success toast after its hold time, then removes it after the exit fade', () => {
    vi.useFakeTimers();
    try {
      useToast.getState().push('success', 'saved');
      render(<ToastStack />);
      expect(screen.getByText('saved')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2500); // success HOLD_MS
      });
      expect(screen.getByText('saved')).toHaveClass('oc-toast-chip--exit');

      act(() => {
        vi.advanceTimersByTime(200); // EXIT_MS
      });
      expect(screen.queryByText('saved')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds an error toast longer than a success toast before exiting', () => {
    vi.useFakeTimers();
    try {
      useToast.getState().push('error', 'failed');
      render(<ToastStack />);

      act(() => {
        vi.advanceTimersByTime(2500); // would have exited a success toast
      });
      expect(screen.getByText('failed')).not.toHaveClass('oc-toast-chip--exit');

      act(() => {
        vi.advanceTimersByTime(1500); // total 4000ms — error HOLD_MS
      });
      expect(screen.getByText('failed')).toHaveClass('oc-toast-chip--exit');
    } finally {
      vi.useRealTimers();
    }
  });
});
