import { ALL_CUES, CUES, type Cue } from './cues';

export interface SoundPlayer {
  preload(): Promise<void>;
  unlock(): void;
  play(cue: Cue, gainScale?: number): void;
  /**
   * Schedule a cue to sound `inMs` from now on the AudioContext clock. Unlike setTimeout/rAF,
   * the audio clock is NOT throttled in hidden/minimized tabs, so a pre-scheduled cue lands on
   * time while the site is unfocused. Returns a cancel function (a no-op when nothing could be
   * scheduled — no context, context not running, cue not decoded, or sound disabled).
   */
  schedule(cue: Cue, inMs: number, gainScale?: number): () => void;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
}

interface Opts {
  /** Factory for the AudioContext (overridable in tests). Returns null when unavailable. */
  createContext?: () => AudioContext | null;
  /** Monotonic clock in ms (overridable in tests). */
  now?: () => number;
}

/**
 * A cue requested while the context was suspended (autoplay-locked, or an OS interruption) plays
 * only if the context comes back within this window — beyond it the moment has passed and
 * replaying it (possibly minutes later, on the unlocking click) is just noise.
 */
const RESUME_GRACE_MS = 2500;

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
  /** Cancel fns for cues scheduled ahead on the audio clock (cancelled when sound is disabled). */
  const scheduledCancels = new Set<() => void>();

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
      const m = master;
      if (!c || !m) return;
      const def = CUES[cue];
      const t = now();
      if (t - (lastPlayed.get(cue) ?? -Infinity) < def.throttleMs) return;
      const buf = buffers.get(cue);
      if (!buf) return;
      const start = () => {
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = def.gain * gainScale;
        src.connect(g).connect(m);
        src.start();
      };
      if (c.state === 'running') {
        lastPlayed.set(cue, t);
        start();
        return;
      }
      // Not running (autoplay-locked, or an OS interruption): request a resume now, but never
      // start the source while suspended — a source started on a suspended context stays queued
      // and every queued source blasts at once whenever the context finally resumes. Play only
      // if the resume lands while the cue is still fresh; a dropped cue is NOT charged to the
      // throttle window, so it can't swallow the next real play after the context comes back.
      let resumed: Promise<void>;
      try {
        resumed = c.resume();
      } catch {
        return;
      }
      void resumed
        .then(() => {
          if (!enabled || c.state !== 'running') return;
          const rt = now();
          if (rt - t > RESUME_GRACE_MS) return;
          if (rt - (lastPlayed.get(cue) ?? -Infinity) < def.throttleMs) return;
          lastPlayed.set(cue, rt);
          start();
        })
        .catch(() => {
          /* resume rejected (no user activation yet) — cue dropped */
        });
    },

    schedule(cue, inMs, gainScale = 1) {
      const noop = () => {};
      if (!enabled) return noop;
      const c = ctx;
      const m = master;
      // Only a running context can honour a future start time; a locked context couldn't sound
      // the cue anyway, and its frozen clock would fire everything late on resume.
      if (!c || !m || c.state !== 'running') return noop;
      const buf = buffers.get(cue);
      if (!buf) return noop;
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = CUES[cue].gain * gainScale;
      src.connect(g).connect(m);
      src.start(c.currentTime + Math.max(0, inMs) / 1000);
      const cancel = () => {
        scheduledCancels.delete(cancel);
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        src.disconnect();
      };
      scheduledCancels.add(cancel);
      src.onended = () => scheduledCancels.delete(cancel);
      return cancel;
    },

    setEnabled(on) {
      enabled = on;
      if (!on) for (const cancel of [...scheduledCancels]) cancel();
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = volume;
    },
  };
}

/** App-wide singleton. In jsdom (no AudioContext) every method is a safe no-op. */
export const soundPlayer = createSoundPlayer();
