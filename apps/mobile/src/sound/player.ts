// The native implementation of the shared SoundPlayer contract (@trm/client-core/sound/player) —
// the only platform-specific piece of the sound stack; the cue table, event→cue model and driver
// hooks are shared with web. SDK 56 removed expo-av, so this is built on expo-audio: one
// AudioPlayer per cue, each play() rewinding to 0 at `def.gain * gainScale * masterVolume`.
// `schedule` stays unimplemented (no audio clock to hang it on, and native timers aren't
// tab-throttled): the countdown cues fire from useTurnCountdown's interval in
// components/game/TurnCountdown.tsx instead.
//
// Unlike web — where every cue is a decoded buffer on ONE shared AudioContext — an expo-audio
// AudioPlayer is a whole media pipeline: on Android each one is an ExoPlayer with its own
// MediaCodec decoder and AudioTrack output, about five OS threads apiece. Two rules follow, and
// both are load-bearing (TRMISSION-MOBILE-A was a background ANR on a process holding all fifteen):
//
//   1. Players are built LAZILY, on a cue's first play — never in `preload()`. `useSoundSetup`
//      runs at the app root, so preloading fifteen pipelines happened on every launch, including
//      the background launches (push wake, OTA check) that never show a frame: the ANR's thread
//      dump was 75 audio threads in a process sitting on `Boot` with `in_foreground: false`.
//   2. Everything is released when the app leaves the foreground, and cues don't sound there
//      either — a backgrounded process must not sit on decoders or talk over the user's music.
import { AppState } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { SoundPlayer } from '@trm/client-core/sound/player';
import { CUES, CUE_ASSETS, type Cue } from './cues';

export type { SoundPlayer };

/** The slice of expo-audio's AudioPlayer the factory drives (injectable in tests). */
export interface CuePlayer {
  volume: number;
  seekTo(seconds: number): Promise<void> | void;
  play(): void;
  /** expo-audio's `AudioPlayer.remove()` — frees the native decoder + output. */
  remove?(): void;
}

/** Foreground/background source, so the AppState wiring is injectable in tests. */
export interface AppStateSource {
  isActive(): boolean;
  subscribe(onChange: (active: boolean) => void): () => void;
}

interface Opts {
  /** Factory for a per-cue player (overridable in tests). Returns null when unavailable. */
  createPlayer?: (asset: number) => CuePlayer | null;
  /** Audio-session setup (overridable in tests). */
  configureAudioMode?: () => Promise<void>;
  /** Monotonic clock in ms (overridable in tests). */
  now?: () => number;
  /** App foreground state (overridable in tests). */
  appState?: AppStateSource;
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

// iOS reports `inactive` for a pulled-down notification shade or an incoming call screen; counting
// that as "not foreground" costs at most a dropped cue during those moments and keeps the rule for
// holding audio resources to one line.
//
// Asked the other way round on purpose: RN initialises `currentState` to `null` and fills it in
// asynchronously (see AppState.js's own "terrible solution" note), and the type admits `'unknown'`.
// Only a state that positively says we are away silences the player — an unknown one must not,
// or a cold start would swallow the cues fired before the native module answers.
const isForeground = (s: string | null | undefined): boolean =>
  s !== 'background' && s !== 'inactive';

const defaultAppState: AppStateSource = {
  isActive: () => isForeground(AppState.currentState),
  subscribe: (onChange) => {
    const sub = AppState.addEventListener('change', (s) => onChange(isForeground(s)));
    return () => sub.remove();
  },
};

export function createSoundPlayer(opts: Opts = {}): SoundPlayer {
  const createPlayer = opts.createPlayer ?? defaultCreatePlayer;
  const configureAudioMode = opts.configureAudioMode ?? defaultConfigureAudioMode;
  const now = opts.now ?? (() => Date.now());
  const appState = opts.appState ?? defaultAppState;

  let enabled = true;
  let volume = 0.6;
  let active = true;
  let unwatch: (() => void) | null = null;
  // `null` marks a cue whose player could not be built (no native audio) — distinct from `undefined`
  // ("not tried yet"), so a device without an audio output isn't re-probed on every single cue.
  const players = new Map<Cue, CuePlayer | null>();
  const lastPlayed = new Map<Cue, number>();

  const releaseAll = (): void => {
    for (const p of players.values()) {
      try {
        p?.remove?.();
      } catch {
        // A native teardown that fails still has its JS handle dropped below; nothing to retry.
      }
    }
    players.clear();
    lastPlayed.clear();
  };

  return {
    async preload() {
      // Deliberately allocates NO per-cue player (see the header) — all this readies is the audio
      // session, plus the foreground watch that decides when cues may sound and hold resources.
      // Subscribed once and never torn down: this is the app-wide singleton, so the watch is
      // meant to outlive every screen — `unwatch` exists to keep a second `preload()` (the driver
      // calls it too) from stacking a duplicate listener.
      if (!unwatch) {
        active = appState.isActive();
        unwatch = appState.subscribe((next) => {
          active = next;
          if (!next) releaseAll();
        });
      }
      try {
        await configureAudioMode();
      } catch {
        /* keep the OS defaults — cues still play */
      }
    },

    unlock() {},

    play(cue, gainScale = 1) {
      if (!enabled || !active) return;
      const def = CUES[cue];
      const t = now();
      if (t - (lastPlayed.get(cue) ?? -Infinity) < def.throttleMs) return;
      let p = players.get(cue);
      if (p === undefined) {
        // First play of this cue: build its pipeline now. expo-audio prepares asynchronously and
        // honours a `play()` issued before it is ready, so the sound lands a few ms late at worst.
        p = createPlayer(CUE_ASSETS[cue]);
        players.set(cue, p);
      }
      if (!p) return;
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
      if (!on) releaseAll();
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
    },
  };
}

/** App-wide singleton. Under jest (no native audio) every method is a safe no-op. */
export const soundPlayer = createSoundPlayer();
