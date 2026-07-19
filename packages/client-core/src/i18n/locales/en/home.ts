import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/home';
import common from './common';

export default {
  join: 'Join',
  playersCount: '{{n}} / {{max}} players',
  statusLobby: 'Lobby',
  statusPlaying: 'Playing',
  tutorialTitle: 'Revisit the tutorial',
  tutorialDesc: 'A 5-minute interactive walkthrough',
  welcome: {
    title: 'Welcome aboard, {{name}}',
    subtitle:
      'Claim railway routes across Taiwan and complete your mission tickets. First time here? Spend five minutes learning the ropes, or just hop on and figure it out as you go — you can switch between the two anytime.',
    learnTitle: 'Learn to play',
    learnDesc:
      'Follow a 5-minute interactive tutorial to learn routes, mission tickets, and scoring step by step.',
    learnCta: 'Start tutorial',
    practiceTitle: 'Practice with bots',
    practiceCta: 'Start practising',
    skipTitle: 'Jump right in',
    skipDesc: 'Skip the tutorial and create a room right away — you can learn as you play.',
    skipCta: 'Go to homepage',
    discordCta: common.discordCta,
  },
  tutorialRecommend: {
    title: 'Want to try the tutorial first?',
    body: "You haven't finished the tutorial yet. We recommend spending 5 minutes on it first, but you can always start it later too.",
    goToTutorial: 'Go to tutorial',
    continueAnyway: 'Continue anyway',
  },
} satisfies TranslationShape<typeof zh>;
