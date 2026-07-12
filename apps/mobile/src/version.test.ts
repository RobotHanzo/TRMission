import { checkForcedUpdate } from './version';

describe('checkForcedUpdate', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const respond = (body: unknown): void => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body }) as never;
  };

  it('flags mustUpdate when the server minBuild exceeds this build', async () => {
    respond({ minBuild: 5, commitHash: 'abc' });
    expect(await checkForcedUpdate(3)).toEqual({ mustUpdate: true, minBuild: 5 });
  });

  it('allows the app when this build meets minBuild', async () => {
    respond({ minBuild: 3, commitHash: 'abc' });
    expect(await checkForcedUpdate(3)).toEqual({ mustUpdate: false, minBuild: 3 });
  });

  it('hits the root /version/mobile route (outside /api/v1)', async () => {
    const f = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ minBuild: 1, commitHash: 'x' }) });
    global.fetch = f as never;
    await checkForcedUpdate(1);
    expect(String(f.mock.calls[0][0])).toContain('/version/mobile');
    expect(String(f.mock.calls[0][0])).not.toContain('/api/v1');
  });

  it('fails open when the version endpoint is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as never;
    expect(await checkForcedUpdate(1)).toEqual({ mustUpdate: false });
  });
});
