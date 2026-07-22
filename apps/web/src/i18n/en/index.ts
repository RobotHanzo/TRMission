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
} from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zhHant from '../zh-Hant';
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

// Mirrors ../zh-Hant/index.ts (the satisfies clause keeps the two languages key-identical).
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
} satisfies TranslationShape<typeof zhHant>;
