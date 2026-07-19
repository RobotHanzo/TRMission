import { game, history } from '@trm/client-core/i18n/locales/zh-Hant';

// The game screen section: mobile-only rows plus aliases into the shared game vocabulary
// (mobile also spreads the shared game namespace flat at the top level — see ./index.ts).
// sessionReplacedBody is intentionally platform-worded ("device" vs web's "tab").
export default {
  title: '遊戲',
  roomLabel: '房間 {{code}}',
  connecting: game.connecting,
  reconnecting: game.reconnecting,
  disconnected: game.disconnected,
  yourTurn: game.yourTurn,
  turnOf: game.turnOf,
  over: game.gameOver,
  offlineBanner: '目前離線',
  back: '返回',
  unknownMap: history.unknownMap,
  sessionReplacedTitle: game.sessionReplacedTitle,
  sessionReplacedBody: '你的座位已在另一個裝置或分頁上重新連線，此裝置已中斷連線。',
  sessionReplacedAck: game.sessionReplacedAck,
};
