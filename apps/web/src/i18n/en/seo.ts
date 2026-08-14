import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/seo';

// Per-route <title> / meta description (useDocumentMeta). Descriptions exist only for the
// indexable public pages — everything else is noindex.
export default {
  titles: {
    home: 'TRMission 鐵島企劃 — a Taiwan railway board game',
    login: 'Sign in · TRMission 鐵島企劃',
    tutorial: 'Tutorial · TRMission 鐵島企劃',
    history: 'Match history · TRMission 鐵島企劃',
    leaderboard: 'Leaderboard · TRMission 鐵島企劃',
    replay: 'Replay · TRMission 鐵島企劃',
    room: 'Room {{code}} · TRMission 鐵島企劃',
    game: 'Game in progress · TRMission 鐵島企劃',
    maps: 'Custom maps · TRMission 鐵島企劃',
    mapEditor: 'Map editor · TRMission 鐵島企劃',
    support: 'Help & support · TRMission 鐵島企劃',
    privacy: 'Privacy policy · TRMission 鐵島企劃',
    terms: 'Terms of service · TRMission 鐵島企劃',
    deleteAccount: 'Delete account · TRMission 鐵島企劃',
  },
  descriptions: {
    home: 'A free online multiplayer railway board game set in Taiwan: collect train-car cards, claim routes between cities, and complete mission tickets. Live games for 2–5 players plus team mode, bots to practise against, spectating, and replays.',
    login: 'Sign in to TRMission — play as a guest or with an email, Google, or Discord account.',
    tutorial:
      'A 5-minute interactive tutorial: learn drawing cards, claiming routes, and mission scoring. No sign-in needed.',
    support:
      'TRMission support: common questions, a contact form, the Discord community, and an email address — for bug reports, account help, and suggestions.',
    privacy:
      'The TRMission privacy policy: what data we collect, how it is used, and how to delete your account and data.',
    terms:
      'The TRMission terms of service: account rules, acceptable use, user-generated content, disclaimers, and how to reach us.',
  },
} satisfies TranslationShape<typeof zh>;
