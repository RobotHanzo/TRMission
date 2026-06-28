import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '../i18n';
import { RoomScreen } from './RoomScreen';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { api, ApiError } from '../net/rest';

// RoomScreen drives the lobby over REST + opens the game socket on start; stub both so the
// component can be exercised without a backend or a real WebSocket.
vi.mock('../net/connection', () => ({ connectGame: vi.fn(), disconnectGame: vi.fn() }));
vi.mock('../net/rest', () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    setOnTokenChange: vi.fn(),
    api: {
      getRoom: vi.fn(),
      getTicket: vi.fn(),
      joinRoom: vi.fn(),
      setReady: vi.fn(),
      leaveRoom: vi.fn(),
      addBot: vi.fn(),
      removeBot: vi.fn(),
      startRoom: vi.fn(),
    },
  };
});

const ME = {
  id: 'u-me',
  displayName: 'Me',
  isGuest: true,
  locale: 'zh-Hant' as const,
  preferences: { theme: 'system' as const, colorBlind: false },
};

const member = (userId: string, ready = false) => ({
  userId,
  displayName: userId,
  isGuest: false,
  seat: userId === 'host' ? 0 : 1,
  ready,
});

const room = (over: Partial<ReturnType<typeof baseRoom>> = {}) => ({ ...baseRoom(), ...over });
const baseRoom = () => ({
  code: 'ABCD',
  hostId: 'host',
  status: 'LOBBY' as 'LOBBY' | 'STARTED' | 'CLOSED',
  maxPlayers: 5,
  members: [member('host')] as ReturnType<typeof member>[],
  gameId: undefined as string | undefined,
});

const mocked = api as unknown as {
  getRoom: ReturnType<typeof vi.fn>;
  getTicket: ReturnType<typeof vi.fn>;
  joinRoom: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/room/ABCD');
  useUi.setState({ view: 'room', roomCode: 'ABCD', gameId: null, ticket: null });
  useSession.setState({ user: ME, booting: false });
  mocked.joinRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
});

describe('RoomScreen join-via-link', () => {
  it('joins the room when arriving via a shared link as a non-member', async () => {
    mocked.getRoom.mockResolvedValue(room()); // members = [host] only — I am not in it
    render(<RoomScreen />);
    await waitFor(() => expect(mocked.joinRoom).toHaveBeenCalledWith('ABCD'));
  });

  it('does not re-join when already a member (e.g. a normal reload)', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    // Wait until the first poll has rendered the roster, then assert no join was attempted.
    await screen.findByText('host');
    expect(mocked.joinRoom).not.toHaveBeenCalled();
  });

  it('does not try to join a game already in progress that it is not part of', async () => {
    mocked.getRoom.mockResolvedValue(room({ status: 'STARTED', gameId: 'g1' }));
    render(<RoomScreen />);
    await waitFor(() => expect(useUi.getState().view).toBe('home')); // bounced home
    expect(mocked.joinRoom).not.toHaveBeenCalled();
  });

  it('stops polling after a terminal join failure (e.g. 400 room full) instead of retrying forever', async () => {
    vi.useFakeTimers();
    try {
      mocked.getRoom.mockResolvedValue(room()); // non-member, LOBBY → enters the join branch
      mocked.joinRoom.mockRejectedValue(new ApiError(400, 'room is full'));
      render(<RoomScreen />);
      await vi.advanceTimersByTimeAsync(100); // settle the immediate poll (one join attempt)
      await vi.advanceTimersByTimeAsync(6000); // three more 2s ticks would re-spam join
      expect(mocked.joinRoom).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RoomScreen ready toggle colour', () => {
  it('is green (success) when it will mark you ready', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me', false)] }));
    render(<RoomScreen />);
    const readyUp = await screen.findByRole('button', { name: '我準備好了' });
    expect(readyUp).toHaveClass('success');
  });

  it('is red (danger) when it will cancel your ready', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me', true)] }));
    render(<RoomScreen />);
    const cancel = await screen.findByRole('button', { name: '取消準備' });
    expect(cancel).toHaveClass('danger');
  });
});

describe('RoomScreen copy link', () => {
  it('copies a shareable /room/:code link to the clipboard', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    const copyLink = await screen.findByRole('button', { name: '複製連結' });
    fireEvent.click(copyLink);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/room/ABCD`);
  });
});
