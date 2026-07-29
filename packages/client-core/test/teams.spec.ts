import { describe, it, expect } from 'vitest';
import type { GameSnapshot } from '@trm/proto';
import { liveTeamTally, teamBySeat, viewerWon, winnerIds } from '../src/game/teams';
import { ownershipMap } from '../src/game/view';
import { SEAT_COLORS, TEAM_COLORS, ownerColor } from '../src/theme/colors';

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

// The tally divides the points scored SO FAR, so it reads mid-game player rows (routePoints +
// completed tickets), never finalScores — which does not exist yet while the game is running.
const live = (
  players: { id: string; team: number; routePoints: number }[],
  teamCount = 2,
  me: string | null = 'me',
): GameSnapshot =>
  ({
    gameSettings: { teamCount },
    players: players.map((p) => ({ ...p, seat: 0 })),
    completedTickets: [],
    ...(me !== null ? { you: { playerId: me } } : {}),
  }) as unknown as GameSnapshot;

describe('liveTeamTally', () => {
  it('divides the bar by each side share of the points scored so far', () => {
    const tally = liveTeamTally(
      live([
        { id: 'me', team: 0, routePoints: 30 },
        { id: 'mate', team: 0, routePoints: 18 },
        { id: 'p3', team: 1, routePoints: 25 },
        { id: 'p4', team: 1, routePoints: 14 },
      ]),
    )!;
    expect(tally.rows.map((r) => [r.team, r.total])).toEqual([
      [0, 48],
      [1, 39],
    ]);
    expect(tally.grandTotal).toBe(87);
    // Always full: the shares sum to exactly one, because there is no target score to fill toward.
    expect(tally.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
    expect(tally.rows[0]!.share).toBeCloseTo(48 / 87);
    expect(tally.leader).toBe(0);
    expect(tally.lead).toBe(9);
    expect(tally.rows.map((r) => r.isLeading)).toEqual([true, false]);
    expect(tally.rows.map((r) => r.isMine)).toEqual([true, false]);
  });

  it('is still full, and level, before anyone has scored', () => {
    const tally = liveTeamTally(
      live(
        [
          { id: 'me', team: 0, routePoints: 0 },
          { id: 'p3', team: 1, routePoints: 0 },
          { id: 'p5', team: 2, routePoints: 0 },
        ],
        3,
      ),
    )!;
    expect(tally.rows.map((r) => r.share)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(tally.grandTotal).toBe(0);
    expect(tally.leader).toBeNull();
    expect(tally.lead).toBe(0);
  });

  it('names no leader while the top is level', () => {
    const tally = liveTeamTally(
      live([
        { id: 'me', team: 0, routePoints: 20 },
        { id: 'p3', team: 1, routePoints: 20 },
      ]),
    )!;
    expect(tally.leader).toBeNull();
    expect(tally.lead).toBe(0);
    expect(tally.rows.every((r) => !r.isLeading)).toBe(true);
  });

  it('orders rows by team id however the seats are ordered', () => {
    const tally = liveTeamTally(
      live([
        { id: 'p3', team: 1, routePoints: 10 },
        { id: 'me', team: 0, routePoints: 5 },
      ]),
    )!;
    expect(tally.rows.map((r) => r.team)).toEqual([0, 1]);
    expect(tally.rows[0]!.memberIds).toEqual(['me']);
  });

  it('tallies the same for a spectator, and is null in a free-for-all', () => {
    const seats = [
      { id: 'me', team: 0, routePoints: 12 },
      { id: 'p3', team: 1, routePoints: 4 },
    ];
    const watching = liveTeamTally(live(seats, 2, null))!;
    expect(watching.rows.map((r) => r.total)).toEqual([12, 4]);
    expect(watching.rows.every((r) => !r.isMine)).toBe(true);
    expect(
      liveTeamTally(
        live(
          seats.map((s) => ({ ...s, team: -1 })),
          0,
        ),
      ),
    ).toBeNull();
  });
});

// Everything a seat owns ON THE BOARD (rails, roadbed, stations, glows) goes team-coloured in a
// team game: the map below is the single resolver both boards paint through.
const board = (players: { id: string; seat: number; team: number }[]): GameSnapshot =>
  ({
    players,
    ownership: [
      { routeId: 'r1', cell: { case: 'ownerPlayerId', value: 'mate' } },
      { routeId: 'r2', cell: { case: 'locked', value: true } },
    ],
  }) as unknown as GameSnapshot;

const TEAM_SEATS = [
  { id: 'me', seat: 0, team: 0 },
  { id: 'mate', seat: 3, team: 0 },
  { id: 'p3', seat: 1, team: 1 },
];

describe('teamBySeat / ownerColor', () => {
  it('paints both partners in their team colour and the other side in theirs', () => {
    const seats = teamBySeat(board(TEAM_SEATS));
    expect([...seats]).toEqual([
      [0, 0],
      [3, 0],
      [1, 1],
    ]);
    expect(ownerColor(0, seats)).toBe(TEAM_COLORS[0]);
    expect(ownerColor(3, seats)).toBe(TEAM_COLORS[0]); // partner: the SAME colour as seat 0
    expect(ownerColor(1, seats)).toBe(TEAM_COLORS[1]);
  });

  it('is empty in a free-for-all, where ownerColor is exactly seatColor', () => {
    const seats = teamBySeat(board(TEAM_SEATS.map((p) => ({ ...p, team: -1 }))));
    expect(seats.size).toBe(0);
    expect(ownerColor(3, seats)).toBe(SEAT_COLORS[3]);
    expect(ownerColor(3)).toBe(SEAT_COLORS[3]); // no map at all (specimens, backdrop)
  });
});

describe('ownershipMap', () => {
  it('maps a claimed route to its owner seat, and a locked sibling to locked', () => {
    const out = ownershipMap(board(TEAM_SEATS));
    expect(out.get('r1')).toEqual({ ownerSeat: 3 });
    expect(out.get('r2')).toEqual({ locked: true });
  });
});
