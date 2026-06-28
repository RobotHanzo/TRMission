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
  | 'railwayBuilt';

export interface CueDef {
  /** Path under Vite's public/ root (served at this URL). */
  src: string;
  /** Base playback gain (0–1), multiplied by the master volume. */
  gain: number;
  /** Minimum ms between two plays of this cue; a play inside the window is dropped. */
  throttleMs: number;
}

export const CUES: Record<Cue, CueDef> = {
  cardDraw: { src: '/sounds/card-draw.mp3', gain: 0.8, throttleMs: 55 },
  yourTurn: { src: '/sounds/your-turn.mp3', gain: 0.9, throttleMs: 250 },
  tunnelDraw: { src: '/sounds/tunnel-draw.mp3', gain: 0.8, throttleMs: 0 },
  tunnelSuccess: { src: '/sounds/tunnel-success.mp3', gain: 0.9, throttleMs: 200 },
  tunnelPayment: { src: '/sounds/tunnel-payment.mp3', gain: 0.9, throttleMs: 200 },
  missionComplete: { src: '/sounds/mission-complete.mp3', gain: 1.0, throttleMs: 300 },
  gameOverWin: { src: '/sounds/game-over-win.mp3', gain: 1.0, throttleMs: 1000 },
  gameOverNormal: { src: '/sounds/game-over-normal.mp3', gain: 0.9, throttleMs: 1000 },
  stationBuilt: { src: '/sounds/station-built.mp3', gain: 0.9, throttleMs: 70 },
  railwayBuilt: { src: '/sounds/railway-built.mp3', gain: 0.9, throttleMs: 70 },
};

/** Gain multiplier for a cue triggered by an opponent's action (vs the local player's). */
export const OPPONENT_GAIN = 0.5;

export const ALL_CUES = Object.keys(CUES) as Cue[];
