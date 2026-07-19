import {
  common,
  difficulty,
  eventsMode,
  game,
  gameSettings,
  room,
} from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/room';

export default {
  ...room,
  title: 'Room',
  code: 'Room code {{code}}',
  members: 'Players',
  you: common.you,
  shareLink: 'Share link',
  botName: game.botName,
  ...difficulty,
  ...gameSettings,
  ...eventsMode,
  leaveConfirmTitle: game.leaveConfirmTitle,
  leaveConfirmBody: game.leaveConfirmBody,
  cancel: common.cancel,
} satisfies TranslationShape<typeof zh>;
