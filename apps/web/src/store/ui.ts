import { create } from 'zustand';
import type { Theme, Locale, BoardLayout, UserPreferences } from '../net/rest';
import { disconnectGame } from '../net/connection';
import { isAdminTarget, goToAdmin } from '../lib/adminApp';

// Re-exported so feature code keeps a single import site for these display-pref types.
//  Locale     — UI language.
//  BoardLayout — in-game arrangement of the board vs. the deck/hand/tickets panels:
//    'rail' — board fills the window; everything else stacks in a scrollable right rail.
//    'tray' — board + right rail on top; the player's hand sits in a bottom strip.
export type { Locale, BoardLayout };

export type View =
  | 'home'
  | 'room'
  | 'game'
  | 'tutorial'
  | 'login'
  | 'loginCallback'
  | 'history'
  | 'replay'
  | 'adminReplay'
  | 'adminSpectate'
  | 'maps'
  | 'mapEditor'
  | 'deleteAccount'
  | 'privacy';

// --- URL routing -----------------------------------------------------------
// The browser path is the durable source of truth for *where* the user is:
//   /                → home when signed in; the public landing page otherwise
//                      (App picks the screen off the session — never auth-gated)
//   /login           → the login screen (guest + password + OAuth)
//   /login/callback  → lands here after an OAuth round-trip; resumes the session and continues
//   /room/:code      → lobby and in-game alike (the room code re-mints a ws ticket
//                      and reports lobby-vs-started, so it is the only handle needed).
const ROOM_PATH = /^\/room\/([^/]+)$/;
const LOGIN_PATH = '/login';
const LOGIN_CALLBACK_PATH = '/login/callback';
const TUTORIAL_PATH = '/tutorial';
const HISTORY_PATH = '/history';
const REPLAY_PATH = /^\/replay\/([^/]+)$/;
const ADMIN_REPLAY_PATH = /^\/admin-replay\/([^/]+)$/;
const ADMIN_SPECTATE_PATH = /^\/admin-spectate\/([^/]+)$/;
const MAPS_PATH = '/maps';
const MAP_EDITOR_PATH = /^\/maps\/([^/]+)\/edit$/;
const DELETE_ACCOUNT_PATH = '/account/delete';
const PRIVACY_PATH = '/privacy';

export const roomCodeFromPath = (): string | null => {
  const code = ROOM_PATH.exec(window.location.pathname)?.[1];
  return code ? decodeURIComponent(code).toUpperCase() : null;
};

export const replayIdFromPath = (): string | null => {
  const id = REPLAY_PATH.exec(window.location.pathname)?.[1];
  return id ? decodeURIComponent(id) : null;
};

/** Parses `/admin-replay/:gameId?ticket=...` — the ticket-authorized maintainer route, reachable
 *  only by loading the URL directly (the dashboard mints it into a fresh tab). */
export const adminReplayFromPath = (): { id: string; ticket: string | null } | null => {
  const id = ADMIN_REPLAY_PATH.exec(window.location.pathname)?.[1];
  if (!id) return null;
  const ticket = new URLSearchParams(window.location.search).get('ticket');
  return { id: decodeURIComponent(id), ticket };
};

/** Parses `/admin-spectate/:gameId?ticket=...` — the ticket-authorized maintainer route for
 *  force-joining a LIVE game as a spectator, reachable only by loading the URL directly (the
 *  dashboard mints it into a fresh tab). */
export const adminSpectateFromPath = (): { id: string; ticket: string | null } | null => {
  const id = ADMIN_SPECTATE_PATH.exec(window.location.pathname)?.[1];
  if (!id) return null;
  const ticket = new URLSearchParams(window.location.search).get('ticket');
  return { id: decodeURIComponent(id), ticket };
};

export const mapEditorIdFromPath = (): string | null => {
  const id = MAP_EDITOR_PATH.exec(window.location.pathname)?.[1];
  return id ? decodeURIComponent(id) : null;
};

