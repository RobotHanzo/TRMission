// Ports the web player.test.ts assertions (throttle / enable / volume) onto the expo-audio
// factory: the injectable per-cue player stands in for expo-audio's AudioPlayer the same way the
// web test injected a fake AudioContext. The gain/throttle table and OPPONENT_GAIN are the pinned
// contract.
import { createSoundPlayer, type AppStateSource, type CuePlayer } from './player';
import { ALL_CUES, OPPONENT_GAIN } from './cues';

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => {
    throw new Error('tests must inject createPlayer');
  }),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const expoAudio = require('expo-audio') as { createAudioPlayer: jest.Mock };

function mockPlayers() {
  const created: (CuePlayer & { play: jest.Mock; seekTo: jest.Mock; remove: jest.Mock })[] = [];
  const createPlayer = (_asset: number): CuePlayer => {
    const p = { volume: 0, seekTo: jest.fn(), play: jest.fn(), remove: jest.fn() };
    created.push(p);
    return p;
  };
  const playCount = (): number => created.reduce((n, p) => n + p.play.mock.calls.length, 0);
  return { createPlayer, created, playCount };
}

/** A controllable foreground state, standing in for react-native's AppState. */
function mockAppState(initial = true) {
  let listener: ((active: boolean) => void) | null = null;
  const source: AppStateSource = {
    isActive: () => initial,
    subscribe: (onChange) => {
      listener = onChange;
      return () => {
        listener = null;
      };
    },
  };
  return { appState: source, set: (active: boolean) => listener?.(active) };
}

const noMode = (): Promise<void> => Promise.resolve();

describe('sound player', () => {
  it('no-ops when the audio module is unavailable', async () => {
    const p = createSoundPlayer({ createPlayer: () => null, configureAudioMode: noMode });
    await p.preload();
    expect(() => p.play('cardDraw')).not.toThrow();
  });

  it('plays a cue once and throttles a rapid repeat', async () => {
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

  it('swallows a native play() failure (e.g. iOS session activation) instead of throwing', async () => {
    const createPlayer = (): CuePlayer => ({
      volume: 0,
      seekTo: jest.fn(),
      play: jest.fn(() => {
        throw new Error('Session activation failed');
      }),
    });
    const p = createSoundPlayer({ createPlayer, configureAudioMode: noMode, now: () => 0 });
    await p.preload();
    expect(() => p.play('cardDraw')).not.toThrow();
  });

  // TRMISSION-MOBILE-A: an AudioPlayer is a whole ExoPlayer/AVPlayer pipeline, and preload() runs
  // at the app root — including on background launches that never show a frame. Fifteen of them
  // there was ~75 idle OS threads in a backgrounded process, and a background ANR.
  it('allocates no player until a cue is actually played', async () => {
    const { createPlayer, created } = mockPlayers();
    const p = createSoundPlayer({ createPlayer, configureAudioMode: noMode, now: () => 0 });
    await p.preload();
    expect(created).toHaveLength(0);
    expect(ALL_CUES.length).toBeGreaterThan(1); // the count preload() used to eagerly build

    p.play('cardDraw');
    expect(created).toHaveLength(1);
  });

  it('builds a cue player once and reuses it across plays', async () => {
    const { createPlayer, created, playCount } = mockPlayers();
    let t = 0;
    const p = createSoundPlayer({ createPlayer, configureAudioMode: noMode, now: () => t });
    await p.preload();
    p.play('cardDraw');
    t = 1000;
    p.play('cardDraw');
    expect(created).toHaveLength(1);
    expect(playCount()).toBe(2);
  });

  it('probes an unavailable audio module once per cue, not once per play', async () => {
    const createPlayer = jest.fn(() => null);
    let t = 0;
    const p = createSoundPlayer({ createPlayer, configureAudioMode: noMode, now: () => t });
    await p.preload();
    p.play('cardDraw');
    t = 1000;
    p.play('cardDraw');
    expect(createPlayer).toHaveBeenCalledTimes(1);
  });

  it('releases every player and stops playing when the app leaves the foreground', async () => {
    const { createPlayer, created, playCount } = mockPlayers();
    const { appState, set } = mockAppState(true);
    let t = 0;
    const p = createSoundPlayer({
      createPlayer,
      configureAudioMode: noMode,
      now: () => t,
      appState,
    });
    await p.preload();
    p.play('cardDraw');
    expect(created).toHaveLength(1);

    set(false);
    expect(created[0].remove).toHaveBeenCalled();
    t = 1000;
    p.play('cardDraw'); // backgrounded: no sound over the user's music, and no new pipeline
    expect(playCount()).toBe(1);
    expect(created).toHaveLength(1);

    set(true);
    t = 2000;
    p.play('cardDraw'); // foreground again: rebuilt on demand
    expect(created).toHaveLength(2);
    expect(playCount()).toBe(2);
  });

  it('plays nothing on a process the OS launched in the background', async () => {
    const { createPlayer, created } = mockPlayers();
    const { appState } = mockAppState(false);
    const p = createSoundPlayer({
      createPlayer,
      configureAudioMode: noMode,
      now: () => 0,
      appState,
    });
    await p.preload();
    p.play('cardDraw');
    expect(created).toHaveLength(0);
  });

  it('hands the pipelines back when sound is switched off', async () => {
    const { createPlayer, created } = mockPlayers();
    const p = createSoundPlayer({ createPlayer, configureAudioMode: noMode, now: () => 0 });
    await p.preload();
    p.play('cardDraw');
    p.setEnabled(false);
    expect(created[0].remove).toHaveBeenCalled();
  });

  // The assertions above all drive the injected seam. This one exercises the REAL wiring the app
  // ships — default createPlayer, default audio mode, default AppState — because "preload() touches
  // expo-audio at all" is the precise thing that cost a background ANR.
  it('never reaches expo-audio from preload() on the un-injected default path', async () => {
    expoAudio.createAudioPlayer.mockClear();
    const p = createSoundPlayer();
    await expect(p.preload()).resolves.toBeUndefined();
    expect(expoAudio.createAudioPlayer).not.toHaveBeenCalled();
  });

  it('does not stack a second foreground watch when preload runs twice', async () => {
    const subscribe = jest.fn(() => () => undefined);
    const p = createSoundPlayer({
      createPlayer: () => null,
      configureAudioMode: noMode,
      now: () => 0,
      appState: { isActive: () => true, subscribe },
    });
    await p.preload();
    await p.preload(); // the driver preloads too, on top of the app root's useSoundSetup
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
