import { chat } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/chat';

export default {
  ...chat,
  spectatorDisabled: "Spectators can't chat",
} satisfies TranslationShape<typeof zh>;