/** True when the current URL resolves to `view: 'home'` in `syncFromUrl` regardless of auth
 *  state — mirrors that function's routing minus the `authed` branches. Lets `App` render the
 *  home view (landing or, once the session probe settles, the signed-in home) immediately on a
 *  cold load instead of blocking behind the boot spinner; every other path still needs `authed`
 *  resolved before it's safe to render (or redirect), so those keep waiting on the boot gate. */
export const isHomeColdLoadPath = (): boolean => {
  const path = window.location.pathname;
  return !(
    path === TUTORIAL_PATH ||
    path === LOGIN_CALLBACK_PATH ||
    path === LOGIN_PATH ||
    path === HISTORY_PATH ||
    adminReplayFromPath() ||
    adminSpectateFromPath() ||
    replayIdFromPath() ||
    path === MAPS_PATH ||
    mapEditorIdFromPath() ||
    path === PRIVACY_PATH ||
    path === DELETE_ACCOUNT_PATH ||
    roomCodeFromPath()
  );
};

// Keep a post-login target same-origin (mirrors the server's `safeRedirect`) so the redirect
// param can never become an open redirect.
const safePath = (p: string | null | undefined): string => {
  if (!p || !p.startsWith('/') || p.startsWith('//')) return '/';
  if (p.includes('\\') || p.includes('://')) return '/';
  return p;
};
/** The `?redirect=` target carried on /login and /login/callback (validated; default '/'). */
export const readRedirectParam = (): string => {
  try {
    return safePath(new URLSearchParams(window.location.search).get('redirect'));
  } catch {
    return '/';
  }
};
const loginPathFor = (returnTo: string): string => {
  const safe = safePath(returnTo);
  return safe === '/' ? LOGIN_PATH : `${LOGIN_PATH}?redirect=${encodeURIComponent(safe)}`;
};

// Guard each navigation against a no-op so we never stack duplicate history entries.
const pushPath = (path: string): void => {
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
};
// Replace (not push) for auth-gate redirects, so the back button never bounces through /login.
const replacePath = (path: string): void => {
  if (window.location.pathname + window.location.search !== path)
    window.history.replaceState(null, '', path);
};

const THEME_KEY = 'trm.theme';
const COLOR_BLIND_KEY = 'trm.colorBlind';
const LOCALE_KEY = 'trm.locale';
const BOARD_LAYOUT_KEY = 'trm.boardLayout';
const SOUND_ENABLED_KEY = 'trm.soundEnabled';
const SOUND_VOLUME_KEY = 'trm.soundVolume';
const HIDE_ADS_KEY = 'trm.hideAds';
const THEMES: Theme[] = ['system', 'light', 'dark'];
const LOCALES: Locale[] = ['zh-Hant', 'en'];
const BOARD_LAYOUTS: BoardLayout[] = ['rail', 'tray'];

