import { describe, it, expect } from 'vitest';
import { computeEloDeltas, DEFAULT_ELO_RATING, type EloParticipant } from '../src/leaderboard/elo';
import { ratingUnits } from '../src/leaderboard/rating-units';
import type { FinalScoreboard } from '@trm/engine';

const p = (id: string, rank: number, gamesPlayed = 0): EloParticipant => ({
  id,
  rating: DEFAULT_ELO_RATING,
  gamesPlayed,
  rank,
});

describe('computeEloDeltas', () => {
  it('splits a 2-player equal-rating win symmetrically at the provisional K', () => {
    const deltas = computeEloDeltas([p('a', 0), p('b', 1)]);
    expect(deltas.get('a')).toBe(20);
    expect(deltas.get('b')).toBe(-20);
  });

  it('gives a tie (equal rank) a zero delta for equal ratings', () => {
    const deltas = computeEloDeltas([p('a', 0), p('b', 0)]);
    expect(deltas.get('a')).toBe(0);
    expect(deltas.get('b')).toBe(0);
  });

  it('averages a 3-player free-for-all correctly (winner up, loser down, middle flat)', () => {
    const deltas = computeEloDeltas([p('a', 0), p('b', 1), p('c', 2)]);
    expect(deltas.get('a')).toBe(20);
    expect(deltas.get('b')).toBe(0);
    expect(deltas.get('c')).toBe(-20);
  });

  it('drops to the stable K-factor once a scope has 20+ prior games', () => {
    const deltas = computeEloDeltas([p('a', 0, 20), p('b', 1, 0)]);
    expect(deltas.get('a')).toBe(10); // stable K=20 for a, still provisional-scale opponent for b
  });

  it('gives a delta of exactly 0 to a participant with no opponents', () => {
    const deltas = computeEloDeltas([p('solo', 0)]);
    expect(deltas.get('solo')).toBe(0);
  });

  it('rewards beating a higher-rated opponent more than beating an equal one', () => {
    const deltas = computeEloDeltas([
      { id: 'underdog', rating: 1400, gamesPlayed: 0, rank: 0 },
      { id: 'favorite', rating: 1600, gamesPlayed: 0, rank: 1 },
    ]);
    expect(deltas.get('underdog')!).toBeGreaterThan(20);
    expect(deltas.get('favorite')!).toBeLessThan(-20);
  });
});

describe('ratingUnits', () => {
  const ffaScores = {
    players: [],
    ranking: [['a'], ['b'], ['bot:x']],
  } as unknown as FinalScoreboard;

  it('builds one unit per rated player in a free-for-all, dropping unrated seats', () => {
    const units = ratingUnits(ffaScores, new Set(['a', 'b']));
    expect(units).toHaveLength(2);
    expect(units.find((u) => u.key === 'a')?.rank).toBe(0);
    expect(units.find((u) => u.key === 'b')?.rank).toBe(1);
  });

  const teamScores = {
    players: [],
    ranking: [],
    teams: [
      {
        team: 0,
        members: ['a', 'bot:x'],
        routePoints: 0,
        ticketNet: 0,
        ticketsCompleted: 0,
        stationBonus: 0,
        longestTrailLength: 0,
        longestBonus: 0,
        total: 0,
      },
      {
        team: 1,
        members: ['b', 'c'],
        routePoints: 0,
        ticketNet: 0,
        ticketsCompleted: 0,
        stationBonus: 0,
        longestTrailLength: 0,
        longestBonus: 0,
        total: 0,
      },
    ],
    teamRanking: [[1], [0]],
  } as unknown as FinalScoreboard;

  it('reduces a team to one unit with only its rated members, ranked by the TEAM placement', () => {
    const units = ratingUnits(teamScores, new Set(['a', 'b', 'c']));
    expect(units).toHaveLength(2);
    const teamA = units.find((u) => u.key === 'team:0')!;
    expect(teamA.memberUserIds).toEqual(['a']); // bot:x filtered out
    expect(teamA.rank).toBe(1); // team 0 lost (teamRanking[0] = [1])
    const teamB = units.find((u) => u.key === 'team:1')!;
    expect(teamB.memberUserIds).toEqual(['b', 'c']);
    expect(teamB.rank).toBe(0);
  });

  it('drops a team unit entirely when it has no rated members', () => {
    const units = ratingUnits(teamScores, new Set(['b', 'c']));
    expect(units).toHaveLength(1);
    expect(units[0]!.key).toBe('team:1');
  });
});
