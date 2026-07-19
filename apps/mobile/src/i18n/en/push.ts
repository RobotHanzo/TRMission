import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/push';

export default {
  promptTitle: 'Get turn reminders?',
  promptBody:
    "We'll notify you when it's your turn, or when a game starts or ends — even when the app is in the background.",
  promptAccept: 'Enable notifications',
  promptDismiss: 'Not now',
} satisfies TranslationShape<typeof zh>;
