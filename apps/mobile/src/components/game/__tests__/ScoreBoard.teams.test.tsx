import { render, screen } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import '../../../i18n'; // side-effect i18next init (zh-Hant default)
import { ScoreBoard } from '../ScoreBoard';

// The team scoreboard is the observable under test — the celebration visuals just need to not run
// timers/animations under jest.
jest.mock('../../celebration/Confetti', () => ({ Confetti: () => null }));
jest.mock('../../../net/rest', () => ({ api: { submitRating: jest.fn() } }));
jest.mock('../../../store/session', () => ({
  useSession: (selector: (s: unknown) => unknown) =>
    selector({ user: null, loading: false, error: null, upgrade: jest.fn() }),
}));

// A finished 2v2 team game. The longest-route bonus is a TEAM award, so every player row carries
// longestBonus 0 and only the team row has the +10 (issue #74).
const teamSnap = (): GameSnapshot =>
  create(GameSnapshotSchema, {
    phase: Phase.GAME_OVER,
    players: [
      { id: 'me', seat: 0, team: 0 },
      { id: 'p1', seat: 1, team: 1 },
    ],
    you: { playerId: 'me', hand: {}, keptTicketIds: [], pendingOfferTicketIds: [] },
    gameSettings: { teamCount: 2 },
    finalScores: {
      players: [
        {
          playerId: 'me',
          routePoints: 50,
          longestTrailLength: 18,
          longestBonus: 0,
          total: 58,
          keptTicketIds: [],
          completedTicketIds: [],
        },
        {
          playerId: 'p1',
          routePoints: 20,
          longestTrailLength: 9,
          longestBonus: 0,
          total: 24,
          keptTicketIds: [],
          completedTicketIds: [],
        },
      ],
      ranking: [{ playerIds: ['me'] }, { playerIds: ['p1'] }],
      teams: [
        {
          team: 0,
          memberIds: ['me'],
          routePoints: 50,
          longestTrailLength: 18,
          longestBonus: 10,
          total: 68,
        },
        {
          team: 1,
          memberIds: ['p1'],
          routePoints: 20,
          longestTrailLength: 9,
          longestBonus: 0,
          total: 24,
        },
      ],
      teamRanking: [{ teams: [0] }, { teams: [1] }],
    },
  });

describe('ScoreBoard team mode', () => {
  it('shows the longest-route bonus on the team row, where it is actually awarded', () => {
    render(<ScoreBoard snapshot={teamSnap()} onLeave={jest.fn()} />);
    expect(screen.getByText(/合併最長路線 · 18 節車廂（\+10 分）/)).toBeTruthy();
    expect(screen.getByText(/合併最長路線 · 9 節車廂（\+0 分）/)).toBeTruthy();
  });

  it('never shows a member a bare +0 for a bonus their side scored', () => {
    render(<ScoreBoard snapshot={teamSnap()} onLeave={jest.fn()} />);
    expect(screen.getByText(/📏 18 節車廂$/)).toBeTruthy();
    expect(screen.queryByText(/📏 18 節車廂（\+0 分）/)).toBeNull();
  });
});
