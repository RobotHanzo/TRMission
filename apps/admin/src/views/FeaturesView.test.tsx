import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as RestModule from '../net/rest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { FeaturesView } from './FeaturesView';
import { api, type UserRow } from '../net/rest';
import { useSession } from '../store/session';

vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof RestModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      listFeaturedUsers: vi.fn(),
      listUsers: vi.fn(),
      putUserFeatures: vi.fn(),
      getDefaultFeatures: vi.fn(),
      putDefaultFeatures: vi.fn(),
      getOfficialMaps: vi.fn(),
      putOfficialMaps: vi.fn(),
    },
  };
});
const mocked = api as unknown as {
  listFeaturedUsers: ReturnType<typeof vi.fn>;
  listUsers: ReturnType<typeof vi.fn>;
  putUserFeatures: ReturnType<typeof vi.fn>;
  getDefaultFeatures: ReturnType<typeof vi.fn>;
  putDefaultFeatures: ReturnType<typeof vi.fn>;
  getOfficialMaps: ReturnType<typeof vi.fn>;
  putOfficialMaps: ReturnType<typeof vi.fn>;
};

const OFFICIAL_MAPS = [
  { mapId: 'taiwan', nameZh: '台灣本島與離島', nameEn: 'Taiwan & Outlying Islands', enabled: true },
  { mapId: 'taipei', nameZh: '大台北', nameEn: 'Greater Taipei', enabled: true },
];

const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  isGuest: false,
  oauthProviders: [],
  hasPassword: false,
  features: ['mapBuilder'],
  tutorialCompleted: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});

describe('FeaturesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ permissions: new Set(['users.read', 'users.features']) });
  });

  it('lists granted accounts with their features', async () => {
    mocked.listFeaturedUsers.mockResolvedValue({ users: [row()] });
    render(<FeaturesView />);
    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });

  it('opens the account selector from the add button', async () => {
    mocked.listFeaturedUsers.mockResolvedValue({ users: [] });
    mocked.listUsers.mockResolvedValue({ users: [row({ features: [] })], nextCursor: null });
    render(<FeaturesView />);
    fireEvent.click(await screen.findByRole('button', { name: /新增|Add/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('hides the default-flags panel without config.features', async () => {
    mocked.listFeaturedUsers.mockResolvedValue({ users: [] });
    render(<FeaturesView />);
    await screen.findByText('功能開通');
    expect(mocked.getDefaultFeatures).not.toHaveBeenCalled();
    expect(mocked.getOfficialMaps).not.toHaveBeenCalled();
    expect(screen.queryByText('預設功能旗標')).not.toBeInTheDocument();
    expect(screen.queryByText('官方地圖')).not.toBeInTheDocument();
  });

  it('loads and saves the default-flags panel with config.features', async () => {
    useSession.setState({
      permissions: new Set(['users.read', 'users.features', 'config.features']),
    });
    mocked.listFeaturedUsers.mockResolvedValue({ users: [] });
    mocked.getDefaultFeatures.mockResolvedValue({ features: ['randomEvents'] });
    mocked.putDefaultFeatures.mockResolvedValue({ features: ['randomEvents', 'mapBuilder'] });
    mocked.getOfficialMaps.mockResolvedValue({ maps: OFFICIAL_MAPS });
    render(<FeaturesView />);
    expect(await screen.findByText('預設功能旗標')).toBeInTheDocument();
    // Two save buttons on the page now (feature defaults, then official maps) — in that order.
    fireEvent.click((await screen.findAllByRole('button', { name: '儲存' }))[0]!);
    expect(mocked.putDefaultFeatures).toHaveBeenCalledWith(['randomEvents']);
  });

  it('switches an official map off and saves the remaining enabled set', async () => {
    useSession.setState({
      permissions: new Set(['users.read', 'users.features', 'config.features']),
    });
    mocked.listFeaturedUsers.mockResolvedValue({ users: [] });
    mocked.getDefaultFeatures.mockResolvedValue({ features: [] });
    mocked.getOfficialMaps.mockResolvedValue({ maps: OFFICIAL_MAPS });
    mocked.putOfficialMaps.mockResolvedValue({
      maps: [OFFICIAL_MAPS[0]!, { ...OFFICIAL_MAPS[1]!, enabled: false }],
    });
    render(<FeaturesView />);
    expect(await screen.findByText('官方地圖')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('大台北'));
    fireEvent.click((await screen.findAllByRole('button', { name: '儲存' }))[1]!);
    expect(mocked.putOfficialMaps).toHaveBeenCalledWith(['taiwan']);
  });
});
