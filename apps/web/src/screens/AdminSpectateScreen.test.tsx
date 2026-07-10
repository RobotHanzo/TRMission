import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type * as RestModule from '../net/rest';
import '../i18n';
import AdminSpectateScreen from './AdminSpectateScreen';
import { useUi } from '../store/ui';
import { useGame } from '../store/game';
import { useRoster } from '../store/roster';
import { api, type AdminSpectatePayload } from '../net/rest';

vi.mock('../net/connection', () => ({
  disconnectGame: vi.fn(),
  connectGame: vi.fn(),
  getSocket: vi.fn(() => null),
}));
vi.mock('../net/rest', async (importOriginal) => {
  const actual = await importOriginal<typeof RestModule>();
  return { ...actual, api: { ...actual.api, adminSpectate: vi.fn() } };
});

const payload: AdminSpectatePayload = {
  players: [
    { userId: 'u1', seat: 0, displayName: 'Tester' },
    { userId: 'u2', seat: 1, displayName: 'Other' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({
    view: 'adminSpectate',
    adminSpectateGameId: 'game-1',
    adminSpectateTicket: 'tok',
  } as never);
  useGame.setState({ snapshot: null } as never);
  useRoster.getState().clear();
});

describe('AdminSpectateScreen', () => {
  it('shows the load-failed card when the roster fetch fails', async () => {
    vi.mocked(api.adminSpectate).mockRejectedValue(new Error('nope'));
    render(<AdminSpectateScreen />);
    await waitFor(() => expect(screen.getByText('無法載入對局')).toBeInTheDocument());
  });

  it('seeds the roster and connects the socket once the ticket-authorized roster loads', async () => {
    vi.mocked(api.adminSpectate).mockResolvedValue(payload);
    const { connectGame } = await import('../net/connection');
    render(<AdminSpectateScreen />);
    await waitFor(() => expect(connectGame).toHaveBeenCalledWith('tok'));
    expect(useRoster.getState().byId['u1']).toMatchObject({ displayName: 'Tester', seat: 0 });
  });

  it('shows the missing-ticket error card when the URL has no ticket', async () => {
    useUi.setState({
      view: 'adminSpectate',
      adminSpectateGameId: 'game-1',
      adminSpectateTicket: null,
    } as never);
    render(<AdminSpectateScreen />);
    await waitFor(() => expect(screen.getByText('無法載入對局')).toBeInTheDocument());
  });
});
