import {
  common,
  difficulty,
  eventsMode,
  game,
  gameSettings,
  room,
} from '@trm/client-core/i18n/locales/zh-Hant';

// The room screen: the shared room vocabulary plus mobile-only rows and a few aliases into
// other shared namespaces (mobile nests everything under `room.`).
export default {
  ...room,
  title: '房間',
  code: '房間代碼 {{code}}',
  members: '玩家',
  you: common.you,
  shareLink: '分享連結',
  botName: game.botName,
  ...difficulty,
  ...gameSettings,
  ...eventsMode,
  leaveConfirmTitle: game.leaveConfirmTitle,
  leaveConfirmBody: game.leaveConfirmBody,
  cancel: common.cancel,
};
