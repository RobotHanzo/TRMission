import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track, trackPageView } from './analytics';
import type { View } from '../store/ui';

type Win = { zaraz?: unknown; gtag?: unknown };

const ALL_VIEWS: View[] = [
  'home',
  'room',
  'game',
  'tutorial',
  'login',
  'loginCallback',
  'history',
  'leaderboard',
  'replay',
  'adminReplay',
  'adminSpectate',
  'maps',
  'mapEditor',
  'deleteAccount',
  'privacy',
  'terms',
];

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

  // The room code is the join capability for an INVITE_ONLY lobby and useDocumentMeta bakes it into
  // <title>, so no page_view param may ever be derived from `document.title`.
  it('trackPageView never leaks the room code from document.title', () => {
    const spy = vi.fn();
    (window as unknown as Win).zaraz = { track: spy };
    document.title = 'Room ABCD · TRMission 台鐵任務';
    for (const view of ALL_VIEWS) trackPageView(view);
    expect(spy).toHaveBeenCalledTimes(ALL_VIEWS.length);
    for (const [, params] of spy.mock.calls) {
      expect(JSON.stringify(params)).not.toContain('ABCD');
      expect((params as { page_title: string }).page_title).not.toBe(document.title);
    }
  });

  it('trackPageView sends a constant per-screen title', () => {
    const spy = vi.fn();
    (window as unknown as Win).zaraz = { track: spy };
    document.title = 'Room ABCD · TRMission 台鐵任務';
    trackPageView('room');
    document.title = 'Game in progress · TRMission 台鐵任務';
    trackPageView('room');
    expect(spy.mock.calls[0]![1]).toEqual(spy.mock.calls[1]![1]);
    expect(spy).toHaveBeenCalledWith(
      'page_view',
      expect.objectContaining({ screen: 'room', page_title: 'Room lobby' }),
    );
  });
});
