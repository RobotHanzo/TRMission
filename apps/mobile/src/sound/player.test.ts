// Ports the web player.test.ts assertions (throttle / enable / volume) onto the expo-audio
// factory: the injectable per-cue player stands in for expo-audio's AudioPlayer the same way the
// web test injected a fake AudioContext. The gain/throttle table and OPPONENT_GAIN are the pinned
// contract.
import { createSoundPlayer, type CuePlayer } from './player';
import { OPPONENT_GAIN } from './cues';

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => {
    throw new Error('tests must inject createPlayer');
  }),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

function mockPlayers() {
  const created: (CuePlayer & { play: jest.Mock; seekTo: jest.Mock })[] = [];
  const createPlayer = (_asset: number): CuePlayer => {
    const p = { volume: 0, seekTo: jest.fn(), play: jest.fn() };
    created.push(p);
    return p;
  };
  const playCount = (): number => created.reduce((n, p) => n + p.play.mock.calls.length, 0);
  return { createPlayer, created, playCount };
}

const noMode = (): Promise<void> => Promise.resolve();

describe('sound player', () => {
  it('no-ops when the audio module is unavailable', async () => {
    const p = createSoundPlayer({ createPlayer: () => null, configureAudioMode: noMode });
    await p.preload();
    expect(() => p.play('cardDraw')).not.toThrow();
  });

  it('plays a preloaded cue once and throttles a rapid repeat', async () => {
    const { createPlayer, playCount } = mockPlayers();
    let t = 0;
    const p = createSoundPlayer({ createPlayer, configureAudioMode: noMode, now: () => t });
    await p.preload();
    p.play('cardDraw'); // t=0 → plays
    t = 10;
    p.play('cardDraw'); // within 55ms throttle → dropped
    t = 100;
    p.play('cardDraw'); // → plays
    expect(playCount()).toBe(2);
  });

  it('does not play when disabled', async () => {
    const { createPlayer, playCount } = mockPlayers();
    const p = createSoundPlayer({ createPlayer, configureAudioMode: noMode, now: () => 0 });
    await p.preload();
    p.setEnabled(false);
    p.play('cardDraw');
    expect(playCount()).toBe(0);
  });

  it('applies gain × gainScale × master volume, rewinding before each play', async () => {
    const { createPlayer, created } = mockPlayers();
    let t = 0;
    const p = createSoundPlayer({ createPlayer, configureAudioMode: noMode, now: () => t });
    await p.preload();
    p.setVolume(0.5);
    p.play('cardDraw'); // cardDraw gain 0.8 × 1 × 0.5
    const played = created.find((c) => c.play.mock.calls.length > 0)!;
    expect(played.volume).toBeCloseTo(0.4);
    expect(played.seekTo).toHaveBeenCalledWith(0);
    t = 1000;
    p.play('cardDraw', OPPONENT_GAIN); // 0.8 × 0.5 × 0.5
    expect(played.volume).toBeCloseTo(0.2);
  });
});
