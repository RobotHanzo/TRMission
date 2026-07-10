import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserFeature } from '@trm/shared';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { HistoryScreen } from './HistoryScreen';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api, type MatchSummary } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', () => ({
  setOnTokenChange: vi.fn(),
  setAccessToken: vi.fn(),
  api: { history: vi.fn() },
}));

const mocked = api as unknown as { history: ReturnType<typeof vi.fn> };

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: ['replayReview'] as UserFeature[],
  tutorialCompleted: true,
} as const;

const row = (over: Partial<MatchSummary> = {}): MatchSummary => ({
  gameId: 'g1',
  players: [
    { userId: 'u1', seat: 0, displayName: 'Tester' },
    { userId: 'u2', seat: 1, displayName: 'Rival' },
  ],
  winners: ['u2'],
  completedAt: '2026-07-01T10:00:00.000Z',
  role: 'player',
  finalScores: null,
  replayable: true,
  ...over,
});

describe('HistoryScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'history', replayGameId: null });
    window.history.replaceState(null, '', '/history');
  });

  it('renders rows with names and a role badge; the replay button opens the player', async () => {
    mocked.history.mockResolvedValue([row()]);
    render(<HistoryScreen />);
    expect(await screen.findByText('Rival')).toBeInTheDocument();
    expect(screen.getByText('玩家')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重播/ }));
    expect(useUi.getState().view).toBe('replay');
    expect(useUi.getState().replayGameId).toBe('g1');
  });

  it('disables replay for non-replayable games', async () => {
    mocked.history.mockResolvedValue([row({ replayable: false })]);
    render(<HistoryScreen />);
    expect(await screen.findByRole('button', { name: /重播/ })).toBeDisabled();
  });

  it('hides the replay button entirely without the replayReview feature', async () => {
    useSession.setState({ user: { ...signedIn, features: [] } });
    mocked.history.mockResolvedValue([row()]);
    render(<HistoryScreen />);
    expect(await screen.findByText('Rival')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重播/ })).not.toBeInTheDocument();
  });

  it('marks spectated games with the spectator badge', async () => {
    mocked.history.mockResolvedValue([row({ role: 'spectator' })]);
    render(<HistoryScreen />);
    expect(await screen.findByText('觀戰')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mocked.history.mockResolvedValue([]);
    render(<HistoryScreen />);
    expect(await screen.findByText('尚無完成的對局')).toBeInTheDocument();
  });

  it('shows the error state when the fetch fails', async () => {
    mocked.history.mockRejectedValue(new Error('boom'));
    render(<HistoryScreen />);
    expect(await screen.findByText('無法載入對局')).toBeInTheDocument();
  });
});
