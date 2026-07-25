const mockSetNotificationHandler = jest.fn();
const mockAddResponseListener = jest.fn((..._a: unknown[]) => ({ remove: jest.fn() }));
const mockGetLastResponse = jest.fn().mockResolvedValue(null);
jest.mock('expo-notifications', () => ({
  setNotificationHandler: (...a: unknown[]) => mockSetNotificationHandler(...a),
  addNotificationResponseReceivedListener: (...a: unknown[]) => mockAddResponseListener(...a),
  getLastNotificationResponseAsync: (...a: unknown[]) => mockGetLastResponse(...a),
}));

const mockGetMyRooms = jest.fn();
jest.mock('../net/rest', () => ({
  api: { getMyRooms: (...a: unknown[]) => mockGetMyRooms(...a) },
}));

import { useSettings } from '../store/settings';
import {
  installNotificationHandler,
  navigateForPush,
  setActiveGameId,
  type PushData,
} from './notifications';

const notif = (data: Record<string, unknown>) => ({ request: { content: { data } } }) as never;

describe('foreground display policy', () => {
  // The handler under test IS the foreground path — expo only consults it for a notification
  // that lands while the app is open.
  const banner = async (data: Record<string, unknown>): Promise<boolean> => {
    installNotificationHandler();
    const handler = mockSetNotificationHandler.mock.calls.at(-1)![0] as {
      handleNotification: (n: unknown) => Promise<{ shouldShowBanner: boolean }>;
    };
    return (await handler.handleNotification(notif(data))).shouldShowBanner;
  };

  afterEach(() => {
    setActiveGameId(null);
    useSettings.setState({ notifyOnlyWhenAway: true });
  });

  it('always suppresses the banner for the game currently on screen', async () => {
    useSettings.setState({ notifyOnlyWhenAway: false });
    setActiveGameId('g1');
    expect(await banner({ kind: 'your_turn', gameId: 'g1' })).toBe(false);
    expect(await banner({ kind: 'your_turn', gameId: 'g2' })).toBe(true);
    setActiveGameId(null);
    expect(await banner({ kind: 'your_turn', gameId: 'g1' })).toBe(true);
  });

  it('notifyOnlyWhenAway (default) suppresses every game push while the app is open', async () => {
    // Issue #48: a turn in a SECOND game, and a game_started for a room you are sitting in,
    // both stay quiet — the player is right here.
    expect(await banner({ kind: 'your_turn', gameId: 'g2' })).toBe(false);
    expect(await banner({ kind: 'game_started', gameId: 'g3', roomCode: 'ABCD' })).toBe(false);
    expect(await banner({})).toBe(false);
  });

  it('turning notifyOnlyWhenAway off restores the on-screen-game-only rule', async () => {
    useSettings.setState({ notifyOnlyWhenAway: false });
    expect(await banner({ kind: 'your_turn', gameId: 'g2' })).toBe(true);
  });
});

describe('navigateForPush', () => {
  const nav = { navigate: jest.fn(), isReady: () => true };
  beforeEach(() => {
    nav.navigate.mockClear();
    mockGetMyRooms.mockReset();
  });

  it('game_started goes straight to the room (its screen owns the join/ticket flow)', async () => {
    await navigateForPush(
      nav as never,
      {
        kind: 'game_started',
        gameId: 'g1',
        roomCode: 'ABCD',
      } as PushData,
    );
    expect(nav.navigate).toHaveBeenCalledWith('Room', { code: 'ABCD' });
    expect(mockGetMyRooms).not.toHaveBeenCalled();
  });

  it('your_turn / game_over resolve the room by gameId and open the game', async () => {
    // Mobile routes are room-keyed (Game: {roomCode}); the payload carries only the gameId.
    mockGetMyRooms.mockResolvedValue([{ code: 'ZZZZ', gameId: 'g1', status: 'STARTED' }]);
    await navigateForPush(nav as never, { kind: 'your_turn', gameId: 'g1' } as PushData);
    expect(nav.navigate).toHaveBeenCalledWith('Game', { roomCode: 'ZZZZ' });

    nav.navigate.mockClear();
    await navigateForPush(nav as never, { kind: 'game_over', gameId: 'g1' } as PushData);
    expect(nav.navigate).toHaveBeenCalledWith('Game', { roomCode: 'ZZZZ' });
  });

  it('an unresolvable gameId (room gone) is ignored, never a crash', async () => {
    mockGetMyRooms.mockResolvedValue([]);
    await navigateForPush(nav as never, { kind: 'your_turn', gameId: 'g9' } as PushData);
    expect(nav.navigate).not.toHaveBeenCalled();

    mockGetMyRooms.mockRejectedValue(new Error('offline'));
    await navigateForPush(nav as never, { kind: 'your_turn', gameId: 'g9' } as PushData);
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('garbage payloads are ignored', async () => {
    await navigateForPush(nav as never, {} as PushData);
    expect(nav.navigate).not.toHaveBeenCalled();
  });
});
