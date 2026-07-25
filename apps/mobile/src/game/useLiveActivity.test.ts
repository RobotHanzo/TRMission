import { renderHook, act, waitFor } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import {
  GameSnapshotSchema,
  Phase,
  PublicPlayerStateSchema,
  SelfViewSchema,
  type GameSnapshot,
} from '@trm/proto';
import { api } from '../net/rest';
import { useGame } from '../store/game';
import { useRoster } from '../store/roster';
import { useSettings } from '../store/settings';
import { useLiveActivity } from './useLiveActivity';
import {
  addPushTokenListener,
  endLiveActivity,
  startLiveActivity,
  updateLiveActivity,
} from '../../modules/live-activity';

jest.mock('../net/rest', () => ({
  api: {
    registerLiveActivity: jest.fn(async () => undefined),
    removeLiveActivity: jest.fn(async () => undefined),
  },
}));

// The native module is absent under jest (iOS-only pod), so stand in for it wholesale — the
// contract under test is which ActivityKit calls the hook makes, and when.
let pushTokenListener: ((token: string) => void) | null = null;
jest.mock('../../modules/live-activity', () => ({
  isLiveActivitySupported: jest.fn(() => true),
  areLiveActivitiesEnabled: jest.fn(() => true),
  startLiveActivity: jest.fn(async () => 'activity-1'),
  updateLiveActivity: jest.fn(async () => true),
  endLiveActivity: jest.fn(async () => true),
  addPushTokenListener: jest.fn((listener: (token: string) => void) => {
    pushTokenListener = listener;
    return { remove: jest.fn() };
  }),
  addStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const snapshot = (opts: { current: string; over?: boolean; trains?: number }): GameSnapshot =>
  create(GameSnapshotSchema, {
    stateVersion: opts.trains ?? 1,
    phase: opts.over ? Phase.GAME_OVER : Phase.AWAIT_ACTION,
    currentPlayerId: opts.over ? '' : opts.current,
    players: [
      create(PublicPlayerStateSchema, { id: 'me', seat: 0, trainCars: opts.trains ?? 40 }),
      create(PublicPlayerStateSchema, { id: 'them', seat: 1, trainCars: 40 }),
    ],
    you: create(SelfViewSchema, { playerId: 'me' }),
  });

describe('useLiveActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pushTokenListener = null;
    useGame.getState().reset();
    useRoster.getState().clear();
    useSettings.setState({ liveActivities: true });
  });

  it('starts one activity with localized per-seat turn labels, then only updates', async () => {
    act(() => useGame.getState().applySnapshot(snapshot({ current: 'them' })));
    const { rerender } = renderHook(() => useLiveActivity('G1', 'ABC123'));

    await waitFor(() => expect(startLiveActivity).toHaveBeenCalledTimes(1));
    const [attributes, content] = (startLiveActivity as jest.Mock).mock.calls[0];
    expect(attributes.roomCode).toBe('ABC123');
    expect(attributes.mySeat).toBe(0);
    expect(attributes.turnLabels).toHaveLength(2);
    expect(attributes.turnLabels[0]).not.toBe(attributes.turnLabels[1]);
    expect(content).toMatchObject({ currentSeat: 1, myTrains: 40, over: false });

    act(() => useGame.getState().applySnapshot(snapshot({ current: 'me', trains: 37 })));
    rerender(undefined);
    await waitFor(() => expect(updateLiveActivity).toHaveBeenCalledTimes(1));
    expect(startLiveActivity).toHaveBeenCalledTimes(1);
    expect((updateLiveActivity as jest.Mock).mock.calls[0]?.[0]).toMatchObject({
      currentSeat: 0,
      myTrains: 37,
    });
  });

  it('registers the ActivityKit push token against the game', async () => {
    act(() => useGame.getState().applySnapshot(snapshot({ current: 'them' })));
    renderHook(() => useLiveActivity('G1', 'ABC123'));
    await waitFor(() => expect(addPushTokenListener).toHaveBeenCalled());

    act(() => pushTokenListener?.('deadbeef'));
    await waitFor(() => expect(api.registerLiveActivity).toHaveBeenCalledWith('G1', 'deadbeef'));

    // The same token again is not news — one row per device per game.
    act(() => pushTokenListener?.('deadbeef'));
    expect(api.registerLiveActivity).toHaveBeenCalledTimes(1);
  });

  it('ends the activity (leaving it up briefly) at game over, and never restarts it', async () => {
    act(() => useGame.getState().applySnapshot(snapshot({ current: 'them' })));
    const { rerender } = renderHook(() => useLiveActivity('G1', 'ABC123'));
    await waitFor(() => expect(startLiveActivity).toHaveBeenCalledTimes(1));

    act(() => useGame.getState().applySnapshot(snapshot({ current: '', over: true, trains: 9 })));
    rerender(undefined);
    await waitFor(() => expect(endLiveActivity).toHaveBeenCalledTimes(1));
    const [finalContent, linger] = (endLiveActivity as jest.Mock).mock.calls[0];
    expect(finalContent).toMatchObject({ over: true, currentSeat: -1 });
    expect(linger).toBeGreaterThan(0);
    expect(startLiveActivity).toHaveBeenCalledTimes(1);
  });

  it('starts nothing with the in-app setting off', async () => {
    // NOT wrapped in act(): the persisted settings store's setState returns the AsyncStorage write
    // promise, which act() would treat as an async act and then complain was never awaited.
    useSettings.setState({ liveActivities: false });
    act(() => useGame.getState().applySnapshot(snapshot({ current: 'them' })));
    renderHook(() => useLiveActivity('G1', 'ABC123'));
    expect(startLiveActivity).not.toHaveBeenCalled();
    expect(addPushTokenListener).not.toHaveBeenCalled();
  });

  it('starts nothing before the room view has resolved the game id', async () => {
    act(() => useGame.getState().applySnapshot(snapshot({ current: 'them' })));
    renderHook(() => useLiveActivity(null, 'ABC123'));
    expect(startLiveActivity).not.toHaveBeenCalled();
  });

  it('starts nothing for a spectator (no SelfView ⇒ no seat, trains or score)', async () => {
    act(() =>
      useGame.getState().applySnapshot(
        create(GameSnapshotSchema, {
          stateVersion: 5,
          phase: Phase.AWAIT_ACTION,
          currentPlayerId: 'them',
          players: [create(PublicPlayerStateSchema, { id: 'them', seat: 0 })],
        }),
      ),
    );
    renderHook(() => useLiveActivity('G1', 'ABC123'));
    expect(startLiveActivity).not.toHaveBeenCalled();
  });
  it('takes the card down and drops the token when the screen unmounts', async () => {
    act(() => useGame.getState().applySnapshot(snapshot({ current: 'them' })));
    const { unmount } = renderHook(() => useLiveActivity('G1', 'ABC123'));
    await waitFor(() => expect(startLiveActivity).toHaveBeenCalledTimes(1));
    act(() => pushTokenListener?.('deadbeef'));
    await waitFor(() => expect(api.registerLiveActivity).toHaveBeenCalled());

    unmount();
    expect(endLiveActivity).toHaveBeenCalledWith(null, 0);
    await waitFor(() => expect(api.removeLiveActivity).toHaveBeenCalledWith('deadbeef'));
  });
});
