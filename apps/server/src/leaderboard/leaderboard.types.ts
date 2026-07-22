/** One row per (userId, scope) — scope is 'allTime' or `season:${YYYY-MM}` (see season.ts). */
export interface PlayerStatsDoc {
  _id: string; // `${userId}:${scope}`
  userId: string;
  scope: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  /** Optimistic-concurrency counter for the read-modify-write rating update. */
  version: number;
  updatedAt: Date;
}

/** Idempotency guard: a gameId can be inserted here at most once (unique _id), so `onGameOver`
 *  is safe to call speculatively (including on a maintainer-terminated game, or more than once
 *  for the same game) without double-applying stats. */
export interface LeaderboardClaimDoc {
  _id: string; // gameId
  claimedAt: Date;
}

export const LEADERBOARD_METRICS = ['rating', 'wins', 'gamesPlayed'] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

export const LEADERBOARD_SCOPE_KINDS = ['allTime', 'season'] as const;
export type LeaderboardScopeKind = (typeof LEADERBOARD_SCOPE_KINDS)[number];
