import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/appPrompt';

// The mobile-browser "get the app" sheet (issue #106) — an offer, not a gate.
export default {
  title: 'Get the app',
  lede: 'TRMission has a native app for iPhone and iPad. The browser gives you the full game too — your choice.',
  turnPush: 'A notification when it’s your turn, so you needn’t watch the screen',
  offline: 'Play solo against bots with no connection at all',
  synced: 'The same account: match history and settings stay in sync',
  continueWeb: 'Keep playing in the browser',
} satisfies TranslationShape<typeof zh>;
