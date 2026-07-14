import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserFeature } from '@trm/shared';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '../i18n';
import { RoomScreen } from './RoomScreen';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { api, ApiError, type MapSelector } from '../net/rest';

// RoomScreen drives the lobby over REST + opens the game socket on start; stub both so the
// component can be exercised without a backend or a real WebSocket.
vi.mock('../net/connection', () => ({ connectGame: vi.fn(), disconnectGame: vi.fn() }));
const { play } = vi.hoisted(() => ({ play: vi.fn() }));
vi.mock('../sound/player', () => ({
  soundPlayer: {
    preload: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn(),
    play,
    setEnabled: vi.fn(),
    setVolume: vi.fn(),
  },
}));
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
      spectate: vi.fn(),
      setReady: vi.fn(),
      leaveRoom: vi.fn(),
      addBot: vi.fn(),
      removeBot: vi.fn(),
      kickPlayer: vi.fn(),
      startRoom: vi.fn(),
      updateRoomSettings: vi.fn(),
      listMaps: vi.fn(() => Promise.resolve([])),
      sendRoomChat: vi.fn(),
      watchRoom: vi.fn(),
      rejoinRoom: vi.fn(),
      transferOwnership: vi.fn(),
      closeRoom: vi.fn(),
    },
  };
});

const ME = {
  id: 'u-me',
  displayName: 'Me',
  isGuest: true,
  preferences: {
    theme: 'system' as const,
    colorBlind: false,
    locale: 'zh-Hant' as const,
    boardLayout: 'rail' as const,
  },
  features: [] as UserFeature[],
  tutorialCompleted: true,
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
  settings: {
    unlimitedStationBorrow: false,
    secondDrawAfterBlindRainbow: false,
    noUnfinishedTicketPenalty: false,
    doubleRouteSingleFor23: true,
    allowSpectating: true,
    visibility: 'PUBLIC' as 'PUBLIC' | 'INVITE_ONLY',
    map: { source: 'official', mapId: 'taiwan' } as MapSelector,
    eventsMode: 'off' as 'off' | 'light' | 'moderate' | 'intense',
  },
  gameId: undefined as string | undefined,
  mapName: undefined as { zh: string; en: string } | undefined,
  spectators: [] as { userId: string; displayName: string; isGuest: boolean }[],
  chat: [] as { userId: string; presetId?: string; text?: string; ts: number }[],
});

const mocked = api as unknown as {
  getRoom: ReturnType<typeof vi.fn>;
  getTicket: ReturnType<typeof vi.fn>;
  joinRoom: ReturnType<typeof vi.fn>;
  spectate: ReturnType<typeof vi.fn>;
  kickPlayer: ReturnType<typeof vi.fn>;
  updateRoomSettings: ReturnType<typeof vi.fn>;
  watchRoom: ReturnType<typeof vi.fn>;
  rejoinRoom: ReturnType<typeof vi.fn>;
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

  it('spectates a started room that allows it, instead of bouncing home', async () => {
    mocked.getRoom.mockResolvedValue(room({ status: 'STARTED', gameId: 'g1' })); // allowSpectating: true by default
    mocked.spectate.mockResolvedValue({ gameId: 'g1', ticket: 'spectator-ticket' });
    render(<RoomScreen />);
    await waitFor(() => expect(mocked.spectate).toHaveBeenCalledWith('ABCD'));
    await waitFor(() => expect(useUi.getState().view).toBe('game'));
    expect(useUi.getState().gameId).toBe('g1');
    expect(mocked.joinRoom).not.toHaveBeenCalled();
  });

  it('bounces home instead of spectating when the room disables it', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        status: 'STARTED',
        gameId: 'g1',
        settings: { ...baseRoom().settings, allowSpectating: false },
      }),
    );
    render(<RoomScreen />);
    await waitFor(() => expect(useUi.getState().view).toBe('home'));
    expect(mocked.joinRoom).not.toHaveBeenCalled();
    expect(mocked.spectate).not.toHaveBeenCalled();
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

  it('joins a full room as a spectator and shows a one-time notice', async () => {
    mocked.getRoom.mockResolvedValue(room()); // members = [host] only — I am not in it
    mocked.joinRoom.mockResolvedValue(
      room({
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
      }),
    );
    render(<RoomScreen />);
    await waitFor(() => expect(mocked.joinRoom).toHaveBeenCalledWith('ABCD'));
    expect(await screen.findByText('房間已滿，你已加入為觀戰者。')).toBeInTheDocument();
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

  it('flashes a success toast once the copy resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    const copyCode = await screen.findByRole('button', { name: '複製房號' });
    fireEvent.click(copyCode);
    await screen.findByText('已複製'); // "Copied"
  });
});

