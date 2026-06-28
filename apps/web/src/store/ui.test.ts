import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUi, roomCodeFromPath } from './ui';
import { disconnectGame } from '../net/connection';

// The store tears down the live game socket on navigation home; stub that collaborator
// so these unit tests assert the call without a real WebSocket.
vi.mock('../net/connection', () => ({ disconnectGame: vi.fn() }));

const path = () => window.location.pathname;

describe('ui store routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    useUi.setState({ view: 'home', roomCode: null, gameId: null, ticket: null });
  });

  it('enterRoom sets the room view and pushes /room/:code', () => {
    useUi.getState().enterRoom('ABCD');
    expect(useUi.getState().view).toBe('room');
    expect(useUi.getState().roomCode).toBe('ABCD');
    expect(path()).toBe('/room/ABCD');
  });

  it('goHome resets to home, pushes /, and disconnects the socket', () => {
    useUi.getState().enterRoom('ABCD');
    useUi.getState().goHome();
    expect(useUi.getState().view).toBe('home');
    expect(useUi.getState().roomCode).toBeNull();
    expect(path()).toBe('/');
    expect(disconnectGame).toHaveBeenCalled();
  });

  it('enterGame switches to the game view without changing the URL', () => {
    useUi.getState().enterRoom('ABCD');
    useUi.getState().enterGame('game-1', 'ticket-1');
    expect(useUi.getState().view).toBe('game');
    expect(useUi.getState().gameId).toBe('game-1');
    expect(useUi.getState().ticket).toBe('ticket-1');
    expect(path()).toBe('/room/ABCD');
  });

  it('syncFromUrl(authed) on /room/:code restores the room view', () => {
    window.history.replaceState(null, '', '/room/ABCD');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('room');
    expect(useUi.getState().roomCode).toBe('ABCD');
  });

  it('syncFromUrl upper-cases a lower-case room code in the path', () => {
    window.history.replaceState(null, '', '/room/abcd');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().roomCode).toBe('ABCD');
  });

  it('syncFromUrl(not authed) on /room/:code shows home but keeps the link to resume after login', () => {
    window.history.replaceState(null, '', '/room/ABCD');
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('home');
    expect(useUi.getState().roomCode).toBeNull();
    // The pending room link is preserved so signing in (or playing as guest) resumes the join.
    expect(path()).toBe('/room/ABCD');
  });

  it('syncFromUrl on / yields the home view', () => {
    useUi.setState({ view: 'room', roomCode: 'ABCD' });
    window.history.replaceState(null, '', '/');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('home');
    expect(useUi.getState().roomCode).toBeNull();
  });
});

describe('ui store board layout', () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({ boardLayout: 'rail' });
  });

  it('setBoardLayout updates the store and persists to localStorage', () => {
    useUi.getState().setBoardLayout('tray');
    expect(useUi.getState().boardLayout).toBe('tray');
    expect(localStorage.getItem('trm.boardLayout')).toBe('tray');

    useUi.getState().setBoardLayout('rail');
    expect(useUi.getState().boardLayout).toBe('rail');
    expect(localStorage.getItem('trm.boardLayout')).toBe('rail');
  });
});

describe('ui store account preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({ theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' });
  });

  it('applyPreferences adopts language and layout from the account (+ persists locally)', () => {
    useUi.getState().applyPreferences({
      theme: 'dark',
      colorBlind: true,
      locale: 'en',
      boardLayout: 'tray',
    });
    const s = useUi.getState();
    expect(s.locale).toBe('en');
    expect(s.boardLayout).toBe('tray');
    expect(localStorage.getItem('trm.locale')).toBe('en');
    expect(localStorage.getItem('trm.boardLayout')).toBe('tray');
  });
});

describe('roomCodeFromPath', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('reads and upper-cases the room code from /room/:code', () => {
    window.history.replaceState(null, '', '/room/abcd');
    expect(roomCodeFromPath()).toBe('ABCD');
  });

  it('returns null when not on a room path', () => {
    window.history.replaceState(null, '', '/');
    expect(roomCodeFromPath()).toBeNull();
  });
});
