import { describe, it, expect, afterEach, vi } from 'vitest';
import { CONTENT_HASH } from '@trm/map-data';
import { setAccessToken } from '../net/rest';
import { resolveContent } from './contentCache';

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const customDto = (hash: string) => ({
  meta: { mapId: `custom:${hash}`, version: 1, nameZh: '測試', nameEn: 'Test' },
  cities: [
    { id: 'c1', nameZh: '甲', nameEn: 'C1', x: 10, y: 10, region: 'r', isIsland: false },
    { id: 'c2', nameZh: '乙', nameEn: 'C2', x: 20, y: 10, region: 'r', isIsland: false },
  ],
  routes: [{ id: 'r1', a: 'c1', b: 'c2', color: 'RED', length: 2, ferryLocos: 0, isTunnel: false }],
  tickets: [{ id: 't1', a: 'c1', b: 'c2', value: 2, deck: 'SHORT' }],
});

describe('resolveContent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves the bundled Taiwan hash synchronously, with no network call', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = resolveContent(CONTENT_HASH);
    expect(result).not.toBeInstanceOf(Promise);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and converts an unknown hash to branded GameContent', async () => {
    setAccessToken('AT');
    const hash = 'x'.repeat(64);
    const fetchMock = vi.fn(() => Promise.resolve(res(200, customDto(hash))));
    vi.stubGlobal('fetch', fetchMock);

    const result = resolveContent(hash);
    expect(result).toBeInstanceOf(Promise);
    const content = await result;
    expect(content.cities).toHaveLength(2);
    expect(content.cities[0]!.id as string).toBe('c1');
    expect(content.routes[0]!.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches a resolved hash — a second call makes no further network request', async () => {
    setAccessToken('AT');
    const hash = 'y'.repeat(64);
    const fetchMock = vi.fn(() => Promise.resolve(res(200, customDto(hash))));
    vi.stubGlobal('fetch', fetchMock);

    await resolveContent(hash);
    const again = resolveContent(hash);
    expect(again).not.toBeInstanceOf(Promise);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('de-dupes concurrent in-flight requests for the same hash', async () => {
    setAccessToken('AT');
    const hash = 'z'.repeat(64);
    const fetchMock = vi.fn(() => Promise.resolve(res(200, customDto(hash))));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([resolveContent(hash), resolveContent(hash)]);
    expect(a).toBe(await a);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
