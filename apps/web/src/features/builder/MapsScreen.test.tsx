import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '../../i18n';
import MapsScreen from './MapsScreen';
import { api } from '../../net/rest';
import type * as Rest from '../../net/rest';
import { useUi } from '../../store/ui';

vi.mock('../../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../../net/rest', async () => {
  const actual = await vi.importActual<typeof Rest>('../../net/rest');
  return {
    ...actual,
    setOnTokenChange: vi.fn(),
    setAccessToken: vi.fn(),
    api: {
      ...actual.api,
      listMaps: vi.fn(),
      listOfficialMaps: vi.fn(),
      forkOfficialMap: vi.fn(),
      deleteMap: vi.fn(),
      peekSharedMap: vi.fn(),
      reportSharedMap: vi.fn(),
      cloneSharedMap: vi.fn(),
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

describe('MapsScreen: delete confirmation', () => {
  const oneMap = [
    {
      id: 'm1',
      nameZh: '測試地圖',
      nameEn: 'Test Map',
      revision: 1,
      updatedAt: new Date().toISOString(),
    },
  ];

  it('asks for confirmation before deleting, naming the map', async () => {
    asMock(api.listMaps).mockResolvedValue(oneMap);
    asMock(api.deleteMap).mockResolvedValue(undefined);
    render(<MapsScreen />);
    const deleteBtn = await screen.findByRole('button', { name: '刪除' });
    fireEvent.click(deleteBtn);
    expect(api.deleteMap).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText('確定要刪除「測試地圖 (Test Map)」嗎？此動作無法復原。'),
    ).toBeInTheDocument();
  });

  it('deletes and refreshes on confirm', async () => {
    asMock(api.listMaps).mockResolvedValue(oneMap);
    asMock(api.deleteMap).mockResolvedValue(undefined);
    render(<MapsScreen />);
    const deleteBtn = await screen.findByRole('button', { name: '刪除' });
    fireEvent.click(deleteBtn);
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(api.deleteMap).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(api.listMaps).toHaveBeenCalledTimes(2));
  });

  it('does not delete on cancel', async () => {
    asMock(api.listMaps).mockResolvedValue(oneMap);
    asMock(api.deleteMap).mockResolvedValue(undefined);
    render(<MapsScreen />);
    const deleteBtn = await screen.findByRole('button', { name: '刪除' });
    fireEvent.click(deleteBtn);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.deleteMap).not.toHaveBeenCalled();
  });
});

describe('MapsScreen: report a shared map', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/maps');
    asMock(api.peekSharedMap).mockResolvedValue({
      nameZh: '可疑地圖',
      nameEn: 'Sus Map',
      draft: { cities: [], routes: [], tickets: [] },
    });
  });

  it('peek reveals a report affordance that submits code + category', async () => {
    asMock(api.reportSharedMap).mockResolvedValue({ id: 'r1' });
    render(<MapsScreen />);
    fireEvent.change(screen.getByPlaceholderText(/分享代碼/), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: /預覽/ }));
    expect(await screen.findByText(/可疑地圖/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /檢舉此地圖/ }));
    fireEvent.change(screen.getByLabelText(/檢舉原因/), {
      target: { value: 'INAPPROPRIATE_CONTENT' },
    });
    fireEvent.click(screen.getByRole('button', { name: /送出檢舉/ }));
    await waitFor(() =>
      expect(api.reportSharedMap).toHaveBeenCalledWith(
        'ABCD1234',
        'INAPPROPRIATE_CONTENT',
        undefined,
      ),
    );
    expect(await screen.findByText(/已收到你的檢舉/)).toBeInTheDocument();
  });
});
