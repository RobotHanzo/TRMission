import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/boot';

export default {
  updateTitle: 'Update required',
  updateBody: 'Please update to the latest version to continue.',
} satisfies TranslationShape<typeof zh>;
