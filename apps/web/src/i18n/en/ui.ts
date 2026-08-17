import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/ui';

export default {
  appName: 'TRMission',
  discord: 'Discord Community',
  appStoreBadgeAlt: 'Download on the App Store',
  settings: 'Settings',
  menu: 'Menu',
  back: 'Back',
  retry: 'Retry',
  somethingWentWrong: 'Something went wrong',
  delete: 'Delete',
  save: 'Save',
  copied: 'Copied',
  copyCode: 'Copy code',
  copyLink: 'Copy link',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  commsTabsLabel: 'Panel tabs',
  dockTabsLabel: 'Game panels',
} satisfies TranslationShape<typeof zh>;
