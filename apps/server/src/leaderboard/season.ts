// Seasons are stateless: a season "exists" the moment a game completes inside it — there is no
// season-config collection, no rollover job, no admin action. The all-time scope never resets;
// a season scope simply stops accumulating once its calendar month has passed and becomes a
// frozen historical snapshot.
export const ALL_TIME_SCOPE = 'allTime';

export const seasonScope = (seasonId: string): string => `season:${seasonId}`;

/** UTC calendar month, e.g. '2026-07'. */
export function currentSeasonId(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
