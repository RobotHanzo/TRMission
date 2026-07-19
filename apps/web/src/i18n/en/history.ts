import { history } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/history';

export default {
  ...history,
  share: 'Share replay',
  visibilityPrivate: 'Private',
  visibilityLink: 'Link',
  visibilityHintPrivate: 'Only players and spectators of this game can watch',
  visibilityHintLink: 'Anyone with the link can watch',
  visibilityFailed: 'Could not update replay visibility',
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  signInToView: 'Sign in to watch this replay',
  signIn: 'Sign in',
  terminatedReplayNotice:
    'This game was force-terminated by a maintainer — the replay only shows progress up to that point, with no final score.',
  completedReplayNotice: 'Maintainer view of a completed game.',
  spectateEndedNotice: 'You stopped spectating.',
} satisfies TranslationShape<typeof zh>;
