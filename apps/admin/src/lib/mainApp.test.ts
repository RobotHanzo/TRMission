import { describe, it, expect, afterEach, vi } from 'vitest';
import { mainLoginUrl, goToMainLogin } from './mainApp';

describe('mainLoginUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a relative /login URL carrying the redirect target in production', () => {
    vi.stubEnv('DEV', false);
    expect(mainLoginUrl('/admin/users/42')).toBe('/login?redirect=%2Fadmin%2Fusers%2F42');
  });

  it('prefixes the dev web origin when running under `vite dev`', () => {
    vi.stubEnv('DEV', true);
    expect(mainLoginUrl('/admin')).toBe('http://localhost:5173/login?redirect=%2Fadmin');
  });
});

describe('goToMainLogin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('assigns window.location.href to the main login URL', () => {
    vi.stubEnv('DEV', false);
    const original = window.location;
    Object.defineProperty(window, 'location', { writable: true, value: { ...original, href: '' } });
    goToMainLogin('/admin/games/g1');
    expect(window.location.href).toBe('/login?redirect=%2Fadmin%2Fgames%2Fg1');
    Object.defineProperty(window, 'location', { writable: true, value: original });
  });
});
