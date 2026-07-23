import { difficulty, eventsMode, gameSettings } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/offline';

export default {
  newGame: 'New offline game',
  map: 'Map',
  botCount: 'Bots',
  difficulty: 'Difficulty',
  difficultyEASY: difficulty.difficulty_EASY,
  difficultyMEDIUM: difficulty.difficulty_MEDIUM,
  difficultyHARD: difficulty.difficulty_HARD,
  difficultyHELL: difficulty.difficulty_HELL,
  events: gameSettings.settingRandomEvents,
  eventsDesc: gameSettings.settingRandomEventsDesc,
  ...eventsMode,
  start: 'Start game',
  botsN: '{{count}} bot(s)',
  inProgress: 'In progress',
  delete: 'Delete',
  deleteConfirmTitle: 'Delete this offline game?',
  deleteConfirmBody: 'Its progress will be permanently lost.',
  playAgain: 'Play again',
  backHome: 'Back to home',
  cantSave:
    "Progress can't be saved — you can keep playing, but this game will be lost when the app closes.",
  resumeTruncated: 'Corrupted save detected — restored to the last intact turn.',
  incompatible: "This save was created by an incompatible app version and can't be resumed.",
  loadFailed: "Couldn't load this offline game.",
  banner: "You're offline — online features are paused; offline play and the tutorial still work.",
} satisfies TranslationShape<typeof zh>;
