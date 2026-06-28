import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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
      <TunnelModal revealed={revealed} extraRequired={0} options={[]} onCommit={() => {}} onAbort={() => {}} />,
    );
    expect(play).toHaveBeenCalledWith('tunnelDraw');
    expect(play).toHaveBeenCalledWith('tunnelSuccess');
    expect(play).not.toHaveBeenCalledWith('tunnelPayment');
  });

  it('plays tunnelPayment when a surcharge is required', () => {
    render(
      <TunnelModal revealed={revealed} extraRequired={2} options={[]} onCommit={() => {}} onAbort={() => {}} />,
    );
    expect(play).toHaveBeenCalledWith('tunnelPayment');
    expect(play).not.toHaveBeenCalledWith('tunnelSuccess');
  });
});
