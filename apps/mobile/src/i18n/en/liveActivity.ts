import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/liveActivity';

// Kept short on purpose: the Dynamic Island's compact regions are a few characters wide.
export default {
  yourTurn: 'Your turn!',
  playerTurn: "{{name}}'s turn",
  trains: 'Trains',
  score: 'Points',
  lastRound: 'Last round',
  gameOver: 'Game over',
  waiting: 'Waiting',
} satisfies TranslationShape<typeof zh>;
