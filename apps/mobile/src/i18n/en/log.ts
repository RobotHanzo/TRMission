import { log } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/log';

export default {
  ...log,
  jumpToLatest: 'Jump to latest',
} satisfies TranslationShape<typeof zh>;
