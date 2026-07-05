import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type * as RestModule from '../net/rest';
import '../i18n';
import { ENGINE_VERSION, SCHEMA_VERSION, CONTENT_HASH } from '@trm/engine';
import AdminReplayScreen from './AdminReplayScreen';
import { useUi } from '../store/ui';
import { api, type AdminReplayPayload } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));
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

/** A payload the local engine will actually load (matching versions + bundled content). */
const loadable = (over: Partial<AdminReplayPayload> = {}): AdminReplayPayload => ({
  gameId: 'game-1',
  config: {
    seed: 's1',
    players: [
      { id: 'u1', seat: 0 },
      { id: 'u2', seat: 1 },
    ],
    contentHash: CONTENT_HASH,
  },
  engineVersion: ENGINE_VERSION,
  schemaVersion: SCHEMA_VERSION,
  actions: [],
  status: 'COMPLETED',
  players: [
    { userId: 'u1', seat: 0, displayName: 'Tester' },
    { userId: 'u2', seat: 1, displayName: 'Other' },
  ],
  ...over,
});

describe('AdminReplayScreen', () => {
  it('shows the load-failed card when the ticket fetch fails', async () => {
    vi.mocked(api.adminReplay).mockRejectedValue(new Error('nope'));
    render(<AdminReplayScreen />);
    await waitFor(() => expect(screen.getByText('無法載入對局')).toBeInTheDocument());
  });

  it('shows the completed-replay notice for a COMPLETED game', async () => {
    vi.mocked(api.adminReplay).mockResolvedValue(loadable({ status: 'COMPLETED' }));
    render(<AdminReplayScreen />);
    expect(await screen.findByText('此為已完成對局的管理檢視。')).toBeInTheDocument();
  });

  it('shows the terminated-replay notice for a TERMINATED game', async () => {
    vi.mocked(api.adminReplay).mockResolvedValue(loadable({ status: 'TERMINATED' }));
    render(<AdminReplayScreen />);
    expect(
      await screen.findByText('此對局已被管理員強制終止;回放僅顯示到終止當下的進度,無最終比分。'),
    ).toBeInTheDocument();
  });
});
