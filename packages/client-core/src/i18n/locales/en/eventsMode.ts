import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/eventsMode';

export default {
  eventsMode_off: 'Off',
  eventsMode_light: 'Light',
  eventsMode_moderate: 'Moderate',
  eventsMode_intense: 'Intense',
} satisfies TranslationShape<typeof zh>;
