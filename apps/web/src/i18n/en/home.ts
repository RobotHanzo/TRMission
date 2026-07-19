import { auth, home } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/home';

export default {
  ...home,
  welcomeBack: 'Welcome back, {{name}}',
  activeRoomEyebrow: 'Waiting for you · room in progress',
  rejoin: 'Return to room {{code}}',
  roomsCount: '{{n}} open',
  encyclopediaDesc: 'Look up any rule, any time',
  guestNotice: auth.guestNotice,
  welcome: {
    ...home.welcome,
    practiceDesc:
      'Jump straight into a game with default rules against one easy and one medium bot.',
    practiceStarting: 'Starting…',
    practiceError: 'Could not start the practice game. Please try again.',
    footnote: 'You can always revisit the tutorial later from the "Rules" button up top.',
  },
} satisfies TranslationShape<typeof zh>;
