import { render } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import { TeamTally } from '../TeamTally';

// The share maths is covered in @trm/client-core (test/teams.spec.ts); this asserts the mobile
// tally renders that split — the segments, the totals in them, and the lead line. zh-Hant is the
// primary locale in the mobile suite.
const teamGame = (routePoints: [number, number, number, number]) =>
  create(GameSnapshotSchema, {
    gameSettings: { teamCount: 2 },
    players: [
      { id: 'me', seat: 0, team: 0, routePoints: routePoints[0], trainCars: 30 },
      { id: 'mate', seat: 1, team: 0, routePoints: routePoints[1], trainCars: 30 },
      { id: 'p3', seat: 2, team: 1, routePoints: routePoints[2], trainCars: 30 },
      { id: 'p4', seat: 3, team: 1, routePoints: routePoints[3], trainCars: 30 },
    ],
    you: { playerId: 'me' },
  });

describe('TeamTally', () => {
  it('renders one segment per side with its live total and the lead line', () => {
    const { getByTestId } = render(<TeamTally snapshot={teamGame([30, 18, 25, 14])} />);
    expect(getByTestId('team-tally-seg-0')).toHaveTextContent(/1 隊48/);
    expect(getByTestId('team-tally-seg-1')).toHaveTextContent(/2 隊39/);
    expect(getByTestId('team-tally-lead')).toHaveTextContent('1 隊領先 9 分');
  });

  it('reads level before anyone has scored, and while the top is tied', () => {
    const { getByTestId, rerender } = render(<TeamTally snapshot={teamGame([0, 0, 0, 0])} />);
    expect(getByTestId('team-tally-lead')).toHaveTextContent('勢均力敵');
    rerender(<TeamTally snapshot={teamGame([10, 10, 12, 8])} />);
    expect(getByTestId('team-tally-lead')).toHaveTextContent('勢均力敵');
  });

  it('draws nothing in a free-for-all', () => {
    const ffa = create(GameSnapshotSchema, {
      players: [
        { id: 'me', seat: 0, team: -1, routePoints: 20 },
        { id: 'p2', seat: 1, team: -1, routePoints: 10 },
      ],
      you: { playerId: 'me' },
    });
    const { queryByTestId } = render(<TeamTally snapshot={ffa} />);
    expect(queryByTestId('team-tally')).toBeNull();
  });
});
