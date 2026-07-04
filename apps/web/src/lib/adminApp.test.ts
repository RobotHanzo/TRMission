import { describe, it, expect, afterEach, vi } from 'vitest';
import { isAdminTarget, goToAdmin } from './adminApp';

describe('isAdminTarget', () => {
  it('matches /admin and any /admin/ sub-path', () => {
    expect(isAdminTarget('/admin')).toBe(true);
    expect(isAdminTarget('/admin/users/42')).toBe(true);
  });

  it('rejects unrelated paths, including near-misses', () => {
    expect(isAdminTarget('/room/ABCD')).toBe(false);
    expect(isAdminTarget('/administrator')).toBe(false);
    expect(isAdminTarget('/')).toBe(false);
  });
});

describe('goToAdmin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hard-navigates to a relative path in production (same origin as the admin panel)', () => {
    vi.stubEnv('DEV', false);
    const original = window.location;
    Object.defineProperty(window, 'location', { writable: true, value: { ...original, href: '' } });
    goToAdmin('/admin/users/42');
    expect(window.location.href).toBe('/admin/users/42');
    Object.defineProperty(window, 'location', { writable: true, value: original });
  });

  it('prefixes the dev admin origin when running under `vite dev`', () => {
    vi.stubEnv('DEV', true);
    const original = window.location;
    Object.defineProperty(window, 'location', { writable: true, value: { ...original, href: '' } });
    goToAdmin('/admin');
    expect(window.location.href).toBe('http://localhost:5174/admin');
    Object.defineProperty(window, 'location', { writable: true, value: original });
  });
});
