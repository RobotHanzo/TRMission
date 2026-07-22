import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/landing';

// The signed-out public homepage (issue #17): what the game is + two ways to board.
export default {
  eyebrow: 'An online multiplayer railway board game · free to play',
  title: 'Claim routes across Taiwan,\ncomplete your missions',
  lede: "TRMission is an online board game inspired by Taiwan's railways: collect train-car cards, claim the routes between cities, and link your mission tickets end to end. Play live with 2–5 players (or 4 and 6 in team mode), practise against bots, or spectate a friend's game.",
  departures: {
    title: 'Departures',
    tutorialDest: 'Tutorial',
    tutorialMeta: 'Interactive · about 5 minutes',
    tutorialStatus: 'No sign-in',
    playDest: 'Multiplayer',
    playMeta: 'Play as a guest or with an account',
  },
  how: {
    title: 'Each turn, pick one of three',
    lede: 'On your turn you take exactly one action. Restock your hand, grab a route, or gamble on a new mission — the trade-off is the strategy.',
    drawTitle: 'Draw train cards',
    drawDesc:
      'Refill your hand from the open market or the deck, collecting matching colours; rainbow cards are wild.',
    claimTitle: 'Claim a route',
    claimDesc:
      'Spend matching cards to lay your trains on a stretch between two cities — tunnels are a gamble, ferries demand rainbows.',
    ticketsTitle: 'Draw mission tickets',
    ticketsDesc:
      'Take on new city-to-city missions: completed ones score at the end, unfinished ones cost you.',
    scoring:
      'When the game ends, routes and missions are tallied and the longest continuous trail earns a bonus — the highest score wins.',
  },
  features: {
    title: 'More than a map',
    multiplayerTitle: 'Live multiplayer',
    multiplayerDesc:
      'Rooms for 2–5 players (4 or 6 in team mode) — share a room code to start, or join mid-game as a spectator.',
    botsTitle: 'Bots to practise with',
    botsDesc:
      'Computer players across several difficulties fill empty seats whenever you want a game.',
    learnTitle: 'Tutorial & rules encyclopedia',
    learnDesc:
      'A 5-minute interactive tutorial gets you playing; the encyclopedia answers rule questions with examples.',
    replayTitle: 'Match history & replays',
    replayDesc: 'Step through any finished game move by move, from any player’s perspective.',
    rulesTitle: 'Tunnels, ferries & stations',
    rulesDesc: 'Advanced route types and station borrowing make every stretch of track a decision.',
    themeTitle: 'Bilingual & themeable',
    themeDesc:
      'Traditional Chinese and English, light and dark themes, and a colour-blind friendly mode.',
  },
  account: {
    title: 'Accounts & your data',
    play: 'Free to play: a guest can create rooms and join friends’ games right away.',
    save: 'Signing in (email, Google, or Discord) keeps your match history and preferences, synced across devices.',
    google:
      'When you sign in with Google we only read your basic profile — display name, email, and avatar — to create your game account. No other permissions are requested.',
    privacyCta: 'Privacy policy',
    deleteCta: 'Delete your account & data',
  },
  discordSection: {
    title: 'Join the Discord',
    lede: 'Find people to play with, report bugs, and get an early look at new maps and features — players and developers hang out here.',
    cta: 'Join Discord',
  },
  langSwitch: '中文',
  footer: {
    disclaimer:
      'TRMission is an original fan-made game. It is not affiliated with or endorsed by the Taiwan Railways Corporation.',
  },
} satisfies TranslationShape<typeof zh>;
