export type Cue =
  | 'cardDraw'
  | 'yourTurn'
  | 'tunnelDraw'
  | 'tunnelSuccess'
  | 'tunnelPayment'
  | 'missionComplete'
  | 'gameOverWin'
  | 'gameOverNormal'
  | 'stationBuilt'
  | 'railwayBuilt'
  | 'railRepaired'
  | 'eventStart'
  | 'chatMessage'
  | 'countdownWarning'
  | 'countdownLapsed';

export interface CueDef {
  /**
   * File name under this package's `assets/sounds/` — the single place a cue is bound to its
   * audio. Each app turns it into its own asset reference (a Vite-emitted URL on web, a Metro
   * asset module id on mobile); the files themselves are shared, so the two clients can never
   * drift onto different recordings of the same cue.
   */
  file: string;
  /** Base playback gain (0–1), multiplied by the master volume. */
  gain: number;
  /** Minimum ms between two plays of this cue; a play inside the window is dropped. */
  throttleMs: number;
}

export const CUES: Record<Cue, CueDef> = {
  cardDraw: { file: 'card-draw.mp3', gain: 0.8, throttleMs: 55 },
  yourTurn: { file: 'your-turn.mp3', gain: 0.9, throttleMs: 250 },
  tunnelDraw: { file: 'tunnel-draw.mp3', gain: 0.8, throttleMs: 0 },
  tunnelSuccess: { file: 'tunnel-success.mp3', gain: 0.9, throttleMs: 200 },
  tunnelPayment: { file: 'tunnel-payment.mp3', gain: 0.9, throttleMs: 200 },
  missionComplete: { file: 'mission-complete.mp3', gain: 1.0, throttleMs: 300 },
  gameOverWin: { file: 'game-over-win.mp3', gain: 1.0, throttleMs: 1000 },
  gameOverNormal: { file: 'game-over-normal.mp3', gain: 0.9, throttleMs: 1000 },
  stationBuilt: { file: 'station-built.mp3', gain: 0.9, throttleMs: 70 },
  railwayBuilt: { file: 'railway-built.mp3', gain: 0.9, throttleMs: 70 },
  railRepaired: { file: 'rail-repaired.mp3', gain: 0.9, throttleMs: 200 },
  eventStart: { file: 'event-start.mp3', gain: 1.0, throttleMs: 300 },
  chatMessage: { file: 'chat-message.mp3', gain: 0.7, throttleMs: 200 },
  // Per-turn countdown (issue #13): a tick each of the final seconds, a distinct tone when it lapses.
  countdownWarning: { file: 'countdown-warning.mp3', gain: 0.7, throttleMs: 500 },
  countdownLapsed: { file: 'countdown-lapsed.mp3', gain: 0.9, throttleMs: 500 },
};

/** Gain multiplier for a cue triggered by an opponent's action (vs the local player's). */
export const OPPONENT_GAIN = 0.5;

export const ALL_CUES = Object.keys(CUES) as Cue[];
