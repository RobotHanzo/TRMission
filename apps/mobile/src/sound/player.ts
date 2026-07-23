// The SAME SoundPlayer interface the web exports (apps/web/src/sound/player.ts) — that surface is
// the binding P2 contract; only the factory internals differ. SDK 56 removed expo-av, so this is
// built on expo-audio: one AudioPlayer per cue, preloaded from the bundled assets, each play()
// rewinding to 0 at `def.gain * gainScale * masterVolume`. The enabled/volume/lastPlayed throttle
// state ports verbatim from the web factory.
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { ALL_CUES, CUES, CUE_ASSETS, type Cue } from './cues';

export interface SoundPlayer {
  preload(): Promise<void>;
  /** No-op on native — mobile playback needs no user-gesture unlock (web autoplay policy only). */
  unlock(): void;
  play(cue: Cue, gainScale?: number): void;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
}

/** The slice of expo-audio's AudioPlayer the factory drives (injectable in tests). */
export interface CuePlayer {
  volume: number;
  seekTo(seconds: number): Promise<void> | void;
  play(): void;
}

interface Opts {
  /** Factory for a per-cue player (overridable in tests). Returns null when unavailable. */
  createPlayer?: (asset: number) => CuePlayer | null;
  /** Audio-session setup (overridable in tests). */
  configureAudioMode?: () => Promise<void>;
  /** Monotonic clock in ms (overridable in tests). */
  now?: () => number;
}

const defaultCreatePlayer = (asset: number): CuePlayer | null => {
  try {
    return createAudioPlayer(asset);
  } catch {
    return null;
  }
};

// Game SFX must not duck the user's own music (mix, don't interrupt) and must respect the iOS
// mute switch (no playback in silent mode).
const defaultConfigureAudioMode = (): Promise<void> =>
  setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });

export function createSoundPlayer(opts: Opts = {}): SoundPlayer {
  const createPlayer = opts.createPlayer ?? defaultCreatePlayer;
  const configureAudioMode = opts.configureAudioMode ?? defaultConfigureAudioMode;
  const now = opts.now ?? (() => Date.now());

  let enabled = true;
  let volume = 0.6;
  const players = new Map<Cue, CuePlayer>();
  const lastPlayed = new Map<Cue, number>();

  return {
    async preload() {
      try {
        await configureAudioMode();
      } catch {
        /* keep the OS defaults — cues still play */
      }
      for (const cue of ALL_CUES) {
        if (players.has(cue)) continue;
        const p = createPlayer(CUE_ASSETS[cue]);
        if (p) players.set(cue, p);
      }
    },

    unlock() {},

    play(cue, gainScale = 1) {
      if (!enabled) return;
      const p = players.get(cue);
      if (!p) return;
      const def = CUES[cue];
      const t = now();
      if (t - (lastPlayed.get(cue) ?? -Infinity) < def.throttleMs) return;
      lastPlayed.set(cue, t);
      try {
        p.volume = Math.max(0, Math.min(1, def.gain * gainScale * volume));
        void p.seekTo(0);
        p.play();
      } catch {
        // expo-audio's play()/seekTo() are native sync calls that can throw (e.g. iOS audio
        // session activation failing under an interruption or background state) — a dropped
        // sound effect must never crash the screen it's decorating.
      }
    },

    setEnabled(on) {
      enabled = on;
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
    },
  };
}

/** App-wide singleton. Under jest (no native audio) every method is a safe no-op. */
export const soundPlayer = createSoundPlayer();
