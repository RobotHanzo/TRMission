// Host-assign mode has two placements once a player is picked: an opposing PLAYER (the host names
// both ends of the swap) or the team HEADER (counterpart auto-picked). Without the first one, a
// host who wants a specific pairing has to keep re-tapping until the auto-pick happens to agree.
import { fireEvent, render, screen } from '@testing-library/react-native';
import '../../i18n';

import type { RoomView } from '../../net/rest';
import { TeamSelector } from '../TeamSelector';

const MEMBERS = [
  { userId: 'u-me', displayName: 'Me', isGuest: true, seat: 0, ready: false },
  { userId: 'g1', displayName: 'Guest1', isGuest: true, seat: 1, ready: false },
  { userId: 'g2', displayName: 'Guest2', isGuest: true, seat: 2, ready: false },
  { userId: 'g3', displayName: 'Guest3', isGuest: true, seat: 3, ready: false },
];

// Teams interleave by seat: team 1 = {u-me(0), g2(2)}, team 2 = {g1(1), g3(3)}.
const ROOM = {
  code: 'ABCD',
  hostId: 'u-me',
  status: 'LOBBY',
  maxPlayers: 4,
  members: MEMBERS,
  spectators: [],
  chat: [],
  settings: {
    unlimitedStationBorrow: true,
    secondDrawAfterBlindRainbow: false,
    noUnfinishedTicketPenalty: false,
    doubleRouteSingleFor23: true,
    allowSpectating: true,
    visibility: 'PUBLIC',
    map: { source: 'official', mapId: 'taiwan' },
    eventsMode: 'off',
    teamCount: 2,
    teamAssignMode: 'host',
    soloWaitForHost: true,
  },
} as RoomView;

const onAssign = jest.fn();
const onSwap = jest.fn();

const renderSelector = (over: Partial<React.ComponentProps<typeof TeamSelector>> = {}) =>
  render(
    <TeamSelector
      room={ROOM}
      isHost
      myUserId="u-me"
      memberName={(m) => m.displayName}
      onAssign={onAssign}
      onSwap={onSwap}
      onJoinTeam={jest.fn()}
      onShuffle={jest.fn()}
      onRemoveBot={jest.fn()}
      onTransferHost={jest.fn()}
      onKick={jest.fn()}
      {...over}
    />,
  );

beforeEach(() => {
  onAssign.mockClear();
  onSwap.mockClear();
});

describe('TeamSelector host-assign', () => {
  it('swaps the two players the host named, in that pair', () => {
    renderSelector();
    fireEvent.press(screen.getByText('Guest1'));
    fireEvent.press(screen.getByLabelText('與 Guest2 互換'));
    expect(onSwap).toHaveBeenCalledWith('g1', 'g2');
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('offers a swap only against the other teams', () => {
    renderSelector();
    fireEvent.press(screen.getByText('Guest1'));
    // g3 is g1's own teammate, and g1 is the pick itself — neither is a counterpart.
    expect(screen.queryByLabelText('與 Guest3 互換')).toBeNull();
    expect(screen.queryByLabelText('與 Guest1 互換')).toBeNull();
    expect(screen.getByLabelText('與 Guest2 互換')).toBeTruthy();
    expect(screen.getByLabelText('與 Me 互換')).toBeTruthy();
  });

  it('moves the pick when the tapped player is on the picked player’s team', () => {
    renderSelector();
    fireEvent.press(screen.getByText('Guest1'));
    fireEvent.press(screen.getByText('Guest3'));
    expect(onSwap).not.toHaveBeenCalled();
    // The pick is now g3, so Guest2 offers the swap against g3 instead.
    fireEvent.press(screen.getByLabelText('與 Guest2 互換'));
    expect(onSwap).toHaveBeenCalledWith('g3', 'g2');
  });

  it('still lets the host tap a team header and let it pick the counterpart', () => {
    renderSelector();
    fireEvent.press(screen.getByText('Guest1'));
    fireEvent.press(screen.getByText('1 隊'));
    expect(onAssign).toHaveBeenCalledWith('g1', 0);
    expect(onSwap).not.toHaveBeenCalled();
  });

  it('does nothing on a chip tap when the viewer is not the assigning host', () => {
    renderSelector({ isHost: false });
    fireEvent.press(screen.getByText('Guest1'));
    expect(screen.queryByLabelText('與 Guest2 互換')).toBeNull();
    expect(onSwap).not.toHaveBeenCalled();
  });
});
