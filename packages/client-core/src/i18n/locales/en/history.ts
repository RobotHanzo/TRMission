import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/history';

export default {
  title: 'Game history',
  empty: 'No finished games yet',
  rolePlayer: 'Player',
  roleSpectator: 'Spectator',
  watchReplay: 'Replay',
  replayDisabled: 'Replay viewing is not enabled for this account',
  notReplayable: 'Played on an older game version — replay unavailable',
  unknownMap: 'The map version this game used is not available',
  loadFailed: 'Could not load the game',
  wonBy: '{{name}} won',
  perspective: 'Perspective',
  publicView: 'Public view',
  step: 'Step {{n}} / {{total}}',
  turnOf: 'Turn {{n}} · {{name}}',
  openingDraft: 'Opening mission draft',
  beforeStart: 'Before the first move',
  prevTurn: 'Previous turn',
  nextTurn: 'Next turn',
  speed: 'Playback speed',
  speedTimes: '{{n}}× speed',
  backToHistory: 'Back to history',
  bot: 'Bot',
} satisfies TranslationShape<typeof zh>;
