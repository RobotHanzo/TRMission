import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { PlayerActionDialog } from './PlayerActionDialog';
import { PlayerCard } from './PlayerCard';
import { ChatPanel } from './ChatPanel';
import { useModeration } from '../store/moderation';
import { useRoster } from '../store/roster';
import { useChat } from '../store/chat';
import { useGame } from '../store/game';
import { useUi } from '../store/ui';
import { useAnimations } from '../store/animations';
import type * as RestModule from '../net/rest';

vi.mock('../net/connection', () => ({ getSocket: () => ({ chat: vi.fn(), chatPreset: vi.fn() }) }));
vi.mock('../net/rest', async (orig) => {
  const actual = await orig<typeof RestModule>();
  return {
    ...actual,
    api: {
      ...actual.api,
      myBlocks: vi.fn().mockResolvedValue({ blockedUserIds: [] }),
      blockUser: vi.fn().mockResolvedValue(undefined),
      unblockUser: vi.fn().mockResolvedValue(undefined),
      reportPlayer: vi.fn().mockResolvedValue({ id: 'r1' }),
    },
  };
});

const { api } = await import('../net/rest');
const mocked = api as unknown as {
  blockUser: ReturnType<typeof vi.fn>;
  unblockUser: ReturnType<typeof vi.fn>;
  reportPlayer: ReturnType<typeof vi.fn>;
};

const snap = create(GameSnapshotSchema, {
  stateVersion: 1,
  phase: Phase.AWAIT_ACTION,
  currentPlayerId: 'me',
  players: [
    { id: 'me', seat: 0, team: -1, trainCars: 45, stationsRemaining: 3 },
    { id: 'u-loud', seat: 1, team: -1, trainCars: 40, stationsRemaining: 3 },
    { id: 'bot:1', seat: 2, team: -1, trainCars: 40, stationsRemaining: 3 },
  ],
  you: { playerId: 'me' },
});

beforeEach(() => {
  mocked.blockUser.mockClear();
  mocked.unblockUser.mockClear();
  mocked.reportPlayer.mockClear();
  useModeration.getState().reset();
  useRoster.getState().clear();
  useChat.getState().reset();
  useAnimations.getState().reset();
  useUi.setState({ gameId: 'g1', roomCode: 'ABCD' });
  useGame.setState({ snapshot: snap, rejection: null });
});

describe('PlayerActionDialog', () => {
  it('submits a report with the category, message, and the room being played', async () => {
    render(<PlayerActionDialog target={{ id: 'u-loud', name: 'Loud' }} onClose={() => {}} />);
    fireEvent.click(screen.getByText('檢舉玩家'));
    fireEvent.click(screen.getByLabelText('濫發訊息'));
    fireEvent.change(screen.getByPlaceholderText('補充說明（選填）'), {
      target: { value: '  spamming presets  ' },
    });
    fireEvent.click(screen.getByText('送出檢舉'));
    await waitFor(() => expect(screen.getByText(/已收到你的檢舉/)).toBeInTheDocument());
    expect(mocked.reportPlayer).toHaveBeenCalledWith({
      userId: 'u-loud',
      category: 'SPAM',
      message: 'spamming presets',
      gameId: 'g1',
      roomCode: 'ABCD',
    });
  });

  it('surfaces a failed submission instead of pretending it landed', async () => {
    mocked.reportPlayer.mockRejectedValueOnce(new Error('offline'));
    render(<PlayerActionDialog target={{ id: 'u-loud', name: 'Loud' }} onClose={() => {}} />);
    fireEvent.click(screen.getByText('檢舉玩家'));
    fireEvent.click(screen.getByText('送出檢舉'));
    await waitFor(() => expect(screen.getByText(/檢舉送出失敗/)).toBeInTheDocument());
    expect(screen.queryByText(/已收到你的檢舉/)).not.toBeInTheDocument();
  });

  it('blocks optimistically and closes', async () => {
    let closed = false;
    render(
      <PlayerActionDialog
        target={{ id: 'u-loud', name: 'Loud' }}
        onClose={() => (closed = true)}
      />,
    );
    fireEvent.click(screen.getByText('封鎖玩家'));
    expect(useModeration.getState().blocked.has('u-loud')).toBe(true);
    expect(closed).toBe(true);
    await waitFor(() => expect(mocked.blockUser).toHaveBeenCalledWith('u-loud'));
  });

  it('offers to unblock someone already blocked', () => {
    useModeration.setState({ blocked: new Set(['u-loud']) });
    render(<PlayerActionDialog target={{ id: 'u-loud', name: 'Loud' }} onClose={() => {}} />);
    fireEvent.click(screen.getByText('解除封鎖'));
    expect(useModeration.getState().blocked.has('u-loud')).toBe(false);
  });
});

