import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../../i18n';
import MapsScreen from './MapsScreen';
import { api } from '../../net/rest';
import type * as Rest from '../../net/rest';
import { useUi } from '../../store/ui';

vi.mock('../../net/rest', async () => {
  const actual = await vi.importActual<typeof Rest>('../../net/rest');
  return {
    ...actual,
    api: {
      ...actual.api,
      listMaps: vi.fn(),
      listOfficialMaps: vi.fn(),
      forkOfficialMap: vi.fn(),
    },
  };
});

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

beforeEach(() => {
  asMock(api.listMaps).mockResolvedValue([]);
  asMock(api.listOfficialMaps).mockResolvedValue([
    { mapId: 'taiwan', nameZh: '台灣', nameEn: 'Taiwan', cities: 36, routes: 68 },
  ]);
  asMock(api.forkOfficialMap).mockResolvedValue({
    id: 'forked-1',
    nameZh: '台灣 (副本)',
    nameEn: 'Taiwan (Copy)',
    revision: 2,
    ownerId: 'u1',
    updatedAt: new Date().toISOString(),
    draft: { cities: [], routes: [], tickets: [] },
  });
});

afterEach(() => {
  useUi.setState({ view: 'home', editingMapId: null });
  vi.clearAllMocks();
});

describe('MapsScreen: fork from official', () => {
  it('lists an official map and forks it into the editor', async () => {
    render(<MapsScreen />);
    const forkBtn = await screen.findByRole('button', { name: '建立副本' });
    fireEvent.click(forkBtn);
    await waitFor(() => expect(api.forkOfficialMap).toHaveBeenCalledWith('taiwan'));
    await waitFor(() => expect(useUi.getState().view).toBe('mapEditor'));
    expect(useUi.getState().editingMapId).toBe('forked-1');
  });
});
