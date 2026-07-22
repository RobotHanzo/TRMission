/**
 * Opaque (metric value, id) pagination cursor for leaderboard list endpoints — the same
 * (value, tiebreaker) idiom as `dashboard/cursor.ts`'s TimeCursor, generalized to a numeric
 * metric (rating/wins/gamesPlayed) instead of a timestamp. Malformed input decodes to null
 * (first page) rather than erroring — cursors are a convenience, not state.
 */
export interface RankCursor {
  v: number;
  id: string;
}

export const encodeRankCursor = (v: number, id: string): string =>
  Buffer.from(JSON.stringify({ v, id }), 'utf8').toString('base64url');

export const decodeRankCursor = (raw: string | undefined): RankCursor | null => {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { v?: unknown }).v !== 'number' ||
      typeof (parsed as { id?: unknown }).id !== 'string'
    ) {
      return null;
    }
    const { v, id } = parsed as { v: number; id: string };
    return { v, id };
  } catch {
    return null;
  }
};
