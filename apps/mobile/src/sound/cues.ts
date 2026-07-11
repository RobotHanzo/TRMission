// Ported from apps/web/src/sound/cues.ts — the same cue vocabulary and gain/throttle table (these
// values are the binding contract the tests pin). The web's public-URL `src` becomes a bundled
// asset map: Metro packages the mp3s (copied from apps/web/public/sounds) into the app and each
// import resolves to an asset module id (see src/types/assets.d.ts).
import cardDraw from '../../assets/sounds/card-draw.mp3';
import yourTurn from '../../assets/sounds/your-turn.mp3';
import tunnelDraw from '../../assets/sounds/tunnel-draw.mp3';
import tunnelSuccess from '../../assets/sounds/tunnel-success.mp3';
import tunnelPayment from '../../assets/sounds/tunnel-payment.mp3';
import missionComplete from '../../assets/sounds/mission-complete.mp3';
import gameOverWin from '../../assets/sounds/game-over-win.mp3';
import gameOverNormal from '../../assets/sounds/game-over-normal.mp3';
import stationBuilt from '../../assets/sounds/station-built.mp3';
import railwayBuilt from '../../assets/sounds/railway-built.mp3';
import eventStart from '../../assets/sounds/event-start.mp3';
import chatMessage from '../../assets/sounds/chat-message.mp3';

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
  | 'eventStart'
  | 'chatMessage';

export interface CueDef {
  /** Base playback gain (0–1), multiplied by the master volume. */
  gain: number;
  /** Minimum ms between two plays of this cue; a play inside the window is dropped. */
  throttleMs: number;
}

export const CUES: Record<Cue, CueDef> = {
  cardDraw: { gain: 0.8, throttleMs: 55 },
  yourTurn: { gain: 0.9, throttleMs: 250 },
  tunnelDraw: { gain: 0.8, throttleMs: 0 },
  tunnelSuccess: { gain: 0.9, throttleMs: 200 },
  tunnelPayment: { gain: 0.9, throttleMs: 200 },
  missionComplete: { gain: 1.0, throttleMs: 300 },
  gameOverWin: { gain: 1.0, throttleMs: 1000 },
  gameOverNormal: { gain: 0.9, throttleMs: 1000 },
  stationBuilt: { gain: 0.9, throttleMs: 70 },
  railwayBuilt: { gain: 0.9, throttleMs: 70 },
  eventStart: { gain: 1.0, throttleMs: 300 },
  chatMessage: { gain: 0.7, throttleMs: 200 },
};

/** Bundled audio assets, one per cue (each import resolves to a Metro asset module id). */
export const CUE_ASSETS: Record<Cue, number> = {
  cardDraw,
  yourTurn,
  tunnelDraw,
  tunnelSuccess,
  tunnelPayment,
  missionComplete,
  gameOverWin,
  gameOverNormal,
  stationBuilt,
  railwayBuilt,
  eventStart,
  chatMessage,
};

/** Gain multiplier for a cue triggered by an opponent's action (vs the local player's). */
export const OPPONENT_GAIN = 0.5;

export const ALL_CUES = Object.keys(CUES) as Cue[];
