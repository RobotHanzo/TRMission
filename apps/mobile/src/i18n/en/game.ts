import { game, history } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/game';

export default {
  title: 'Game',
  roomLabel: 'Room {{code}}',
  connecting: game.connecting,
  reconnecting: game.reconnecting,
  disconnected: game.disconnected,
  yourTurn: game.yourTurn,
  turnOf: game.turnOf,
  over: game.gameOver,
  offlineBanner: "You're offline",
  back: 'Back',
  unknownMap: history.unknownMap,
  sessionReplacedTitle: game.sessionReplacedTitle,
  sessionReplacedBody:
    'Your seat reconnected on another device or tab, so this one was disconnected.',
  sessionReplacedAck: game.sessionReplacedAck,
} satisfies TranslationShape<typeof zh>;
