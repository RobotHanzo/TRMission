import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type * as RestModule from '../net/rest';
import '../i18n';
import AdminReplayScreen from './AdminReplayScreen';
import { useUi } from '../store/ui';
import { api } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', async (importOriginal) => {
  const actual = await importOriginal<typeof RestModule>();
  return { ...actual, api: { ...actual.api, adminReplay: vi.fn() } };
});

beforeEach(() => {
  vi.clearAllMocks();
  useUi.setState({
    view: 'adminReplay',
    adminReplayGameId: 'game-1',
    adminReplayTicket: 'tok',
  } as never);
});

describe('AdminReplayScreen', () => {
  it('shows the load-failed card when the ticket fetch fails', async () => {
    vi.mocked(api.adminReplay).mockRejectedValue(new Error('nope'));
    render(<AdminReplayScreen />);
    await waitFor(() => expect(screen.getByText('無法載入對局')).toBeInTheDocument());
  });
});
