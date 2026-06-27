import { create } from 'zustand';
import type { Theme, UserPreferences } from '../net/rest';
import { disconnectGame } from '../net/connection';

export type View = 'home' | 'room' | 'game';
export type Locale = 'zh-Hant' | 'en';
/** In-game arrangement of the board vs. the deck/hand/tickets panels.
 *  'rail' — board fills the window; everything else stacks in a scrollable right rail.
 *  'tray' — board + right rail on top; the player's hand sits in a bottom strip. */
export type BoardLayout = 'rail' | 'tray';

// --- URL routing -----------------------------------------------------------
// The browser path is the durable source of truth for *where* the user is:
//   /            → home
//   /room/:code  → lobby and in-game alike (the room code re-mints a ws ticket
//                  and reports lobby-vs-started, so it is the only handle needed).
const ROOM_PATH = /^\/room\/([^/]+)$/;

export const roomCodeFromPath = (): string | null => {
  const code = ROOM_PATH.exec(window.location.pathname)?.[1];
  return code ? decodeURIComponent(code).toUpperCase() : null;
};
// Guard each navigation against a no-op so we never stack duplicate history entries.
const pushPath = (path: string): void => {
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
};

const THEME_KEY = 'trm.theme';
const COLOR_BLIND_KEY = 'trm.colorBlind';
const LOCALE_KEY = 'trm.locale';
const BOARD_LAYOUT_KEY = 'trm.boardLayout';
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
  locale: Locale;
  theme: Theme;
  colorBlind: boolean;
  boardLayout: BoardLayout;
  /** "Follow the acting player" camera toggle — in-memory, off on each load. */
  followActing: boolean;
  goHome(): void;
  enterRoom(code: string): void;
  enterGame(gameId: string, ticket: string): void;
  /** Reconcile the view with the current browser path (initial load + back/forward). */
  syncFromUrl(authed: boolean): void;
  setLocale(locale: Locale): void;
  setTheme(theme: Theme): void;
  setColorBlind(colorBlind: boolean): void;
  setBoardLayout(boardLayout: BoardLayout): void;
  setFollowActing(followActing: boolean): void;
  /** Adopt preferences from a signed-in account (the account is the source of truth). */
  applyPreferences(prefs: UserPreferences): void;
}

export const useUi = create<UiState>()((set) => ({
  view: 'home',
  roomCode: null,
  gameId: null,
  ticket: null,
  // Seed display prefs from localStorage so guests (and the pre-/auth/me window) persist them.
  locale: readLocale(),
  theme: readTheme(),
  colorBlind: readColorBlind(),
  boardLayout: readBoardLayout(),
  followActing: false,
  goHome: () => {
    disconnectGame();
    pushPath('/');
    set({ view: 'home', roomCode: null, gameId: null, ticket: null });
  },
  enterRoom: (code) => {
    pushPath(`/room/${code}`);
    set({ view: 'room', roomCode: code });
  },
  // The URL is already /room/:code (the room was entered first), so leave it untouched.
  enterGame: (gameId, ticket) => set({ view: 'game', gameId, ticket }),
  syncFromUrl: (authed) => {
    const code = roomCodeFromPath();
    // Entering a room needs an authenticated session.
    if (code && authed) {
      set({ view: 'room', roomCode: code });
      return;
    }
    // No room, or a /room/:code link opened while logged out. In the logged-out case we
    // deliberately keep the URL untouched so signing in (or playing as guest) can resume
    // straight into that room — see the resume effect in App. The auth gate shows because
    // there is no user yet.
    disconnectGame();
    set({ view: 'home', roomCode: null, gameId: null, ticket: null });
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
  // Layout is a client-only display choice (not part of the synced account preferences).
  setBoardLayout: (boardLayout) => {
    writeLocal(BOARD_LAYOUT_KEY, boardLayout);
    set({ boardLayout });
  },
  setFollowActing: (followActing) => set({ followActing }),
  applyPreferences: (prefs) => {
    writeLocal(THEME_KEY, prefs.theme);
    writeLocal(COLOR_BLIND_KEY, prefs.colorBlind ? '1' : '0');
    set({ theme: prefs.theme, colorBlind: prefs.colorBlind });
  },
}));
