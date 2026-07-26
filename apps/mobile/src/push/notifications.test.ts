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
  deliverPendingPush,
  installNotificationHandler,
  installNotificationTapHandling,
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

  it('a game_started with no room code still opens the game it names', async () => {
    // Every real game_started carries one; this is only the older-payload / odd-payload path.
    mockGetMyRooms.mockResolvedValue([{ code: 'ZZZZ', gameId: 'g1', status: 'STARTED' }]);
    await navigateForPush(nav as never, { kind: 'game_started', gameId: 'g1' } as PushData);
    expect(nav.navigate).toHaveBeenCalledWith('Game', { roomCode: 'ZZZZ' });
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

  it("opens the game straight from the payload's own roomCode, with no lookup at all", async () => {
    // The server stamps roomCode on every game payload (issue #63) — including game_over, whose
    // game is already ENDED and so can never be found in /rooms/mine.
    for (const kind of ['your_turn', 'game_over', 'game_paused'] as const) {
      nav.navigate.mockClear();
      await navigateForPush(nav as never, { kind, gameId: 'g1', roomCode: 'ZZZZ' } as PushData);
      expect(nav.navigate).toHaveBeenCalledWith('Game', { roomCode: 'ZZZZ' });
    }
    expect(mockGetMyRooms).not.toHaveBeenCalled();
  });

  it('falls back to resolving the room by gameId (payload from an older server)', async () => {
    // Mobile routes are room-keyed (Game: {roomCode}); such a payload carries only the gameId.
    mockGetMyRooms.mockResolvedValue([{ code: 'ZZZZ', gameId: 'g1', status: 'STARTED' }]);
    await navigateForPush(nav as never, { kind: 'your_turn', gameId: 'g1' } as PushData);
    expect(nav.navigate).toHaveBeenCalledWith('Game', { roomCode: 'ZZZZ' });

    nav.navigate.mockClear();
    await navigateForPush(nav as never, { kind: 'game_paused', gameId: 'g1' } as PushData);
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
    await navigateForPush(nav as never, { kind: 'nonsense' } as never);
    expect(nav.navigate).not.toHaveBeenCalled();
  });
});

describe('tap handling before the signed-in stack exists (issue #63)', () => {
  const nav = { navigate: jest.fn(), isReady: () => true };
  const response = (data: Record<string, unknown>) => ({ notification: notif(data) });

  beforeEach(() => {
    nav.navigate.mockClear();
    mockAddResponseListener.mockClear();
    mockGetLastResponse.mockReset().mockResolvedValue(null);
  });
  afterEach(async () => {
    // Never let a stash leak into the next test.
    await deliverPendingPush({ navigate: jest.fn(), isReady: () => true } as never);
  });

  /** The warm-tap listener expo was handed by the last install call. */
  const tap = (data: Record<string, unknown>): void =>
    (mockAddResponseListener.mock.calls.at(-1)![0] as (r: unknown) => void)(response(data));

  it('navigates immediately for a tap taken while the signed-in stack is live', () => {
    installNotificationTapHandling(nav as never, () => true);
    tap({ kind: 'your_turn', gameId: 'g1', roomCode: 'ZZZZ' });
    expect(nav.navigate).toHaveBeenCalledWith('Game', { roomCode: 'ZZZZ' });
  });

  it('stashes a tap taken while booting / signed out, then delivers it once', async () => {
    installNotificationTapHandling(nav as never, () => false);
    tap({ kind: 'your_turn', gameId: 'g1', roomCode: 'ZZZZ' });
    expect(nav.navigate).not.toHaveBeenCalled();

    await deliverPendingPush(nav as never);
    expect(nav.navigate).toHaveBeenCalledWith('Game', { roomCode: 'ZZZZ' });

    nav.navigate.mockClear();
    await deliverPendingPush(nav as never);
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('holds the COLD-START tap (the response that launched the process) the same way', async () => {
    mockGetLastResponse.mockResolvedValue(response({ kind: 'game_started', roomCode: 'ABCD' }));
    installNotificationTapHandling(nav as never, () => false);
    await new Promise<void>((r) => setTimeout(r, 0)); // let the cold-start lookup settle
    expect(nav.navigate).not.toHaveBeenCalled();

    await deliverPendingPush(nav as never);
    expect(nav.navigate).toHaveBeenCalledWith('Room', { code: 'ABCD' });
  });

  it('unsubscribes the warm listener on teardown', () => {
    const remove = jest.fn();
    mockAddResponseListener.mockReturnValueOnce({ remove });
    installNotificationTapHandling(nav as never, () => true)();
    expect(remove).toHaveBeenCalled();
  });
});
