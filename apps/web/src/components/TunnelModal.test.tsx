import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardColor } from '@trm/proto';
import '../i18n';
import { TunnelModal } from './TunnelModal';

const { play } = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock('../sound/player', () => ({
  soundPlayer: { play, preload: vi.fn(), unlock: vi.fn(), setEnabled: vi.fn(), setVolume: vi.fn() },
}));
// Force the immediate (reduced-motion) path so the result cue fires synchronously.
vi.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

const revealed = [CardColor.RED, CardColor.BLUE, CardColor.RED];

beforeEach(() => play.mockClear());

describe('TunnelModal cues', () => {
  it('plays tunnelSuccess when no surcharge is required', () => {
    render(
      <TunnelModal
        revealed={revealed}
        extraRequired={0}
        options={[]}
        onCommit={() => {}}
        onAbort={() => {}}
      />,
    );
    expect(play).toHaveBeenCalledWith('tunnelDraw');
    expect(play).toHaveBeenCalledWith('tunnelSuccess');
    expect(play).not.toHaveBeenCalledWith('tunnelPayment');
  });

  it('plays tunnelPayment when a surcharge is required', () => {
    render(
      <TunnelModal
        revealed={revealed}
        extraRequired={2}
        options={[]}
        onCommit={() => {}}
        onAbort={() => {}}
      />,
    );
    expect(play).toHaveBeenCalledWith('tunnelPayment');
    expect(play).not.toHaveBeenCalledWith('tunnelSuccess');
  });
});

describe('TunnelModal spectator view', () => {
  it('shows a read-only colour-only surcharge combination with no action buttons', () => {
    const { container } = render(
      <TunnelModal
        revealed={revealed}
        extraRequired={2}
        playedColor={CardColor.BLUE}
        options={[]}
        spectator
        onCommit={() => {}}
        onAbort={() => {}}
      />,
    );
    // The single colour-only combination (藍 ×2), rendered read-only — not a clickable option.
    const combo = container.querySelector('.payment-card--readonly');
    expect(combo).not.toBeNull();
    expect(combo?.getAttribute('aria-label')).toBe('藍 ×2');
    // Spectators can't act on someone else's tunnel: no commit/abort buttons.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows no combination when the tunnel needs no surcharge', () => {
    const { container } = render(
      <TunnelModal
        revealed={revealed}
        extraRequired={0}
        playedColor={CardColor.BLUE}
        options={[]}
        spectator
        onCommit={() => {}}
        onAbort={() => {}}
      />,
    );
    expect(container.querySelector('.payment-card--readonly')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
