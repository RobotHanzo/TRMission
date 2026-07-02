import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import { ENGINE_VERSION, SCHEMA_VERSION, CONTENT_HASH } from '@trm/engine';
import ReplayScreen from './ReplayScreen';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api, type ReplayPayload } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', () => ({
  setOnTokenChange: vi.fn(),
  setAccessToken: vi.fn(),
  api: { replay: vi.fn() },
}));
vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));

const mocked = api as unknown as { replay: ReturnType<typeof vi.fn> };

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
} as const;

const payload = (over: Partial<ReplayPayload> = {}): ReplayPayload => ({
  gameId: 'g1',
  config: { seed: 's1', players: [{ id: 'u1', seat: 0 }], contentHash: 'not-a-real-hash' },
  engineVersion: 1, // older than the bundled engine → version guard trips
  schemaVersion: 1,
  actions: [],
  players: [{ userId: 'u1', seat: 0, displayName: 'Tester' }],
  winners: ['u1'],
  completedAt: '2026-07-01T10:00:00.000Z',
  ...over,
});

describe('ReplayScreen guard rails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'replay', replayGameId: 'g1' });
    window.history.replaceState(null, '', '/replay/g1');
  });

  it('shows the version-mismatch card for a game from an older engine', async () => {
    mocked.replay.mockResolvedValue(payload());
    render(<ReplayScreen />);
    expect(await screen.findByText(/較舊的遊戲版本/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回對局紀錄' })).toBeInTheDocument();
  });

  it('shows the load-failed card when the fetch fails', async () => {
    mocked.replay.mockRejectedValue(new Error('boom'));
    render(<ReplayScreen />);
    expect(await screen.findByText('無法載入對局')).toBeInTheDocument();
  });
});

describe('ReplayScreen camera-follow default', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'replay', replayGameId: 'g1', followActing: false });
    window.history.replaceState(null, '', '/replay/g1');
  });

  it('defaults follow-acting on once a replay finishes loading', async () => {
    mocked.replay.mockResolvedValue(
      payload({
        engineVersion: ENGINE_VERSION,
        schemaVersion: SCHEMA_VERSION,
        config: {
          seed: 's1',
          players: [
            { id: 'u1', seat: 0 },
            { id: 'u2', seat: 1 },
          ],
          contentHash: CONTENT_HASH,
        },
        actions: [],
        players: [
          { userId: 'u1', seat: 0, displayName: 'Tester' },
          { userId: 'u2', seat: 1, displayName: 'Other' },
        ],
      }),
    );
    render(<ReplayScreen />);
    await screen.findByRole('slider');
    expect(useUi.getState().followActing).toBe(true);
  });
});
