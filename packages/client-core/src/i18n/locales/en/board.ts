import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/board';

export default {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset view',
  followView: "Follow the current player's view",
  stopFollowing: 'Stop following',
} satisfies TranslationShape<typeof zh>;
