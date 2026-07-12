import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type * as RestModule from '../../net/rest';
import '../../i18n';
import MapsScreen from './MapsScreen';
import { api } from '../../net/rest';

vi.mock('../../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof RestModule>();
  return {
    ...mod,
    setOnTokenChange: vi.fn(),
    setAccessToken: vi.fn(),
    api: {
      listMaps: vi.fn(),
      peekSharedMap: vi.fn(),
      reportSharedMap: vi.fn(),
      cloneSharedMap: vi.fn(),
    },
  };
});

const mocked = api as unknown as {
  listMaps: ReturnType<typeof vi.fn>;
  peekSharedMap: ReturnType<typeof vi.fn>;
  reportSharedMap: ReturnType<typeof vi.fn>;
};

describe('MapsScreen: report a shared map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/maps');
    mocked.listMaps.mockResolvedValue([]);
    mocked.peekSharedMap.mockResolvedValue({
      nameZh: '可疑地圖',
      nameEn: 'Sus Map',
      draft: { cities: [], routes: [], tickets: [] },
    });
  });

  it('peek reveals a report affordance that submits code + category', async () => {
    mocked.reportSharedMap.mockResolvedValue({ id: 'r1' });
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
      expect(mocked.reportSharedMap).toHaveBeenCalledWith(
        'ABCD1234',
        'INAPPROPRIATE_CONTENT',
        undefined,
      ),
    );
    expect(await screen.findByText(/已收到你的檢舉/)).toBeInTheDocument();
  });
});
