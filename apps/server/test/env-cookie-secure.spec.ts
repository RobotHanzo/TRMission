import { describe, it, expect, afterEach, vi } from 'vitest';

// `env.cookieSecure` is computed once, at module-load time, from process.env.COOKIE_SECURE.
// To exercise every branch of that parsing we reset the module registry and re-import fresh
// per case (Object.assign-ing the already-loaded singleton, as other specs do for fields read
// per-request, wouldn't tell us anything about the *parsing* rule itself).
describe('env.cookieSecure: secure-by-default with an explicit opt-out', () => {
  const original = process.env.COOKIE_SECURE;

  afterEach(() => {
    if (original === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = original;
  });

  const loadEnv = async () => {
    vi.resetModules();
    return (await import('../src/config/env')).env;
  };

  it('defaults to secure (true) when COOKIE_SECURE is unset', async () => {
    delete process.env.COOKIE_SECURE;
    const { cookieSecure } = await loadEnv();
    expect(cookieSecure).toBe(true);
  });

  it('COOKIE_SECURE=0 is the only opt-out, yielding false', async () => {
    process.env.COOKIE_SECURE = '0';
    const { cookieSecure } = await loadEnv();
    expect(cookieSecure).toBe(false);
  });

  it('any other value (including the old COOKIE_SECURE=1 opt-in) stays secure', async () => {
    process.env.COOKIE_SECURE = '1';
    expect((await loadEnv()).cookieSecure).toBe(true);

    process.env.COOKIE_SECURE = 'true';
    expect((await loadEnv()).cookieSecure).toBe(true);

    process.env.COOKIE_SECURE = '';
    expect((await loadEnv()).cookieSecure).toBe(true);
  });
});
