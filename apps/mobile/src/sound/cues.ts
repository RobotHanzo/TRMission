// The cue vocabulary + gain/throttle table are shared with web (@trm/client-core/sound/cues);
// only the asset binding is native-specific. Metro packages the shared mp3s into the app and each
// import resolves to an asset module id (see src/types/assets.d.ts).
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
  railRepaired,
  eventStart,
  chatMessage,
  countdownWarning,
  countdownLapsed,
};
