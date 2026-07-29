// The cue vocabulary + gain/throttle table are shared with mobile (@trm/client-core/sound/cues);
// only the asset binding is web-specific. Vite emits each mp3 from the shared assets folder as a
// hashed URL, which the Web Audio player fetches + decodes.
import cardDraw from '@trm/client-core/assets/sounds/card-draw.mp3';
import yourTurn from '@trm/client-core/assets/sounds/your-turn.mp3';
import tunnelDraw from '@trm/client-core/assets/sounds/tunnel-draw.mp3';
import tunnelSuccess from '@trm/client-core/assets/sounds/tunnel-success.mp3';
import tunnelPayment from '@trm/client-core/assets/sounds/tunnel-payment.mp3';
import missionComplete from '@trm/client-core/assets/sounds/mission-complete.mp3';
import gameOverWin from '@trm/client-core/assets/sounds/game-over-win.mp3';
import gameOverNormal from '@trm/client-core/assets/sounds/game-over-normal.mp3';
import stationBuilt from '@trm/client-core/assets/sounds/station-built.mp3';
import railwayBuilt from '@trm/client-core/assets/sounds/railway-built.mp3';
import railRepaired from '@trm/client-core/assets/sounds/rail-repaired.mp3';
import eventStart from '@trm/client-core/assets/sounds/event-start.mp3';
import chatMessage from '@trm/client-core/assets/sounds/chat-message.mp3';
import countdownWarning from '@trm/client-core/assets/sounds/countdown-warning.mp3';
import countdownLapsed from '@trm/client-core/assets/sounds/countdown-lapsed.mp3';
import type { Cue } from '@trm/client-core/sound/cues';

export * from '@trm/client-core/sound/cues';

/** Served URL for each cue's audio (one static import per cue, so Rollup emits them all). */
export const CUE_URLS: Record<Cue, string> = {
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
  railRepaired,
  eventStart,
  chatMessage,
  countdownWarning,
  countdownLapsed,
};
