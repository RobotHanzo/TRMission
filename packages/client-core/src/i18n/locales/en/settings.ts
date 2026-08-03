import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/settings';

export default {
  appearance: 'Appearance',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  colorBlind: 'Colour-blind friendly',
  colorBlindDesc: 'Show symbols on routes instead of relying on colour alone.',
  layout: 'Layout',
  layoutRail: 'Right rail',
  layoutTray: 'Bottom tray',
  trainCarSkin: 'Train card art',
  trainCarSkinDesc: 'Which artwork the train-car cards wear. Cosmetic — only you see it.',
  sound: 'Sound',
  volume: 'Volume',
  language: 'Language',
  hideAds: 'Hide ads',
  hideAdsDesc: 'Turn off advertisements.',
} satisfies TranslationShape<typeof zh>;
