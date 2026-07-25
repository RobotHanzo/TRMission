import { auth, settings } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/settings';

export default {
  ...settings,
  title: 'Settings',
  indexHint: 'Every group shows what it is set to right now.',
  // Index groups
  playGroup: 'Playing',
  appGroup: 'App',
  accountGroup: 'Account',
  soundGroup: 'Sound & haptics',
  boardGroup: 'Board',
  adsGroup: 'Ads & privacy',
  hapticsGroup: 'Haptics',
  on: 'On',
  off: 'Off',
  // Appearance
  theme: 'Theme',
  layoutHint: 'Which side of the game screen the controls sit on.',
  // Sound & haptics
  hapticsHint:
    'A short buzz when you claim a route, reveal a tunnel, finish a mission, or the game ends.',
  haptics: 'Haptic feedback',
  // Notifications
  notifications: 'Push notifications',
  notificationsHint: 'Tells you when it is your turn and when a game starts or ends.',
  notificationsFootnote:
    'Notifications come straight from the server. Turning this off unregisters this device.',
  onlyWhenAway: 'Only notify me when away',
  onlyWhenAwayShort: 'Only when away',
  onlyWhenAwayHint:
    'Stay quiet while the app is open. Notifications arrive as usual once you leave.',
  liveActivities: 'Live Activity',
  liveActivitiesHint:
    'Show the game on your lock screen and Dynamic Island, so you can see at a glance when it is your turn.',
  // Account
  signOut: auth.signOut,
  signedOut: 'Not signed in',
  guestAccount: 'Guest account',
  memberAccount: 'Registered account',
  guestFootnote:
    'A guest account lives on this device only — sign out and it is gone. Upgrade it from the home screen.',
  deleteAccount: 'Delete account',
  deleteFootnote: 'Deleting cannot be undone.',
  // Ads & privacy
  adsFootnote: 'Ads appear on browsing screens only, never during a game.',
  // About
  about: 'About',
  version: 'Version',
  commit: 'Commit',
  privacyPolicy: 'Privacy policy',
  termsOfService: auth.termsOfService,
  adPrivacy: 'Ad privacy options',
  crashReport: 'Share last crash report',
  crashReportHint: 'Send a maintainer the technical details of the last crash.',
  // Check for updates (OTA)
  checkForUpdates: 'Check for updates',
  updateUpToDate: 'Up to date',
  updateFailed: 'Check failed',
  updateUnavailable: 'Not in this build',
  updateRestart: 'Restart to apply',
  updateReadyTitle: 'Update downloaded',
  updateReadyBody: 'Restart the app to apply this update.',
  updateLater: 'Later',
  updateRestartNow: 'Restart now',
  updatesFootnote:
    'The app checks for updates every time it starts. An update changes the app itself — no new store download needed.',
  deleteConfirmTitle: 'Delete your account?',
  deleteConfirmBody:
    'This cannot be undone. Your profile is deleted and match records are anonymized.',
  deleteConfirmAction: 'Delete forever',
  deleteFailed: 'Deletion failed. Maintainers must have dashboard access revoked first.',
  pushDeniedTitle: 'Notifications are blocked',
  pushDeniedBody: 'Allow notifications for TRMission in the system settings.',
  openSystemSettings: 'Open settings',
} satisfies TranslationShape<typeof zh>;
