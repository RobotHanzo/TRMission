import { create } from 'zustand';
import i18n from '../i18n';

export type View = 'home' | 'room' | 'game';
export type Locale = 'zh-Hant' | 'en';

interface UiState {
  view: View;
  roomCode: string | null;
  gameId: string | null;
  ticket: string | null;
  locale: Locale;
  colorBlind: boolean;
  goHome(): void;
  enterRoom(code: string): void;
  enterGame(gameId: string, ticket: string): void;
  setLocale(locale: Locale): void;
  toggleColorBlind(): void;
}

export const useUi = create<UiState>()((set) => ({
  view: 'home',
  roomCode: null,
  gameId: null,
  ticket: null,
  locale: 'zh-Hant',
  colorBlind: false,
  goHome: () => set({ view: 'home', roomCode: null, gameId: null, ticket: null }),
  enterRoom: (code) => set({ view: 'room', roomCode: code }),
  enterGame: (gameId, ticket) => set({ view: 'game', gameId, ticket }),
  setLocale: (locale) => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
    set({ locale });
  },
  toggleColorBlind: () => set((s) => ({ colorBlind: !s.colorBlind })),
}));
