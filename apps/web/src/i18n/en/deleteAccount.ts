import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/deleteAccount';

export default {
  title: 'Delete account',
  signedInAs: 'Signed in as {{name}}',
  consequence1: 'Your account, sign-in methods, and all sessions will be permanently removed.',
  consequence2:
    'Your custom map drafts will be deleted (published content of already-played games is kept for replays).',
  consequence3: 'Finished-game records are kept anonymized (other players keep their history).',
  consequence4: 'This cannot be undone.',
  typeName: 'Type your display name "{{name}}" to confirm:',
  cancel: 'Cancel',
  confirm: 'Delete account permanently',
  maintainerBlocked:
    'This account still holds maintainer access. Revoke it from the dashboard first, then delete.',
  doneTitle: 'Account deleted',
  doneBody: 'Your account and personal data have been removed. Thanks for riding TRMission.',
} satisfies TranslationShape<typeof zh>;
