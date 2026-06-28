import { ALL_CUES, CUES, type Cue } from './cues';

export interface SoundPlayer {
  preload(): Promise<void>;
  unlock(): void;
  play(cue: Cue, gainScale?: number): void;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
}

interface Opts {
  /** Factory for the AudioContext (overridable in tests). Returns null when unavailable. */
  createContext?: () => AudioContext | null;
  /** Monotonic clock in ms (overridable in tests). */
  now?: () => number;
}

const defaultCreateContext = (): AudioContext | null => {
  const g = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AC = g.AudioContext ?? g.webkitAudioContext;
  try {
    return AC ? new AC() : null;
  } catch {
    return null;
  }
};

export function createSoundPlayer(opts: Opts = {}): SoundPlayer {
  const createContext = opts.createContext ?? defaultCreateContext;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let triedContext = false;
  let enabled = true;
  let volume = 0.6;
  const buffers = new Map<Cue, AudioBuffer>();
  const lastPlayed = new Map<Cue, number>();

  const ensureContext = (): AudioContext | null => {
    if (ctx || triedContext) return ctx;
    triedContext = true;
    ctx = createContext();
    if (ctx) {
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    return ctx;
  };

  return {
    async preload() {
      const c = ensureContext();
      if (!c) return;
      await Promise.all(
        ALL_CUES.map(async (cue) => {
          if (buffers.has(cue)) return;
          try {
            const res = await fetch(CUES[cue].src);
            const arr = await res.arrayBuffer();
            buffers.set(cue, await c.decodeAudioData(arr));
          } catch {
            /* leave undecoded — that cue simply won't play */
          }
        }),
      );
    },

    unlock() {
      const c = ensureContext();
      if (c && c.state === 'suspended') void c.resume();
    },

    play(cue, gainScale = 1) {
      if (!enabled) return;
      const c = ctx;
      if (!c || !master) return;
      const def = CUES[cue];
      const t = now();
      if (t - (lastPlayed.get(cue) ?? -Infinity) < def.throttleMs) return;
      const buf = buffers.get(cue);
      if (!buf) return;
      lastPlayed.set(cue, t);
      if (c.state === 'suspended') void c.resume();
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = def.gain * gainScale;
      src.connect(g).connect(master);
      src.start();
    },

    setEnabled(on) {
      enabled = on;
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = volume;
    },
  };
}

/** App-wide singleton. In jsdom (no AudioContext) every method is a safe no-op. */
export const soundPlayer = createSoundPlayer();