describe('RoomScreen game settings panel', () => {
  it('lets the host toggle a rule variant via updateRoomSettings', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [member('u-me')] }));
    mocked.updateRoomSettings.mockResolvedValue(
      room({ hostId: 'u-me', members: [member('u-me')] }),
    );
    render(<RoomScreen />);
    const toggle = await screen.findByRole('switch', { name: '車站無限借用路線' });
    expect(toggle).not.toBeDisabled();
    fireEvent.click(toggle);
    expect(mocked.updateRoomSettings).toHaveBeenCalledWith('ABCD', {
      unlimitedStationBorrow: true,
    });
  });

  it('disables the settings controls for a non-host', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    const toggle = await screen.findByRole('switch', { name: '車站無限借用路線' });
    expect(toggle).toBeDisabled();
  });

  it('lets the host toggle the new doubleRouteSingleFor23 setting', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [member('u-me')] }));
    mocked.updateRoomSettings.mockResolvedValue(
      room({ hostId: 'u-me', members: [member('u-me')] }),
    );
    render(<RoomScreen />);
    const toggle = await screen.findByRole('switch', { name: '2–3 人限用單線平行路線' });
    expect(toggle).toHaveAttribute('aria-checked', 'true'); // default is on
    fireEvent.click(toggle);
    expect(mocked.updateRoomSettings).toHaveBeenCalledWith('ABCD', {
      doubleRouteSingleFor23: false,
    });
  });

  it('lets the host change room visibility via the segmented control', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [member('u-me')] }));
    mocked.updateRoomSettings.mockResolvedValue(
      room({ hostId: 'u-me', members: [member('u-me')] }),
    );
    render(<RoomScreen />);
    const inviteOnly = await screen.findByRole('radio', { name: '僅限邀請' });
    fireEvent.click(inviteOnly);
    expect(mocked.updateRoomSettings).toHaveBeenCalledWith('ABCD', { visibility: 'INVITE_ONLY' });
  });
});

describe('RoomScreen random-events picker', () => {
  it('hides the intensity picker from a host without the randomEvents feature', async () => {
    useSession.setState({ user: { ...ME, features: [] }, booting: false });
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [member('u-me')] }));
    render(<RoomScreen />);
    await screen.findByText('遊戲設定'); // settings fieldset is on screen
    expect(screen.queryByRole('radio', { name: '強烈' })).toBeNull();
  });

  it('shows an editable picker for a host holding the randomEvents feature, patching eventsMode', async () => {
    useSession.setState({ user: { ...ME, features: ['randomEvents'] }, booting: false });
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [member('u-me')] }));
    mocked.updateRoomSettings.mockResolvedValue(
      room({ hostId: 'u-me', members: [member('u-me')] }),
    );
    render(<RoomScreen />);
    const intense = await screen.findByRole('radio', { name: '強烈' });
    expect(intense).not.toBeDisabled();
    fireEvent.click(intense);
    expect(mocked.updateRoomSettings).toHaveBeenCalledWith('ABCD', { eventsMode: 'intense' });
  });

  it('shows the picker read-only (disabled) to a non-host once the host has set a non-off mode', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        settings: { ...baseRoom().settings, eventsMode: 'intense' },
      }),
    );
    render(<RoomScreen />);
    const intense = await screen.findByRole('radio', { name: '強烈' });
    expect(intense).toBeDisabled();
  });

  it('hides the picker from a non-host while the room is still on the default off mode', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    await screen.findByText('遊戲設定');
    expect(screen.queryByRole('radio', { name: '強烈' })).toBeNull();
  });
});

