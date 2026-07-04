import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '../i18n';
import { useAnimations } from '../store/animations';
import { NotificationStack } from './NotificationStack';

describe('NotificationStack', () => {
  beforeEach(() => {
    useAnimations.getState().reset();
  });

  it('renders nothing when there are no notifications', () => {
    const { container } = render(<NotificationStack />);
    expect(container.firstChild).toBeNull();
  });

  it('renders resolved copy for an event bonus cue (e.g. a stamp-rally +1)', () => {
    useAnimations.getState().pushNotification({
      variant: 'bonus',
      kind: 'STAMP_RALLY',
      reason: 'STAMP',
      points: 1,
      cityId: 'taipei',
      routeId: '',
    });
    render(<NotificationStack />);
    expect(screen.getByText('集章 +1（臺北）')).toBeInTheDocument();
  });

  it('renders resolved copy for an announced (forecast) cue', () => {
    useAnimations.getState().pushNotification({
      variant: 'announced',
      kind: 'SKY_LANTERN',
      reason: '',
      points: 0,
      cityId: '',
      routeId: '',
    });
    render(<NotificationStack />);
    expect(screen.getByText('預報：天燈之夜 即將來臨')).toBeInTheDocument();
  });

  it('renders a plain system cue verbatim, with its variant class', () => {
    useAnimations.getState().pushNotification({ variant: 'error', text: '動作被拒絕' });
    render(<NotificationStack />);
    const chip = screen.getByText('動作被拒絕');
    expect(chip).toHaveClass('notification-chip--error');
  });

  it('stacks multiple concurrent notifications in push order', () => {
    useAnimations.getState().pushNotification({ variant: 'success', text: '已複製' });
    useAnimations.getState().pushNotification({ variant: 'notice', text: '車廂卡不足' });
    render(<NotificationStack />);
    const chips = screen.getAllByRole('status');
    expect(chips.map((c) => c.textContent)).toEqual(['已複製', '車廂卡不足']);
  });

  it('auto-dismisses a cue after its variant hold time, then removes it after the exit fade', () => {
    vi.useFakeTimers();
    try {
      useAnimations.getState().pushNotification({ variant: 'success', text: '已複製' });
      render(<NotificationStack />);
      expect(screen.getByText('已複製')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000); // success HOLD_MS
      });
      expect(screen.getByText('已複製')).toHaveClass('notification-chip--exit');

      act(() => {
        vi.advanceTimersByTime(200); // EXIT_MS
      });
      expect(screen.queryByText('已複製')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
