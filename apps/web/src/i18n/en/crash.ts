import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/crash';

export default {
  title: 'Something went wrong',
  body: 'This page hit an unexpected error. Try again — if it keeps happening, reload the page.',
  retry: 'Try again',
  reload: 'Reload page',
  reference: 'Reference',
} satisfies TranslationShape<typeof zh>;
