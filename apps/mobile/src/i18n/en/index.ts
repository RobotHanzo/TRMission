import {
  board,
  common,
  difficulty,
  errors,
  events,
  eventsMode,
  game as gameShared,
  history,
  leaderboard,
  report,
  tutorial,
} from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zhHant from '../zh-Hant';
import boot from './boot';
import builder from './builder';
import chat from './chat';
import crash from './crash';
import game from './game';
import home from './home';
import log from './log';
import login from './login';
import moderation from './moderation';
import offline from './offline';
import push from './push';
import room from './room';
import settings from './settings';
import ui from './ui';

// Mirrors ../zh-Hant/index.ts (the satisfies clause keeps the two languages key-identical).
export default {
  tutorial,
  ...common,
  ...gameShared,
  ...difficulty,
  ...eventsMode,
  ...ui,
  home,
  common: { cancel: common.cancel },
  moderation,
  report,
  settings,
  push,
  builder,
  offline,
  login,
  history,
  leaderboard,
  room,
  game,
  board,
  chat,
  log,
  events,
  errors,
  boot,
  crash,
} satisfies TranslationShape<typeof zhHant>;
