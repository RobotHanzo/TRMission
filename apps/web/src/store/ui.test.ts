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

  it('syncFromUrl(not authed) on /room/:code gates to /login, remembering the target', () => {
    window.history.replaceState(null, '', '/room/ABCD');
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('login');
    expect(useUi.getState().roomCode).toBeNull();
    // The intended room is carried in ?redirect= so any sign-in resumes the join.
    expect(window.location.pathname + window.location.search).toBe('/login?redirect=%2Froom%2FABCD');
  });

  it('syncFromUrl(not authed) on / gates to /login', () => {
    window.history.replaceState(null, '', '/');
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('login');
    expect(path()).toBe('/login');
  });

  it('syncFromUrl on / (authed) yields the home view', () => {
    useUi.setState({ view: 'room', roomCode: 'ABCD' });
    window.history.replaceState(null, '', '/');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('home');
    expect(useUi.getState().roomCode).toBeNull();
  });

  it('navigateAfterAuth resumes the ?redirect= room target by REPLACING (no back-button trap)', () => {
    window.history.replaceState(null, '', '/login?redirect=%2Froom%2FWXYZ');
    const len = window.history.length;
    useUi.getState().navigateAfterAuth();
    expect(useUi.getState().view).toBe('room');
    expect(useUi.getState().roomCode).toBe('WXYZ');
    expect(path()).toBe('/room/WXYZ');
    // The /login entry must be replaced, not pushed over — otherwise Back re-enters the room.
    expect(window.history.length).toBe(len);
  });

  it('navigateAfterAuth defaults to home when there is no redirect target', () => {
    window.history.replaceState(null, '', '/login');
    useUi.getState().navigateAfterAuth();
    expect(useUi.getState().view).toBe('home');
    expect(path()).toBe('/');
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
