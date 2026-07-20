import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/ui';

export default {
  appName: 'TRMission',
  discord: 'Discord Community',
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
  hideAds: 'Hide ads',
  hideAdsDesc: 'Turn off advertisements across the site.',
} satisfies TranslationShape<typeof zh>;
