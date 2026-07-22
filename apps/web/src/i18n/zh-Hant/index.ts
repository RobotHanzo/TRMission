import {
  auth,
  board,
  common,
  difficulty,
  errors,
  events,
  eventsMode,
  game,
  gameSettings,
  leaderboard,
  report,
  room,
  settings,
  tutorial,
} from '@trm/client-core/i18n/locales/zh-Hant';
import authWeb from './auth';
import builder from './builder';
import chat from './chat';
import deleteAccount from './deleteAccount';
import gameWeb from './game';
import history from './history';
import home from './home';
import landing from './landing';
import lobby from './lobby';
import log from './log';
import seo from './seo';
import ui from './ui';

// Composes the zh-Hant translation table from the shared namespaces (client-core) and the
// web-only ones in this folder. Web keeps its historical flat key layout, so shared namespaces
// are spread at the top level; sectioned namespaces stay nested objects.
export default {
  tutorial,
  ...common,
  ...ui,
  seo,
  ...settings,
  ...auth,
  ...authWeb,
  home,
  landing,
  ...difficulty,
  ...gameSettings,
  ...eventsMode,
  ...lobby,
  ...room,
  ...board,
  ...game,
  ...gameWeb,
  events,
  errors,
  log,
  chat,
  report,
  history,
  leaderboard,
  deleteAccount,
  builder,
};
