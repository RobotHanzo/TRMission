import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserFeature } from '@trm/shared';
import type * as RestModule from '../net/rest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../i18n';
import { ENGINE_VERSION, SCHEMA_VERSION, CONTENT_HASH } from '@trm/engine';
import ReplayScreen from './ReplayScreen';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api, type ReplayPayload } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', async (importOriginal) => ({
  ...(await importOriginal<typeof RestModule>()),
  setOnTokenChange: vi.fn(),
  setAccessToken: vi.fn(),
  api: { replay: vi.fn(), setReplayVisibility: vi.fn() },
}));
vi.mock('../hooks/useAnimationDriver', () => ({ useAnimationDriver: vi.fn() }));

const mocked = api as unknown as {
  replay: ReturnType<typeof vi.fn>;
  setReplayVisibility: ReturnType<typeof vi.fn>;
};

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: ['replayReview'] as UserFeature[],
  tutorialCompleted: true,
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
  visibility: 'private',
  canConfigureVisibility: true,
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

/** A payload the local engine will actually load (matching versions + bundled content). */
const loadable = (over: Partial<ReplayPayload> = {}): ReplayPayload =>
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
    players: [
      { userId: 'u1', seat: 0, displayName: 'Tester' },
      { userId: 'u2', seat: 1, displayName: 'Other' },
    ],
    ...over,
  });

describe('ReplayScreen sharing controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'replay', replayGameId: 'g1' });
    window.history.replaceState(null, '', '/replay/g1');
  });

  it('a seated player can flip the replay to view-by-link', async () => {
    mocked.replay.mockResolvedValue(loadable());
    mocked.setReplayVisibility.mockResolvedValue({ visibility: 'link' });
    render(<ReplayScreen />);
    const linkPill = await screen.findByRole('button', { name: '連結可見' });
    expect(screen.getByRole('button', { name: '私人' }).className).toContain('is-active');
    fireEvent.click(linkPill);
    expect(mocked.setReplayVisibility).toHaveBeenCalledWith('g1', 'link');
    expect(linkPill.className).toContain('is-active'); // optimistic flip
  });

  it('non-players (spectators) get copy-link but no visibility toggle', async () => {
    mocked.replay.mockResolvedValue(loadable({ canConfigureVisibility: false }));
    render(<ReplayScreen />);
    await screen.findByRole('button', { name: '複製連結' });
    expect(screen.queryByRole('button', { name: '私人' })).toBeNull();
    expect(screen.queryByRole('button', { name: '連結可見' })).toBeNull();
  });
});

describe('ReplayScreen signed-out visitors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: null });
    useUi.setState({ view: 'replay', replayGameId: 'g1' });
    window.history.replaceState(null, '', '/replay/g1');
  });

  it('offers the sign-in path (back to this replay) when the load fails', async () => {
    mocked.replay.mockRejectedValue(new Error('404'));
    render(<ReplayScreen />);
    expect(await screen.findByText('此重播需要登入後才能觀看')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    expect(useUi.getState().view).toBe('login');
    expect(window.location.pathname + window.location.search).toBe(
      '/login?redirect=%2Freplay%2Fg1',
    );
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
