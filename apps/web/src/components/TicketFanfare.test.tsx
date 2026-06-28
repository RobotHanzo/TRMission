import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import confetti from 'canvas-confetti';
import '../i18n';
import { TICKETS } from '../game/content';
import { TicketFanfare } from './TicketFanfare';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const T = TICKETS[0]!.id as string;
const fanfare = (long = false) => ({ id: 1, ticketId: T, long, seat: 0 });

describe('TicketFanfare', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the completion title and fires confetti', () => {
    render(<TicketFanfare fanfare={fanfare()} reducedMotion={false} onDone={() => {}} />);
    expect(screen.getByText('任務完成')).toBeTruthy();
    expect(confetti).toHaveBeenCalled();
  });

  it('skips on backdrop click', () => {
    const onDone = vi.fn();
    const { container } = render(
      <TicketFanfare fanfare={fanfare()} reducedMotion={false} onDone={onDone} />,
    );
    fireEvent.click(container.querySelector('.fanfare-backdrop')!);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('skips on Escape', () => {
    const onDone = vi.fn();
    render(<TicketFanfare fanfare={fanfare()} reducedMotion={false} onDone={onDone} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does not fire confetti under reduced motion', () => {
    render(<TicketFanfare fanfare={fanfare()} reducedMotion={true} onDone={() => {}} />);
    expect(confetti).not.toHaveBeenCalled();
  });

  it('auto-dismisses within the 7s cap', () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      render(<TicketFanfare fanfare={fanfare(true)} reducedMotion={false} onDone={onDone} />);
      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
