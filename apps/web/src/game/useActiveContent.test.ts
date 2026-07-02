import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { CONTENT_HASH, TAIWAN_CONTENT } from '@trm/map-data';
import { setAccessToken } from '../net/rest';
import { useActiveContent } from './useActiveContent';
import { CITIES } from './content';
import { resetToDefaultContent } from './catalog';

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const customDto = (hash: string) => ({
  meta: { mapId: `custom:${hash}`, version: 1, nameZh: '測試', nameEn: 'Test' },
  cities: [{ id: 'q1', nameZh: '甲', nameEn: 'Q1', x: 10, y: 10, region: 'r', isIsland: false }],
  routes: [] as never[],
  tickets: [] as never[],
});

describe('useActiveContent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetToDefaultContent();
  });

  it('resolves the bundled Taiwan hash to ready synchronously and leaves the catalog untouched', () => {
    const { result } = renderHook(() => useActiveContent(CONTENT_HASH));
    expect(result.current).toBe('ready');
    expect(CITIES).toBe(TAIWAN_CONTENT.cities);
  });

  it('fetches a custom hash and swaps the active catalog once resolved', async () => {
    setAccessToken('AT');
    const hash = 'a'.repeat(64);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(res(200, customDto(hash)))),
    );

    const { result } = renderHook(() => useActiveContent(hash));
    expect(result.current).toBe('loading');
    await waitFor(() => expect(result.current).toBe('ready'));
    expect(CITIES.map((c) => c.id as string)).toEqual(['q1']);
  });

  it('resets to the default catalog on unmount', async () => {
    setAccessToken('AT');
    const hash = 'b'.repeat(64);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(res(200, customDto(hash)))),
    );

    const { result, unmount } = renderHook(() => useActiveContent(hash));
    await waitFor(() => expect(result.current).toBe('ready'));
    expect(CITIES.map((c) => c.id as string)).toEqual(['q1']);

    unmount();
    expect(CITIES).toBe(TAIWAN_CONTENT.cities);
  });

  it('reports error on a resolution failure and leaves the catalog on the default', async () => {
    setAccessToken('AT');
    const hash = 'c'.repeat(64);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(res(404, { message: 'unknown content hash' }))),
    );

    const { result } = renderHook(() => useActiveContent(hash));
    await waitFor(() => expect(result.current).toBe('error'));
    expect(CITIES).toBe(TAIWAN_CONTENT.cities);
  });
});
