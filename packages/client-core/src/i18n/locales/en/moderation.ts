import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/moderation';
import common from './common';

export default {
  reportPlayer: 'Report player',
  blockPlayer: 'Block player',
  unblockPlayer: 'Unblock player',
  reportReason: 'Reason',
  reportMessage: 'Details (optional)',
  reportSubmit: 'Submit report',
  reportDone: 'Report received — we will review it soon.',
  reportFailed: 'Could not submit the report. Try again later.',
  blockedNotice: 'Blocked. You will no longer see this player’s messages or name.',
  cancel: common.cancel,
} satisfies TranslationShape<typeof zh>;
