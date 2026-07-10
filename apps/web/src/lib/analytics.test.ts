import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track, trackPageView } from './analytics';

type Win = { zaraz?: unknown; gtag?: unknown };

describe('analytics.track', () => {
  beforeEach(() => {
    (window as unknown as Win).zaraz = undefined;
    (window as unknown as Win).gtag = undefined;
  });
  afterEach(() => vi.restoreAllMocks());

  it('forwards to zaraz.track when present', () => {
    const spy = vi.fn();
    (window as unknown as Win).zaraz = { track: spy };
    track('login', { method: 'guest' });
    expect(spy).toHaveBeenCalledWith('login', { method: 'guest' });
  });

  it('falls back to gtag when zaraz is absent', () => {
    const spy = vi.fn();
    (window as unknown as Win).gtag = spy;
    track('room_create', {});
    expect(spy).toHaveBeenCalledWith('event', 'room_create', {});
  });

  it('prefers zaraz over gtag when both exist', () => {
    const z = vi.fn();
    const g = vi.fn();
    (window as unknown as Win).zaraz = { track: z };
    (window as unknown as Win).gtag = g;
    track('logout', {});
    expect(z).toHaveBeenCalledOnce();
    expect(g).not.toHaveBeenCalled();
  });

  it('is a safe no-op when neither exists', () => {
    expect(() => track('logout', {})).not.toThrow();
  });

  it('trackPageView normalizes the path to the route template', () => {
    const spy = vi.fn();
    (window as unknown as Win).zaraz = { track: spy };
    trackPageView('room');
    expect(spy).toHaveBeenCalledWith(
      'page_view',
      expect.objectContaining({ screen: 'room', page_path: '/room/:code' }),
    );
  });
});
