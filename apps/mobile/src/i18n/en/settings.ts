import { settings } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/settings';

export default {
  ...settings,
  title: 'Settings',
  notifications: 'Push notifications',
  haptics: 'Haptic feedback',
  deleteAccount: 'Delete account',
  about: 'About',
  version: 'Version',
  commit: 'Commit',
  privacyPolicy: 'Privacy policy',
  crashReport: 'Share last crash report',
  deleteConfirmTitle: 'Delete your account?',
  deleteConfirmBody:
    'This cannot be undone. Your profile is deleted and match records are anonymized.',
  deleteConfirmAction: 'Delete forever',
  deleteFailed: 'Deletion failed. Maintainers must have dashboard access revoked first.',
  pushDeniedTitle: 'Notifications are blocked',
  pushDeniedBody: 'Allow notifications for TRMission in the system settings.',
  openSystemSettings: 'Open settings',
} satisfies TranslationShape<typeof zh>;
