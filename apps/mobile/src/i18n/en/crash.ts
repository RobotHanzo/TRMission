import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/crash';

export default {
  title: 'Something went wrong',
  body: 'The app hit an unexpected error. Try again — if it keeps happening, close and reopen the app.',
  retry: 'Try again',
} satisfies TranslationShape<typeof zh>;
