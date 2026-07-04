import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('net/google: loadGoogleIdentityServices', () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '';
    delete (window as unknown as { google?: unknown }).google;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with google.accounts.id once the script loads', async () => {
    const { loadGoogleIdentityServices } = await import('./google');
    const fakeAccounts = { initialize: vi.fn(), prompt: vi.fn(), renderButton: vi.fn() };

    const promise = loadGoogleIdentityServices();
    const script = document.head.querySelector('script') as HTMLScriptElement;
    expect(script.src).toBe('https://accounts.google.com/gsi/client');
    (window as unknown as { google: unknown }).google = { accounts: { id: fakeAccounts } };
    script.onload?.(new Event('load'));

    await expect(promise).resolves.toBe(fakeAccounts);
  });

  it('rejects when the script fails to load', async () => {
    const { loadGoogleIdentityServices } = await import('./google');
    const promise = loadGoogleIdentityServices();
    const script = document.head.querySelector('script') as HTMLScriptElement;
    script.onerror?.(new Event('error'));
    await expect(promise).rejects.toThrow();
  });

  it('rejects if the script neither loads nor errors within the timeout', async () => {
    const { loadGoogleIdentityServices } = await import('./google');
    const promise = loadGoogleIdentityServices();
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it('injects the script only once across concurrent calls', async () => {
    const { loadGoogleIdentityServices } = await import('./google');
    const fakeAccounts = { initialize: vi.fn(), prompt: vi.fn(), renderButton: vi.fn() };
    const p1 = loadGoogleIdentityServices();
    const p2 = loadGoogleIdentityServices();
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    const script = document.head.querySelector('script') as HTMLScriptElement;
    (window as unknown as { google: unknown }).google = { accounts: { id: fakeAccounts } };
    script.onload?.(new Event('load'));
    await expect(p1).resolves.toBe(fakeAccounts);
    await expect(p2).resolves.toBe(fakeAccounts);
  });
});

describe('net/google: googleLocale', () => {
  it('maps the app locale to a GSI locale code', async () => {
    const { googleLocale } = await import('./google');
    expect(googleLocale('zh-Hant')).toBe('zh-TW');
    expect(googleLocale('en')).toBe('en');
  });
});
