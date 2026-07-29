import type { Cue } from './cues';

/**
 * The playback contract both clients implement — the ONLY part of the sound stack that is
 * platform-specific (Web Audio in `apps/web/src/sound/player.ts`, expo-audio in
 * `apps/mobile/src/sound/player.ts`). Everything above it — the cue catalog, the event→cue model,
 * the driver and setup hooks — is shared here, so a cue added to `CUES` sounds on both clients.
 *
 * Every method is best-effort and must never throw: audio is decoration, and a device that refuses
 * to give the app an output (autoplay lock, an OS interruption, silent mode) simply plays nothing.
 */
export interface SoundPlayer {
  /** Load/decode every cue. Idempotent — already-loaded cues are skipped. */
  preload(): Promise<void>;
  /**
   * Give the platform its user-gesture activation. Meaningful on web (autoplay policy); a no-op
   * on native, where playback needs no unlock.
   */
  unlock(): void;
  /** Play a cue now, at `CUES[cue].gain * gainScale * volume`, subject to the cue's throttle. */
  play(cue: Cue, gainScale?: number): void;
  /**
   * Schedule a cue to sound `inMs` from now on an audio clock that keeps time while the app is
   * unfocused, returning a cancel function. Implemented on web only, where setTimeout/rAF are
   * throttled to a crawl in hidden tabs — mobile leaves it undefined and drives the same cues off
   * the visible countdown's interval instead (see `useTurnCountdown`'s injected sounds).
   */
  schedule?(cue: Cue, inMs: number, gainScale?: number): () => void;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
}
