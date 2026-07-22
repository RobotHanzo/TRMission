// Reduces a completed game's FinalScoreboard into rating units, team-aware: a free-for-all game
// yields one unit per rated player; a team game yields one unit per team (its members ranked by
// the TEAM's placement, not individual score), mirroring the engine's own "team is a unit" model
// (packages/engine/src/teams.ts). Units with no rated members (every seat was a bot/guest) are
// dropped — they never enter the Elo comparison.
import type { FinalScoreboard } from '@trm/engine';

export interface RatingUnit {
  readonly key: string;
  readonly memberUserIds: readonly string[];
  /** 0-based place; ties share rank. */
  readonly rank: number;
}

export function ratingUnits(scores: FinalScoreboard, ratedIds: ReadonlySet<string>): RatingUnit[] {
  if (scores.teams && scores.teamRanking) {
    const teamRank = new Map<number, number>();
    scores.teamRanking.forEach((group, i) => group.forEach((team) => teamRank.set(team, i)));
    return scores.teams
      .map((team) => ({
        key: `team:${team.team}`,
        memberUserIds: team.members.map((id) => id as string).filter((id) => ratedIds.has(id)),
        rank: teamRank.get(team.team) ?? scores.teamRanking!.length,
      }))
      .filter((unit) => unit.memberUserIds.length > 0);
  }
  const rank = new Map<string, number>();
  scores.ranking.forEach((group, i) => group.forEach((id) => rank.set(id as string, i)));
  return [...ratedIds].map((id) => ({
    key: id,
    memberUserIds: [id],
    rank: rank.get(id) ?? scores.ranking.length,
  }));
}
