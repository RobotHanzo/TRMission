import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUi, roomCodeFromPath, adminSpectateFromPath } from './ui';
import { disconnectGame } from '../net/connection';
import { goToAdmin } from '../lib/adminApp';

// The store tears down the live game socket on navigation home; stub that collaborator
// so these unit tests assert the call without a real WebSocket.
vi.mock('../net/connection', () => ({ disconnectGame: vi.fn() }));
vi.mock('../lib/adminApp', () => ({
  isAdminTarget: (t: string) => t === '/admin' || t.startsWith('/admin/'),
  goToAdmin: vi.fn(),
}));

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
    expect(window.location.pathname + window.location.search).toBe(
      '/login?redirect=%2Froom%2FABCD',
    );
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

  it('navigateAfterAuth hard-redirects an admin-bound target instead of resuming it as an SPA view', () => {
    window.history.replaceState(null, '', '/login?redirect=%2Fadmin%2Fusers%2F42');
    useUi.getState().navigateAfterAuth();
    expect(goToAdmin).toHaveBeenCalledWith('/admin/users/42');
  });

  it('enterHistory pushes /history, sets the view, and disconnects any live game', () => {
    useUi.getState().enterHistory();
    expect(useUi.getState().view).toBe('history');
    expect(path()).toBe('/history');
    expect(disconnectGame).toHaveBeenCalled();
  });

  it('enterReplay pushes /replay/:id and records the game id', () => {
    useUi.getState().enterReplay('game-9');
    expect(useUi.getState().view).toBe('replay');
    expect(useUi.getState().replayGameId).toBe('game-9');
    expect(path()).toBe('/replay/game-9');
  });

  it('syncFromUrl(authed) on /replay/:id restores the replay view', () => {
    window.history.replaceState(null, '', '/replay/game-9');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('replay');
    expect(useUi.getState().replayGameId).toBe('game-9');
  });

  it('syncFromUrl(not authed) on /replay/:id is NOT gated — view-by-link replays', () => {
    window.history.replaceState(null, '', '/replay/game-9');
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('replay');
    expect(useUi.getState().replayGameId).toBe('game-9');
    expect(path()).toBe('/replay/game-9');
  });

  it('syncFromUrl(authed) on /admin-spectate/:id restores the adminSpectate view with the ticket', () => {
    window.history.replaceState(null, '', '/admin-spectate/game-1?ticket=tok');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('adminSpectate');
    expect(useUi.getState().adminSpectateGameId).toBe('game-1');
    expect(useUi.getState().adminSpectateTicket).toBe('tok');
  });

  it('syncFromUrl(not authed) on /admin-spectate/:id is NOT gated — the ticket is the sole authority', () => {
    window.history.replaceState(null, '', '/admin-spectate/game-1?ticket=tok');
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('adminSpectate');
    expect(useUi.getState().adminSpectateGameId).toBe('game-1');
  });

  it('enterMaps pushes /maps and sets the view', () => {
    useUi.getState().enterMaps();
    expect(useUi.getState().view).toBe('maps');
    expect(path()).toBe('/maps');
    expect(disconnectGame).toHaveBeenCalled();
  });

  it('enterMapEditor pushes /maps/:id/edit and records the map id', () => {
    useUi.getState().enterMapEditor('map-1');
    expect(useUi.getState().view).toBe('mapEditor');
    expect(useUi.getState().editingMapId).toBe('map-1');
    expect(path()).toBe('/maps/map-1/edit');
  });

  it('syncFromUrl(authed) on /maps restores the maps view', () => {
    window.history.replaceState(null, '', '/maps');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('maps');
  });

  it('syncFromUrl(not authed) on /maps gates to /login remembering the target', () => {
    window.history.replaceState(null, '', '/maps');
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('login');
    expect(window.location.pathname + window.location.search).toBe('/login?redirect=%2Fmaps');
  });

  it('syncFromUrl(authed) on /maps/:id/edit restores the editor view with the map id', () => {
    window.history.replaceState(null, '', '/maps/map-9/edit');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('mapEditor');
    expect(useUi.getState().editingMapId).toBe('map-9');
  });

  it('navigateAfterAuth resumes a ?redirect= map-editor target', () => {
    window.history.replaceState(null, '', '/login?redirect=%2Fmaps%2Fmap-9%2Fedit');
    useUi.getState().navigateAfterAuth();
    expect(useUi.getState().view).toBe('mapEditor');
    expect(useUi.getState().editingMapId).toBe('map-9');
    expect(path()).toBe('/maps/map-9/edit');
  });

  it('syncFromUrl(not authed) on /history gates to /login remembering the target', () => {
    window.history.replaceState(null, '', '/history');
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('login');
    expect(window.location.pathname + window.location.search).toBe('/login?redirect=%2Fhistory');
  });

  it('goHome clears a replay id', () => {
    useUi.getState().enterReplay('game-9');
    useUi.getState().goHome();
    expect(useUi.getState().replayGameId).toBeNull();
  });

  it('enterRoom clears a stale replayGameId', () => {
    useUi.getState().enterReplay('game-9');
    useUi.getState().enterRoom('ABCD');
    expect(useUi.getState().replayGameId).toBeNull();
  });

  it('syncFromUrl(authed) on /room/:code clears a stale replayGameId (browser Back from a replay)', () => {
    useUi.getState().enterReplay('game-9');
    window.history.replaceState(null, '', '/room/ABCD');
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('room');
    expect(useUi.getState().replayGameId).toBeNull();
  });

  it('navigateAfterAuth resuming a room target clears a stale replayGameId', () => {
    useUi.getState().enterReplay('game-9');
    window.history.replaceState(null, '', '/login?redirect=%2Froom%2FWXYZ');
    useUi.getState().navigateAfterAuth();
    expect(useUi.getState().view).toBe('room');
    expect(useUi.getState().replayGameId).toBeNull();
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

describe('ui store sound preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({ soundEnabled: true, soundVolume: 0.6 });
  });

  it('persists enabled + volume to localStorage', () => {
    useUi.getState().setSoundEnabled(false);
    useUi.getState().setSoundVolume(0.25);
    expect(useUi.getState().soundEnabled).toBe(false);
    expect(useUi.getState().soundVolume).toBeCloseTo(0.25);
    expect(localStorage.getItem('trm.soundEnabled')).toBe('0');
    expect(localStorage.getItem('trm.soundVolume')).toBe('0.25');
  });

  it('clamps volume to 0..1', () => {
    useUi.getState().setSoundVolume(5);
    expect(useUi.getState().soundVolume).toBe(1);
    useUi.getState().setSoundVolume(-1);
    expect(useUi.getState().soundVolume).toBe(0);
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

describe('adminSpectateFromPath', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('reads the game id and ticket from /admin-spectate/:id?ticket=...', () => {
    window.history.replaceState(null, '', '/admin-spectate/game-1?ticket=tok');
    expect(adminSpectateFromPath()).toEqual({ id: 'game-1', ticket: 'tok' });
  });

  it('returns a null ticket when the query param is missing', () => {
    window.history.replaceState(null, '', '/admin-spectate/game-1');
    expect(adminSpectateFromPath()).toEqual({ id: 'game-1', ticket: null });
  });

  it('returns null when not on an admin-spectate path', () => {
    window.history.replaceState(null, '', '/');
    expect(adminSpectateFromPath()).toBeNull();
  });
});
