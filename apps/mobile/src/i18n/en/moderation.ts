import { common } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/moderation';

export default {
  reportPlayer: 'Report player',
  blockPlayer: 'Block player',
  unblockPlayer: 'Unblock player',
  reportReason: 'Reason',
  reportMessage: 'Details (optional)',
  reportSubmit: 'Submit report',
  reportDone: 'Report received — we will review it soon.',
  reportFailed: 'Could not submit the report. Try again later.',
  cancel: common.cancel,
} satisfies TranslationShape<typeof zh>;
