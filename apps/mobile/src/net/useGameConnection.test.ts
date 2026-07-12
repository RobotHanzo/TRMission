import { renderHook, act, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { api } from './rest';
import { connectGame, disconnectGame } from './connection';
import { useGameConnection } from './useGameConnection';
import { useGame } from '../store/game';

jest.mock('./connection', () => ({
  connectGame: jest.fn(),
  disconnectGame: jest.fn(),
  getSocket: jest.fn(() => null),
}));
jest.mock('./rest', () => ({
  api: { getTicket: jest.fn(async () => ({ gameId: 'G1', ticket: 'T1' })) },
}));

describe('useGameConnection', () => {
  // jest-expo's AppState is a real emitter whose internals vary by RN version — capture the
  // hook's listener via a spy and drive it directly (the contract under test is the hook's).
  let appStateHandlers: ((state: AppStateStatus) => void)[] = [];
  let addSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    useGame.getState().reset();
    appStateHandlers = [];
    addSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateHandlers.push(handler);
      return { remove: jest.fn() } as unknown as NativeEventSubscription;
    });
  });
  afterEach(() => {
    addSpy.mockRestore();
  });

  it('fetches a ticket and connects on mount', async () => {
    renderHook(() => useGameConnection('ABCD'));
    await waitFor(() => expect(connectGame).toHaveBeenCalledWith('T1', { roomCode: 'ABCD' }));
    expect(api.getTicket).toHaveBeenCalledWith('ABCD');
  });

  it('re-mints the ticket and reconnects when the app foregrounds', async () => {
    renderHook(() => useGameConnection('ABCD'));
    await waitFor(() => expect(connectGame).toHaveBeenCalledTimes(1));
    await act(async () => {
      for (const h of appStateHandlers) h('background');
      for (const h of appStateHandlers) h('active');
    });
    await waitFor(() => expect(connectGame).toHaveBeenCalledTimes(2));
    expect(api.getTicket).toHaveBeenCalledTimes(2);
  });

  it('does NOT reconnect on foreground once the session was replaced', async () => {
    renderHook(() => useGameConnection('ABCD'));
    await waitFor(() => expect(connectGame).toHaveBeenCalledTimes(1));
    act(() => useGame.getState().setSessionReplaced(true));
    await act(async () => {
      for (const h of appStateHandlers) h('active');
    });
    expect(connectGame).toHaveBeenCalledTimes(1);
  });

  it('keeps the socket down but recoverable when the ticket mint fails', async () => {
    (api.getTicket as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useGameConnection('ABCD'));
    await waitFor(() => expect(api.getTicket).toHaveBeenCalledTimes(1));
    expect(connectGame).not.toHaveBeenCalled();
    act(() => result.current.retry());
    await waitFor(() => expect(connectGame).toHaveBeenCalledTimes(1));
  });

  it('tears the socket down on unmount', async () => {
    const { unmount } = renderHook(() => useGameConnection('ABCD'));
    await waitFor(() => expect(connectGame).toHaveBeenCalledTimes(1));
    unmount();
    expect(disconnectGame).toHaveBeenCalled();
  });
});
