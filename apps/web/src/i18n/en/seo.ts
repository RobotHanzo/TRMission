import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/seo';

// Per-route <title> / meta description (useDocumentMeta). Descriptions exist only for the
// indexable public pages — everything else is noindex.
export default {
  titles: {
    home: 'TRMission 台鐵任務 — a Taiwan railway board game',
    login: 'Sign in · TRMission 台鐵任務',
    tutorial: 'Tutorial · TRMission 台鐵任務',
    history: 'Match history · TRMission 台鐵任務',
    replay: 'Replay · TRMission 台鐵任務',
    room: 'Room {{code}} · TRMission 台鐵任務',
    game: 'Game in progress · TRMission 台鐵任務',
    maps: 'Custom maps · TRMission 台鐵任務',
    mapEditor: 'Map editor · TRMission 台鐵任務',
    privacy: 'Privacy policy · TRMission 台鐵任務',
    deleteAccount: 'Delete account · TRMission 台鐵任務',
  },
  descriptions: {
    home: 'A free online multiplayer railway board game set in Taiwan: collect train-car cards, claim routes between cities, and complete mission tickets. Live games for 2–5 players plus team mode, bots to practise against, spectating, and replays.',
    login: 'Sign in to TRMission — play as a guest or with an email, Google, or Discord account.',
    tutorial:
      'A 5-minute interactive tutorial: learn drawing cards, claiming routes, and mission scoring. No sign-in needed.',
    privacy:
      'The TRMission privacy policy: what data we collect, how it is used, and how to delete your account and data.',
  },
} satisfies TranslationShape<typeof zh>;
