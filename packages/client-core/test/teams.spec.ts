import { describe, it, expect } from 'vitest';
import type { GameSnapshot } from '@trm/proto';
import { viewerWon, winnerIds } from '../src/game/teams';
import { ownershipMap } from '../src/game/view';

const snap = (finalScores: unknown, me: string | null = 'me'): GameSnapshot =>
  ({
    ...(me !== null ? { you: { playerId: me } } : {}),
    finalScores,
  }) as unknown as GameSnapshot;

// Team 0 = me + my partner, and I am the lower scorer of the pair; p3 alone out-totals us both.
const TEAM_FINALS = {
  players: [
    { playerId: 'me', total: 40 },
    { playerId: 'mate', total: 90 },
    { playerId: 'p3', total: 80 },
    { playerId: 'p4', total: 20 },
  ],
  ranking: [{ playerIds: ['mate'] }, { playerIds: ['p3'] }, { playerIds: ['me'] }],
  teams: [
    { team: 0, memberIds: ['me', 'mate'], total: 130 },
    { team: 1, memberIds: ['p3', 'p4'], total: 100 },
  ],
  teamRanking: [{ teams: [0] }, { teams: [1] }],
};

describe('viewerWon', () => {
  it('is the team result, not the individual one, in a team game', () => {
    expect(viewerWon(snap(TEAM_FINALS))).toBe(true); // lowest total on the winning team still won
    expect(viewerWon(snap(TEAM_FINALS, 'p3'))).toBe(false); // 2nd overall, but on the losing team
  });

  it('counts a tied first-place team as a win', () => {
    const tied = { ...TEAM_FINALS, teamRanking: [{ teams: [0, 1] }] };
    expect(viewerWon(snap(tied))).toBe(true);
    expect(viewerWon(snap(tied, 'p3'))).toBe(true);
  });

  it('falls back to the individual ranking in a free-for-all', () => {
    const ffa = { ranking: [{ playerIds: ['me', 'p2'] }, { playerIds: ['p3'] }], teams: [] };
    expect(viewerWon(snap(ffa))).toBe(true);
    expect(viewerWon(snap(ffa, 'p3'))).toBe(false);
  });

  it('is false for a spectator and before the scoreboard exists', () => {
    expect(viewerWon(snap(TEAM_FINALS, null))).toBe(false);
    expect(viewerWon(snap(undefined))).toBe(false);
  });
});

describe('winnerIds', () => {
  it("is the whole first-place TEAM, and excludes the losing side's top scorer", () => {
    expect([...winnerIds(snap(TEAM_FINALS))]).toEqual(['me', 'mate']);
  });

  it('is the individual ranking[0] group in a free-for-all', () => {
    const ffa = { ranking: [{ playerIds: ['me', 'p2'] }, { playerIds: ['p3'] }], teams: [] };
    expect([...winnerIds(snap(ffa))]).toEqual(['me', 'p2']);
  });

  it('covers both teams when first place is tied, and is empty with no scoreboard', () => {
    const tied = { ...TEAM_FINALS, teamRanking: [{ teams: [0, 1] }] };
    expect([...winnerIds(snap(tied))]).toEqual(['me', 'mate', 'p3', 'p4']);
    expect(winnerIds(snap(undefined)).size).toBe(0);
  });
});

// A claimed route carries BOTH colours in a team game: the cars go team-coloured (one network per
// side) while the roadbed keeps the owner's seat, naming which partner laid the track.
const board = (players: { id: string; seat: number; team: number }[]): GameSnapshot =>
  ({
    players,
    ownership: [
      { routeId: 'r1', cell: { case: 'ownerPlayerId', value: 'mate' } },
      { routeId: 'r2', cell: { case: 'locked', value: true } },
    ],
  }) as unknown as GameSnapshot;

describe('ownershipMap', () => {
  it("carries the owner's team alongside their seat in a team game", () => {
    const out = ownershipMap(
      board([
        { id: 'me', seat: 0, team: 0 },
        { id: 'mate', seat: 3, team: 0 },
      ]),
    );
    expect(out.get('r1')).toEqual({ ownerSeat: 3, ownerTeam: 0 });
    expect(out.get('r2')).toEqual({ locked: true });
  });

  it('leaves the team absent in a free-for-all, so the cars stay the seat colour', () => {
    const out = ownershipMap(
      board([
        { id: 'me', seat: 0, team: -1 },
        { id: 'mate', seat: 3, team: -1 },
      ]),
    );
    expect(out.get('r1')).toEqual({ ownerSeat: 3 });
  });
});
