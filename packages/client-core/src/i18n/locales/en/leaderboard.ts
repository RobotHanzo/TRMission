import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/leaderboard';

export default {
  title: 'Leaderboard',
  scopeAllTime: 'All-Time',
  scopeSeason: 'This Season',
  metricRating: 'Rating',
  metricWins: 'Wins',
  metricGamesPlayed: 'Games Played',
  colRank: 'Rank',
  colPlayer: 'Player',
  colRating: 'Rating',
  colWins: 'W',
  colLosses: 'L',
  colGamesPlayed: 'Games',
  you: 'You',
  yourRank: 'Your rank: #{{rank}}',
  notRankedYet: 'Finish a game to get ranked',
  empty: 'No leaderboard data yet',
  loadFailed: 'Could not load the leaderboard',
  loadMore: 'Load more',
} satisfies TranslationShape<typeof zh>;