const readTheme = (): Theme => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v && (THEMES as string[]).includes(v) ? (v as Theme) : 'system';
  } catch {
    return 'system';
  }
};
const readLocale = (): Locale => {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return v && (LOCALES as string[]).includes(v) ? (v as Locale) : 'zh-Hant';
  } catch {
    return 'zh-Hant';
  }
};
const readColorBlind = (): boolean => {
  try {
    return localStorage.getItem(COLOR_BLIND_KEY) === '1';
  } catch {
    return false;
  }
};
const readBoardLayout = (): BoardLayout => {
  try {
    const v = localStorage.getItem(BOARD_LAYOUT_KEY);
    return v && (BOARD_LAYOUTS as string[]).includes(v) ? (v as BoardLayout) : 'rail';
  } catch {
    return 'rail';
  }
};
const readSoundEnabled = (): boolean => {
  try {
    const v = localStorage.getItem(SOUND_ENABLED_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
};
const readSoundVolume = (): number => {
  try {
    const v = Number(localStorage.getItem(SOUND_VOLUME_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6;
  } catch {
    return 0.6;
  }
};
const readHideAds = (): boolean => {
  try {
    return localStorage.getItem(HIDE_ADS_KEY) === '1';
  } catch {
    return false;
  }
};
const writeLocal = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — keep the value in memory only */
  }
};

interface UiState {
  view: View;
  roomCode: string | null;
  gameId: string | null;
  ticket: string | null;
  replayGameId: string | null;
  /** The ticket-authorized /admin-replay/:gameId route — game id + ticket parsed from the URL. */
  adminReplayGameId: string | null;
  adminReplayTicket: string | null;
  /** The ticket-authorized /admin-spectate/:gameId route — game id + ticket parsed from the URL. */
  adminSpectateGameId: string | null;
  adminSpectateTicket: string | null;
  /** The custom map id being edited on /maps/:id/edit. */
  editingMapId: string | null;
  locale: Locale;
  theme: Theme;
  colorBlind: boolean;
  boardLayout: BoardLayout;
  /** Sound effects on/off + volume — per-device (localStorage only, never account-synced). */
  soundEnabled: boolean;
  soundVolume: number;
  /** Ad opt-out — per-device (localStorage only). The toggle that sets it is gated behind the
   *  `adFree` account feature; AdSlot only honours it for accounts that hold that feature. */
  hideAds: boolean;
  /** "Follow the acting player" camera toggle — in-memory, off on each load. */
  followActing: boolean;
  /** The in-game rules encyclopedia overlay (a local sandbox; never touches the live game). */
  encyclopediaOpen: boolean;
  /** A one-shot request to draw the eye to a control on the home screen (e.g. after the tutorial
   *  finale, spotlight the "create game" button instead of handing the learner a separate one). */
  homeFocus: 'create' | null;
  /** Analytics only: set by the practice-vs-bots flow so `game_start` can tag the match as practice
   *  (cleared when entering a normal room). Never affects gameplay. */
  isPractice: boolean;
  /** Analytics only: how the current replay was reached — 'history' when opened in-app via
   *  `enterReplay`, else a cold `/replay/:id` link. Consumed once by `ReplayScreen`. */
  replaySource: 'history' | 'link' | null;
  goHome(): void;
  enterRoom(code: string): void;
  enterGame(gameId: string, ticket: string): void;
  /** Open the full-screen guided tutorial (a local sandbox; tears down any live game first). */
  enterTutorial(): void;
  /** Open the game-history screen (finished games the user played or spectated). */
  enterHistory(): void;
  /** Open the replay player for one finished game. */
  enterReplay(gameId: string): void;
  /** Open the custom-map list/builder screen. */
  enterMaps(): void;
  /** Open the editor for one custom map. */
  enterMapEditor(mapId: string): void;
  /** Leave the tutorial for home and spotlight the create-game button there. */
  requestCreateGame(): void;
  /** Clear a pending home-screen focus request (called once the home screen has consumed it). */
  clearHomeFocus(): void;
  /** Send an unauthenticated visitor to /login, remembering where they were headed. */
  navigateLogin(returnTo: string): void;
  /** A user-initiated trip to /login (landing CTA / header button) — PUSHED, so Back returns
   *  to where they were (navigateLogin's replace semantics are for auth-gate redirects only). */
  enterLogin(): void;
  /** Open the public privacy policy in-app (it is also cold-loadable at /privacy). */
  enterPrivacy(): void;
  /** After any successful sign-in, resume the `?redirect=` target (default home). */
  navigateAfterAuth(): void;
  /** Reconcile the view with the current browser path (initial load + back/forward). */
  syncFromUrl(authed: boolean): void;
  setLocale(locale: Locale): void;
  setTheme(theme: Theme): void;
  setColorBlind(colorBlind: boolean): void;
  setBoardLayout(boardLayout: BoardLayout): void;
  setSoundEnabled(soundEnabled: boolean): void;
  setSoundVolume(soundVolume: number): void;
  setHideAds(hideAds: boolean): void;
  setFollowActing(followActing: boolean): void;
  setEncyclopediaOpen(open: boolean): void;
  setPractice(isPractice: boolean): void;
  /** Read + reset the replay source (defaults to 'link' when unset). */
  consumeReplaySource(): 'history' | 'link';
  /** Adopt preferences from a signed-in account (the account is the source of truth). */
  applyPreferences(prefs: UserPreferences): void;
}

export const useUi = create<UiState>()((set, get) => ({
  view: 'home',
  roomCode: null,
  gameId: null,
  ticket: null,
  replayGameId: null,
  adminReplayGameId: null,
  adminReplayTicket: null,
  adminSpectateGameId: null,
  adminSpectateTicket: null,
  editingMapId: null,
  // Seed display prefs from localStorage so guests (and the pre-/auth/me window) persist them.
  locale: readLocale(),
  theme: readTheme(),
  colorBlind: readColorBlind(),
  boardLayout: readBoardLayout(),
  soundEnabled: readSoundEnabled(),
  soundVolume: readSoundVolume(),
  hideAds: readHideAds(),
  followActing: false,
  encyclopediaOpen: false,
  homeFocus: null,
  isPractice: false,
  replaySource: null,
  goHome: () => {
    disconnectGame();
    pushPath('/');
    set({ view: 'home', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  requestCreateGame: () => {
    get().goHome();
    set({ homeFocus: 'create' });
  },
  clearHomeFocus: () => set({ homeFocus: null }),
  setPractice: (isPractice) => set({ isPractice }),
  consumeReplaySource: () => {
    const source = get().replaySource ?? 'link';
    set({ replaySource: null });
    return source;
  },
  enterRoom: (code) => {
    pushPath(`/room/${code}`);
    set({ view: 'room', roomCode: code, replayGameId: null });
  },
  // The URL is already /room/:code (the room was entered first), so leave it untouched.
  enterGame: (gameId, ticket) => set({ view: 'game', gameId, ticket }),
  enterTutorial: () => {
    disconnectGame();
    pushPath(TUTORIAL_PATH);
    set({ view: 'tutorial', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  enterHistory: () => {
    disconnectGame();
    pushPath(HISTORY_PATH);
    set({ view: 'history', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  enterReplay: (gameId) => {
    disconnectGame();
    pushPath(`/replay/${encodeURIComponent(gameId)}`);
    set({
      view: 'replay',
      replayGameId: gameId,
      replaySource: 'history',
      roomCode: null,
      gameId: null,
      ticket: null,
    });
  },
  enterMaps: () => {
    disconnectGame();
    pushPath(MAPS_PATH);
    set({ view: 'maps', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  enterMapEditor: (mapId) => {
    disconnectGame();
    pushPath(`/maps/${encodeURIComponent(mapId)}/edit`);
    set({ view: 'mapEditor', editingMapId: mapId, roomCode: null, gameId: null, ticket: null });
  },
  navigateLogin: (returnTo) => {
    disconnectGame();
    replacePath(loginPathFor(returnTo));
    set({ view: 'login', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  enterLogin: () => {
    disconnectGame();
    pushPath(LOGIN_PATH);
    set({ view: 'login', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  enterPrivacy: () => {
    disconnectGame();
    pushPath(PRIVACY_PATH);
    set({ view: 'privacy', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  navigateAfterAuth: () => {
    const target = readRedirectParam();
    if (isAdminTarget(target)) {
      goToAdmin(target);
      return;
    }
    const code = ROOM_PATH.exec(target)?.[1];
    if (code) {
      // Replace (not push) the /login (or /login/callback) entry — routing through enterRoom would
      // PUSH /room/:code on top of it, trapping the back button into re-entering the room.
      const room = decodeURIComponent(code).toUpperCase();
      replacePath(`/room/${room}`);
      set({ view: 'room', roomCode: room, replayGameId: null });
      return;
    }
    if (target === HISTORY_PATH) {
      replacePath(HISTORY_PATH);
      set({ view: 'history', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    const replayId = REPLAY_PATH.exec(target)?.[1];
    if (replayId) {
      const id = decodeURIComponent(replayId);
      replacePath(`/replay/${encodeURIComponent(id)}`);
      set({ view: 'replay', replayGameId: id, roomCode: null, gameId: null, ticket: null });
      return;
    }
    if (target === MAPS_PATH) {
      replacePath(MAPS_PATH);
      set({ view: 'maps', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    const editingMapId = MAP_EDITOR_PATH.exec(target)?.[1];
    if (editingMapId) {
      const id = decodeURIComponent(editingMapId);
      replacePath(`/maps/${encodeURIComponent(id)}/edit`);
      set({ view: 'mapEditor', editingMapId: id, roomCode: null, gameId: null, ticket: null });
      return;
    }
    if (target === DELETE_ACCOUNT_PATH) {
      replacePath(DELETE_ACCOUNT_PATH);
      set({
        view: 'deleteAccount',
        roomCode: null,
        gameId: null,
        ticket: null,
        replayGameId: null,
      });
      return;
    }
    replacePath('/');
    set({ view: 'home', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  syncFromUrl: (authed) => {
    const path = window.location.pathname;
    // The tutorial is a self-contained local sandbox — reachable without an account.
    if (path === TUTORIAL_PATH) {
      disconnectGame();
      set({ view: 'tutorial', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    // The OAuth landing page: resume the session (App's restore()) then continue; the
    // LoginCallback screen handles both the success redirect and any ?error.
    if (path === LOGIN_CALLBACK_PATH) {
      disconnectGame();
      set({
        view: 'loginCallback',
        roomCode: null,
        gameId: null,
        ticket: null,
        replayGameId: null,
      });
      return;
    }
    // Already signed in but sitting on /login → bounce straight to the intended target.
    if (path === LOGIN_PATH) {
      if (authed) {
        get().navigateAfterAuth();
        return;
      }
      disconnectGame();
      set({ view: 'login', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    // History + replay are account-scoped — gate unauthenticated visitors like rooms.
    if (path === HISTORY_PATH) {
      if (!authed) {
        get().navigateLogin(HISTORY_PATH);
        return;
      }
      disconnectGame();
      set({ view: 'history', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    // Ticket-authorized maintainer view — never auth-gated (the ticket is the sole
    // authority), reachable from a fresh tab with no prior session in this app.
    const adminReplay = adminReplayFromPath();
    if (adminReplay) {
      disconnectGame();
      set({
        view: 'adminReplay',
        adminReplayGameId: adminReplay.id,
        adminReplayTicket: adminReplay.ticket,
        roomCode: null,
        gameId: null,
        ticket: null,
        replayGameId: null,
      });
      return;
    }
    // Ticket-authorized maintainer view — never auth-gated (the ticket is the sole authority),
    // reachable from a fresh tab with no prior session in this app. Force-joins a LIVE game as
    // a spectator, bypassing the room's allowSpectating setting.
    const adminSpectate = adminSpectateFromPath();
    if (adminSpectate) {
      disconnectGame();
      set({
        view: 'adminSpectate',
        adminSpectateGameId: adminSpectate.id,
        adminSpectateTicket: adminSpectate.ticket,
        roomCode: null,
        gameId: null,
        ticket: null,
        replayGameId: null,
      });
      return;
    }
    // Replays are NOT auth-gated: a view-by-link replay is watchable while signed out
    // (the server still 404s private ones; the screen then offers the sign-in path).
    const replayId = replayIdFromPath();
    if (replayId) {
      disconnectGame();
      set({
        view: 'replay',
        replayGameId: replayId,
        roomCode: null,
        gameId: null,
        ticket: null,
      });
      return;
    }
    // The custom-map builder is account-scoped too (authoring requires a registered account,
    // but the screen itself just needs a signed-in session to list/fetch — the server enforces
    // the registered-only check on authoring routes).
    if (path === MAPS_PATH) {
      if (!authed) {
        get().navigateLogin(MAPS_PATH);
        return;
      }
      disconnectGame();
      set({ view: 'maps', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    const editingMapId = mapEditorIdFromPath();
    if (editingMapId) {
      if (!authed) {
        get().navigateLogin(`/maps/${encodeURIComponent(editingMapId)}/edit`);
        return;
      }
      disconnectGame();
      set({ view: 'mapEditor', editingMapId, roomCode: null, gameId: null, ticket: null });
      return;
    }
    // Public privacy policy — reachable signed out (store listings link straight here).
    if (path === PRIVACY_PATH) {
      disconnectGame();
      set({ view: 'privacy', roomCode: null, gameId: null, ticket: null, replayGameId: null });
      return;
    }
    // Account deletion (Play Data-safety URL): the login gate is the re-auth for cold visits.
    if (path === DELETE_ACCOUNT_PATH) {
      if (!authed) {
        get().navigateLogin(DELETE_ACCOUNT_PATH);
        return;
      }
      disconnectGame();
      set({
        view: 'deleteAccount',
        roomCode: null,
        gameId: null,
        ticket: null,
        replayGameId: null,
      });
      return;
    }
    // Entering a room needs an authenticated session; otherwise gate to /login and remember it.
    const code = roomCodeFromPath();
    if (code) {
      if (authed) {
        set({ view: 'room', roomCode: code, replayGameId: null });
        return;
      }
      get().navigateLogin(`/room/${code}`);
      return;
    }
    // Home (or any unknown path). '/' is never auth-gated: App renders the public landing
    // page for signed-out visitors and the lobby for signed-in users off the same view.
    disconnectGame();
    set({ view: 'home', roomCode: null, gameId: null, ticket: null, replayGameId: null });
  },
  setLocale: (locale) => {
    writeLocal(LOCALE_KEY, locale);
    set({ locale });
  },
  setTheme: (theme) => {
    writeLocal(THEME_KEY, theme);
    set({ theme });
  },
  setColorBlind: (colorBlind) => {
    writeLocal(COLOR_BLIND_KEY, colorBlind ? '1' : '0');
    set({ colorBlind });
  },
  setBoardLayout: (boardLayout) => {
    writeLocal(BOARD_LAYOUT_KEY, boardLayout);
    set({ boardLayout });
  },
  setSoundEnabled: (soundEnabled) => {
    writeLocal(SOUND_ENABLED_KEY, soundEnabled ? '1' : '0');
    set({ soundEnabled });
  },
  setSoundVolume: (soundVolume) => {
    const v = Math.max(0, Math.min(1, soundVolume));
    writeLocal(SOUND_VOLUME_KEY, String(v));
    set({ soundVolume: v });
  },
  setHideAds: (hideAds) => {
    writeLocal(HIDE_ADS_KEY, hideAds ? '1' : '0');
    set({ hideAds });
  },
  setFollowActing: (followActing) => set({ followActing }),
  setEncyclopediaOpen: (encyclopediaOpen) => set({ encyclopediaOpen }),
  applyPreferences: (prefs) => {
    writeLocal(THEME_KEY, prefs.theme);
    writeLocal(COLOR_BLIND_KEY, prefs.colorBlind ? '1' : '0');
    writeLocal(LOCALE_KEY, prefs.locale);
    writeLocal(BOARD_LAYOUT_KEY, prefs.boardLayout);
    set({
      theme: prefs.theme,
      colorBlind: prefs.colorBlind,
      locale: prefs.locale,
      boardLayout: prefs.boardLayout,
    });
  },
}));
