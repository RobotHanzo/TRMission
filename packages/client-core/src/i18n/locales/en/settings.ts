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
  sound: 'Sound',
  volume: 'Volume',
  language: 'Language',
} satisfies TranslationShape<typeof zh>;
