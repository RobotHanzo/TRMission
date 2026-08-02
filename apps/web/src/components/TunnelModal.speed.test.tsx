// Replay autoplay at 2×/4× shortens the hold before the next action by that factor, so the
// reveal has to run at the same rate — the flip, the result beat, and the per-card ticks.
// (The 1× behaviour and the cues live in TunnelModal.test.tsx, which forces reduced motion.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { CardColor } from '@trm/proto';
import '../i18n';
import { TunnelModal } from './TunnelModal';

const { play } = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock('../sound/player', () => ({
  soundPlayer: { play, preload: vi.fn(), unlock: vi.fn(), setEnabled: vi.fn(), setVolume: vi.fn() },
}));
// Motion ON — this is the animated path, the one the replay rate has to reach.
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

const revealed = [CardColor.RED, CardColor.BLUE, CardColor.RED];

const renderModal = (speed?: number) =>
  render(
    <TunnelModal
      revealed={revealed}
      extraRequired={0}
      options={[]}
      spectator
      speed={speed}
      onCommit={() => {}}
      onAbort={() => {}}
    />,
  );

beforeEach(() => {
  play.mockClear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('TunnelModal reveal rate', () => {
  it('pins the flip + stagger the CSS animation reads, divided by the rate', () => {
    const { container } = renderModal(4);
    const reveal = container.querySelector<HTMLElement>('.tunnel-reveal');
    expect(reveal?.style.getPropertyValue('--reveal-flip')).toBe('150ms'); // 600 / 4
    expect(reveal?.style.getPropertyValue('--reveal-stagger')).toBe('125ms'); // 500 / 4
  });

  it('holds the result for the whole reveal at 1×', () => {
    const { container } = renderModal();
    act(() => vi.advanceTimersByTime(1719)); // 2×500 + 600 + 120
    expect(container.querySelector('.tunnel-result')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.tunnel-result')).not.toBeNull();
  });

  it('finishes the reveal in a quarter of the time at 4×', () => {
    const { container } = renderModal(4);
    act(() => vi.advanceTimersByTime(429));
    expect(container.querySelector('.tunnel-result')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.tunnel-result')).not.toBeNull();
    // All three card ticks have landed inside that window too, not just the first.
    expect(play.mock.calls.filter(([cue]) => cue === 'tunnelDraw')).toHaveLength(3);
  });
});
