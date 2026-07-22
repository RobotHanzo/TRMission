// Multiplayer pairwise Elo: each participant is compared against every OTHER participant as an
// independent 2-player Elo match using standard expectation, and the resulting score deltas are
// averaged over opponent count so the K-factor stays meaningful regardless of table size. Ties
// (equal rank — a co-winner equivalence group) score 0.5 rather than 1/0. A participant with no
// opponents (e.g. every other seat was a bot/guest, already filtered out by the caller) gets a
// delta of exactly 0 — no special-casing needed, the empty sum falls out of the formula itself.
export interface EloParticipant {
  readonly id: string;
  readonly rating: number;
  /** Games already played in this scope BEFORE this one — selects the provisional K-factor. */
  readonly gamesPlayed: number;
  /** 0-based place; ties (co-winners/co-losers) share the same rank. */
  readonly rank: number;
}

export const DEFAULT_ELO_RATING = 1500;

const PROVISIONAL_GAMES = 20;
const PROVISIONAL_K = 40;
const STABLE_K = 20;

const kFactorFor = (gamesPlayed: number): number =>
  gamesPlayed < PROVISIONAL_GAMES ? PROVISIONAL_K : STABLE_K;

/** id → signed rating delta (rounded to the nearest integer point). */
export function computeEloDeltas(participants: readonly EloParticipant[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const p of participants) {
    const opponents = participants.filter((o) => o.id !== p.id);
    if (opponents.length === 0) {
      deltas.set(p.id, 0);
      continue;
    }
    let scoreSum = 0;
    for (const o of opponents) {
      const expected = 1 / (1 + 10 ** ((o.rating - p.rating) / 400));
      const actual = p.rank < o.rank ? 1 : p.rank > o.rank ? 0 : 0.5;
      scoreSum += actual - expected;
    }
    deltas.set(p.id, Math.round((kFactorFor(p.gamesPlayed) * scoreSum) / opponents.length));
  }
  return deltas;
}