describe('RoomScreen map picker', () => {
  it('shows the resolved official map name to a non-host', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        mapName: { zh: '台灣本島與離島', en: 'Taiwan & Outlying Islands' },
      }),
    );
    render(<RoomScreen />);
    expect(await screen.findByText('台灣本島與離島')).toBeInTheDocument();
  });

  it('lets the host switch to a custom map from their own list', async () => {
    useSession.setState({ user: { ...ME, features: ['mapBuilder'] }, booting: false });
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [member('u-me')] }));
    mocked.updateRoomSettings.mockResolvedValue(
      room({
        hostId: 'u-me',
        members: [member('u-me')],
        settings: { ...baseRoom().settings, map: { source: 'custom', customMapId: 'm1' } },
      }),
    );
    (api.listMaps as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'm1', nameZh: '我的地圖', nameEn: 'My Map', revision: 1, updatedAt: '2026-01-01' },
    ]);
    render(<RoomScreen />);
    const customBtn = await screen.findByRole('radio', { name: '自訂' });
    fireEvent.click(customBtn);
    await waitFor(() =>
      expect(mocked.updateRoomSettings).toHaveBeenCalledWith('ABCD', {
        map: { source: 'custom', customMapId: 'm1' },
      }),
    );
  });

  it('offers to create a map when the room is set to custom but the host has none to pick', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        hostId: 'u-me',
        members: [member('u-me')],
        settings: { ...baseRoom().settings, map: { source: 'custom', customMapId: 'gone' } },
      }),
    );
    (api.listMaps as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<RoomScreen />);
    expect(await screen.findByRole('button', { name: /建立自訂地圖/ })).toBeInTheDocument();
    expect(mocked.updateRoomSettings).not.toHaveBeenCalled();
  });
});

describe('RoomScreen kick', () => {
  const meHost = { userId: 'u-me', displayName: 'Me', isGuest: true, seat: 0, ready: false };
  const guestMember = { userId: 'g1', displayName: 'Guest', isGuest: true, seat: 1, ready: false };

  it('lets the host remove a human member', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [meHost, guestMember] }));
    mocked.kickPlayer.mockResolvedValue(room({ hostId: 'u-me', members: [meHost] }));
    render(<RoomScreen />);
    const kickBtn = await screen.findByRole('button', { name: '移除玩家' });
    fireEvent.click(kickBtn);
    expect(mocked.kickPlayer).toHaveBeenCalledWith('ABCD', 'g1');
  });

  it('shows no kick button to a non-host', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    await screen.findByText('host');
    expect(screen.queryByRole('button', { name: '移除玩家' })).toBeNull();
  });

  it('shows a "removed" modal (and does not rejoin) when the host kicks us', async () => {
    vi.useFakeTimers();
    try {
      mocked.getRoom
        .mockResolvedValueOnce(room({ members: [member('host'), member('u-me')] })) // seated
        .mockResolvedValue(room({ members: [member('host')] })); // kicked — roster drops us
      render(<RoomScreen />);
      // Wrapped in act(): setKicked(true) lands from the polling promise chain, not a React
      // event, so without an explicit flush the DOM assertion below can race the commit.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100); // first poll: we are a member
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100); // next poll: gone → kicked modal
      });
      expect(mocked.joinRoom).not.toHaveBeenCalled();
      // Still mounted with a modal, not silently bounced; acknowledging returns home.
      expect(useUi.getState().view).toBe('room');
      const ack = screen.getByRole('button', { name: '返回首頁' });
      fireEvent.click(ack);
      expect(useUi.getState().view).toBe('home');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RoomScreen ownership transfer', () => {
  const meHost = { userId: 'u-me', displayName: 'Me', isGuest: true, seat: 0, ready: false };
  const guestMember = { userId: 'g1', displayName: 'Guest', isGuest: true, seat: 1, ready: false };

  it('lets the host make another member the owner without leaving', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [meHost, guestMember] }));
    (api.transferOwnership as ReturnType<typeof vi.fn>).mockResolvedValue(
      room({ hostId: 'g1', members: [meHost, guestMember] }),
    );
    render(<RoomScreen />);
    const makeOwnerBtn = await screen.findByRole('button', { name: '設為房主' });
    fireEvent.click(makeOwnerBtn);
    expect(api.transferOwnership).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(api.transferOwnership).toHaveBeenCalledWith('ABCD', 'g1'));
    expect(useUi.getState().view).toBe('room');
  });

  it('shows no make-owner button to a non-host', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    await screen.findByText('host');
    expect(screen.queryByRole('button', { name: '設為房主' })).toBeNull();
  });
});

