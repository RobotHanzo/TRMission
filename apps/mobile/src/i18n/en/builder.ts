import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/builder';

export default {
  title: 'Map Studio',
  entry: 'Map Studio',
  offlineTitle: 'You are offline',
  offlineBody: 'The map studio runs on the live website and needs a connection.',
  errorTitle: 'Could not open the map studio',
  errorBody: 'The session handoff failed — please try again.',
} satisfies TranslationShape<typeof zh>;
