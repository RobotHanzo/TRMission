import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { UserFeature } from '@trm/shared';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { AppHeader } from './AppHeader';
import { PHONE_QUERY } from '../hooks/useMediaQuery';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { useGame } from '../store/game';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';

// jsdom has no matchMedia; pretend to be a phone — PHONE_QUERY matches, everything else doesn't.
const phoneMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: query === PHONE_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: ['mapBuilder'] as UserFeature[],
  tutorialCompleted: true,
} as const;

describe('AppHeader phone hamburger menu', () => {
  beforeEach(() => {
    useSession.setState({ user: { ...signedIn } });
    useUi.setState({ view: 'home' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('desktop (default jsdom) keeps the icon-button row and no hamburger', () => {
    render(<AppHeader />);
    expect(screen.queryByRole('button', { name: '選單' })).toBeNull();
    expect(screen.getByRole('button', { name: '設定' })).toBeInTheDocument();
    expect(document.querySelector('.user-chip')).not.toBeNull();
  });

  it('phone collapses every action into the hamburger', () => {
    vi.stubGlobal('matchMedia', phoneMatchMedia);
    render(<AppHeader />);
    expect(screen.getByRole('button', { name: '選單' })).toBeInTheDocument();
    // No loose action buttons or user chip in the bar itself.
    expect(screen.queryByRole('button', { name: '設定' })).toBeNull();
    expect(document.querySelector('.user-chip')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('the menu lists identity + actions, and opens Settings', () => {
    vi.stubGlobal('matchMedia', phoneMatchMedia);
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: '選單' }));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('Tester');
    expect(screen.getByRole('menuitem', { name: '對局紀錄' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '我的地圖' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '規則百科' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '登出' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '設定' }));
    // The menu closes and the settings modal opens.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('heading', { name: /設定/ })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

const gameSnap = () =>
  create(GameSnapshotSchema, {
    stateVersion: 1,
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'p0',
    turnOrder: ['p0', 'p1'],
    players: [
      { id: 'p0', seat: 0, trainCars: 45, stationsRemaining: 3 },
      { id: 'p1', seat: 1, trainCars: 45, stationsRemaining: 3 },
    ],
  });

describe('AppHeader phone leave confirmation', () => {
  afterEach(() => {
    useGame.setState({ snapshot: null });
    useUi.setState({ view: 'home' });
    vi.unstubAllGlobals();
  });

  it('confirms before leaving an active game from the hamburger menu', () => {
    vi.stubGlobal('matchMedia', phoneMatchMedia);
    useUi.setState({ view: 'game' });
    useGame.setState({ snapshot: gameSnap() });
    render(<AppHeader />);
    fireEvent.click(screen.getByRole('button', { name: '選單' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '離開房間' }));
    expect(useUi.getState().view).toBe('game'); // unchanged until confirmed
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(useUi.getState().view).toBe('home');
  });
});