describe('RoomScreen leave confirmation', () => {
  it('shows a confirmation dialog before leaving, and only leaves once confirmed', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    (api.leaveRoom as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<RoomScreen />);
    const leaveBtn = await screen.findByRole('button', { name: '離開房間' });
    fireEvent.click(leaveBtn);
    expect(api.leaveRoom).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(api.leaveRoom).toHaveBeenCalledWith('ABCD'));
    expect(useUi.getState().view).toBe('home');
  });

  it('cancels without leaving when the dialog is dismissed', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    const leaveBtn = await screen.findByRole('button', { name: '離開房間' });
    fireEvent.click(leaveBtn);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.leaveRoom).not.toHaveBeenCalled();
    expect(useUi.getState().view).toBe('room');
  });
});

describe('RoomScreen preset chat', () => {
  it('sends a preset message and shows it in the log with the translated text', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    (api.sendRoomChat as ReturnType<typeof vi.fn>).mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        chat: [{ userId: 'u-me', presetId: 'GOOD_LUCK', ts: 1 }],
      }),
    );
    const { container } = render(<RoomScreen />);
    const trigger = await screen.findByRole('button', { name: '快速回覆' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '祝你好運，玩得開心！' }));
    expect(api.sendRoomChat).toHaveBeenCalledWith('ABCD', { presetId: 'GOOD_LUCK' });
    await waitFor(() =>
      expect(container.querySelector('.chat-messages .chat-msg')?.textContent).toContain(
        '祝你好運，玩得開心！',
      ),
    );
  });

  it('sends a free-text message from the input box and renders it', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    (api.sendRoomChat as ReturnType<typeof vi.fn>).mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        chat: [{ userId: 'u-me', text: 'gg wp', ts: 1 }],
      }),
    );
    const { container } = render(<RoomScreen />);
    const input = await screen.findByPlaceholderText('輸入訊息…');
    fireEvent.change(input, { target: { value: 'gg wp' } });
    fireEvent.click(screen.getByRole('button', { name: '傳送' }));
    expect(api.sendRoomChat).toHaveBeenCalledWith('ABCD', { text: 'gg wp' });
    await waitFor(() =>
      expect(container.querySelector('.chat-messages .chat-msg')?.textContent).toContain('gg wp'),
    );
  });

  it('renders an existing chat log entry attributed to the sending member', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        chat: [{ userId: 'host', presetId: 'THANKS', ts: 1 }],
      }),
    );
    const { container } = render(<RoomScreen />);
    await waitFor(() =>
      expect(container.querySelector('.chat-messages .chat-msg')?.textContent).toContain('謝謝！'),
    );
  });
});

