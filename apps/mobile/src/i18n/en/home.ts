import { auth, home, room } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/home';

export default {
  ...home,
  title: 'TRMission',
  tab: 'Home',
  greeting: 'Hi, {{name}}',
  myRooms: 'Active rooms',
  publicRooms: room.publicRooms,
  noPublicRooms: room.noPublicRooms,
  watch: room.watch,
  joinPlaceholder: 'Room code',
  create: 'Create room',
  playBots: 'Play vs Bots',
  resumeOffline: 'Resume offline games',
  signOut: auth.signOut,
  play: {
    tutorialTitle: home.tutorialTitle,
    tutorialDesc: home.tutorialDesc,
  },
  welcome: {
    ...home.welcome,
    practiceDesc: 'Jump straight into an offline game against bots.',
    footnote: 'You can always revisit the tutorial later from the home screen.',
  },
} satisfies TranslationShape<typeof zh>;