describe('report affordances', () => {
  it('the player card offers a report for another human', () => {
    render(<PlayerCard snapshot={snap} playerId="u-loud" onClose={() => {}} />);
    fireEvent.click(screen.getByText('檢舉玩家'));
    expect(screen.getByRole('dialog', { name: /檢舉玩家/ })).toBeInTheDocument();
  });

  it('never offers one for a bot or for yourself', () => {
    const { unmount } = render(<PlayerCard snapshot={snap} playerId="bot:1" onClose={() => {}} />);
    expect(screen.queryByText('檢舉玩家')).not.toBeInTheDocument();
    unmount();
    render(<PlayerCard snapshot={snap} playerId="me" onClose={() => {}} />);
    expect(screen.queryByText('檢舉玩家')).not.toBeInTheDocument();
  });
});

describe('blocking is display-only', () => {
  const withMessages = (): void => {
    useChat.setState({
      messages: [
        { id: '1', playerId: 'u-loud', content: { case: 'text', value: 'rude' } },
        { id: '2', playerId: 'me', content: { case: 'text', value: 'hello' } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    });
  };

  it('mutes a blocked author’s chat, keeping everyone else’s', () => {
    withMessages();
    useModeration.setState({ blocked: new Set(['u-loud']) });
    render(<ChatPanel />);
    expect(screen.queryByText('rude')).not.toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('masks a blocked player’s name back to the neutral seat label', () => {
    useRoster
      .getState()
      .setMembers([
        { userId: 'u-loud', displayName: 'RudeName', isGuest: false, seat: 1, ready: true },
      ]);
    useModeration.setState({ blocked: new Set(['u-loud']) });
    render(<PlayerCard snapshot={snap} playerId="u-loud" onClose={() => {}} />);
    expect(screen.queryByText('RudeName')).not.toBeInTheDocument();
    expect(screen.getByText('P2')).toBeInTheDocument();
  });

  it('suppresses a blocked player’s picture, not just their name', () => {
    useRoster.getState().setMembers([
      {
        userId: 'u-loud',
        displayName: 'RudeName',
        isGuest: false,
        seat: 1,
        ready: true,
        avatarUrl: 'https://example.test/a.png',
      },
    ]);
    const { container, rerender } = render(
      <PlayerCard snapshot={snap} playerId="u-loud" onClose={() => {}} />,
    );
    expect(container.querySelector('.seat-avatar img')).not.toBeNull();

    useModeration.setState({ blocked: new Set(['u-loud']) });
    rerender(<PlayerCard snapshot={snap} playerId="u-loud" onClose={() => {}} />);
    expect(container.querySelector('.seat-avatar img')).toBeNull();
  });

  it('leaves the blocked player seated — blocking never touches game state', () => {
    useModeration.setState({ blocked: new Set(['u-loud']) });
    render(<PlayerCard snapshot={snap} playerId="u-loud" onClose={() => {}} />);
    expect(screen.getByText('第 2 席')).toBeInTheDocument();
    expect(useGame.getState().snapshot?.players).toHaveLength(3);
  });
});
