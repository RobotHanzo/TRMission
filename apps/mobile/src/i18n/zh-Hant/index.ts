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
} from '@trm/client-core/i18n/locales/zh-Hant';
import boot from './boot';
import builder from './builder';
import chat from './chat';
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

// Composes the zh-Hant translation table from the shared namespaces (client-core) and the
// mobile-only ones in this folder. Mobile keeps its historical layout: the shared game
// vocabulary is spread flat at the top level, screens are nested sections.
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
};