describe('RoomScreen chat sound cue', () => {
  it('does not play a cue for chat already present on the first load (reconnect-safe seed)', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host'), member('u-me')],
        chat: [{ userId: 'host', text: 'already here', ts: 1 }],
      }),
    );
    render(<RoomScreen />);
    await screen.findByText('already here');
    expect(play).not.toHaveBeenCalled();
  });

  it('plays chatMessage at full gain for my own new message', async () => {
    vi.useFakeTimers();
    try {
      mocked.getRoom
        .mockResolvedValueOnce(room({ members: [member('host'), member('u-me')], chat: [] }))
        .mockResolvedValue(
          room({
            members: [member('host'), member('u-me')],
            chat: [{ userId: 'u-me', text: 'hi', ts: 1 }],
          }),
        );
      render(<RoomScreen />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(play).toHaveBeenCalledWith('chatMessage', 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('plays chatMessage attenuated for an incoming message from someone else', async () => {
    vi.useFakeTimers();
    try {
      mocked.getRoom
        .mockResolvedValueOnce(room({ members: [member('host'), member('u-me')], chat: [] }))
        .mockResolvedValue(
          room({
            members: [member('host'), member('u-me')],
            chat: [{ userId: 'host', text: 'gl hf', ts: 1 }],
          }),
        );
      render(<RoomScreen />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(play).toHaveBeenCalledWith('chatMessage', 0.5);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RoomScreen spectating', () => {
  it('does not re-join a lobby spectator on subsequent polls', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
      }),
    );
    render(<RoomScreen />);
    await screen.findByText('host');
    expect(mocked.joinRoom).not.toHaveBeenCalled();
  });

  it('shows an enabled Spectate button next to Ready when there are other members', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    mocked.watchRoom.mockResolvedValue(
      room({
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'u-me', isGuest: false }],
      }),
    );
    render(<RoomScreen />);
    const spectateBtn = await screen.findByRole('button', { name: '觀戰' });
    expect(spectateBtn).not.toBeDisabled();
    fireEvent.click(spectateBtn);
    await waitFor(() => expect(mocked.watchRoom).toHaveBeenCalledWith('ABCD'));
  });

  it('hides Spectate from the host who is the only member', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [member('u-me')] }));
    render(<RoomScreen />);
    await screen.findByRole('button', { name: '我準備好了' });
    expect(screen.queryByRole('button', { name: '觀戰' })).toBeNull();
  });

  it('hides Spectate from the host even with other members present', async () => {
    const meHost = { userId: 'u-me', displayName: 'Me', isGuest: true, seat: 0, ready: false };
    const g1 = { userId: 'g1', displayName: 'g1', isGuest: false, seat: 1, ready: false };
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [meHost, g1] }));
    render(<RoomScreen />);
    await screen.findByText('g1');
    expect(screen.queryByRole('button', { name: '觀戰' })).toBeNull();
  });

  it('does not raise the kicked modal when the viewer demotes themselves to spectator', async () => {
    vi.useFakeTimers();
    try {
      mocked.getRoom
        .mockResolvedValueOnce(room({ members: [member('host'), member('u-me')] }))
        .mockResolvedValue(
          room({
            members: [member('host')],
            spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
          }),
        );
      render(<RoomScreen />);
      await vi.advanceTimersByTimeAsync(100); // first poll: seated
      await vi.advanceTimersByTimeAsync(2100); // next poll: now a spectator — must NOT look like a kick
      expect(useUi.getState().view).toBe('room');
      expect(screen.queryByRole('button', { name: '返回首頁' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows "Join as player" for a spectator and calls rejoinRoom', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
      }),
    );
    mocked.rejoinRoom.mockResolvedValue(
      room({ members: [member('host'), member('u-me')], spectators: [] }),
    );
    render(<RoomScreen />);
    const joinBtn = await screen.findByRole('button', { name: '加入遊戲' });
    expect(joinBtn).not.toBeDisabled();
    fireEvent.click(joinBtn);
    await waitFor(() => expect(mocked.rejoinRoom).toHaveBeenCalledWith('ABCD'));
  });

  it('disables "Join as player" when the room is full', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        maxPlayers: 1,
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
      }),
    );
    render(<RoomScreen />);
    const joinBtn = await screen.findByRole('button', { name: '加入遊戲' });
    expect(joinBtn).toBeDisabled();
  });

  it('renders the spectator list with a kick control for the host', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        hostId: 'u-me',
        members: [member('u-me')],
        spectators: [{ userId: 'g1', displayName: 'Watcher', isGuest: true }],
      }),
    );
    render(<RoomScreen />);
    await screen.findByText('Watcher');
    const kickBtns = await screen.findAllByRole('button', { name: '移除玩家' });
    expect(kickBtns.length).toBeGreaterThan(0);
    fireEvent.click(kickBtns[0]!);
    expect(mocked.kickPlayer).toHaveBeenCalledWith('ABCD', 'g1');
  });
});

describe('RoomScreen owner leave', () => {
  const meHost = { userId: 'u-me', displayName: 'Me', isGuest: true, seat: 0, ready: false };
  const human = { userId: 'g1', displayName: 'Guest', isGuest: true, seat: 1, ready: false };

  it('prompts to transfer or close, then transfers ownership and leaves', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [meHost, human] }));
    (api.transferOwnership as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (api.leaveRoom as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<RoomScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '離開房間' }));
    fireEvent.click(screen.getByRole('button', { name: '移轉並離開' }));
    await waitFor(() => expect(api.transferOwnership).toHaveBeenCalledWith('ABCD', 'g1'));
    await waitFor(() => expect(api.leaveRoom).toHaveBeenCalledWith('ABCD'));
    expect(useUi.getState().view).toBe('home');
  });

  it('closes the room when the owner leaves with only bots present', async () => {
    const bot = {
      userId: 'bot:1',
      displayName: 'Bot-EASY',
      isGuest: false,
      seat: 1,
      ready: true,
      isBot: true,
    };
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [meHost, bot] }));
    (api.closeRoom as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<RoomScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '離開房間' }));
    fireEvent.click(screen.getByRole('button', { name: '確認' })); // close-room confirmation
    await waitFor(() => expect(api.closeRoom).toHaveBeenCalledWith('ABCD'));
    expect(useUi.getState().view).toBe('home');
  });
});
