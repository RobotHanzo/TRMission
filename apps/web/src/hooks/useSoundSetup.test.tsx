// Mirrors useSoundDriver.test.tsx's mocking style: stub the singleton soundPlayer and drive the
// hook through a tiny <Harness/>.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useUi } from '../store/ui';
import { useSoundSetup } from './useSoundSetup';

const { preload, unlock, setEnabled, setVolume } = vi.hoisted(() => ({
  preload: vi.fn().mockResolvedValue(undefined),
  unlock: vi.fn(),
  setEnabled: vi.fn(),
  setVolume: vi.fn(),
}));
vi.mock('../sound/player', () => ({
  soundPlayer: { preload, unlock, play: vi.fn(), setEnabled, setVolume },
}));

function Harness() {
  useSoundSetup();
  return null;
}

beforeEach(() => {
  preload.mockClear();
  unlock.mockClear();
  setEnabled.mockClear();
  setVolume.mockClear();
});

describe('useSoundSetup', () => {
  it('preloads and syncs enabled/volume from the ui store on mount', () => {
    useUi.setState({ soundEnabled: false, soundVolume: 0.25 });
    render(<Harness />);
    expect(preload).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(setVolume).toHaveBeenCalledWith(0.25);
  });

  it('keeps syncing when the ui store prefs change after mount', () => {
    useUi.setState({ soundEnabled: true, soundVolume: 0.6 });
    render(<Harness />);
    setEnabled.mockClear();
    setVolume.mockClear();
    useUi.setState({ soundEnabled: false, soundVolume: 0.1 });
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(setVolume).toHaveBeenCalledWith(0.1);
  });

  it('unlocks the audio context on the first pointerdown/keydown', () => {
    render(<Harness />);
    window.dispatchEvent(new Event('pointerdown'));
    expect(unlock).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('keydown'));
    expect(unlock).toHaveBeenCalledTimes(2);
  });
});
