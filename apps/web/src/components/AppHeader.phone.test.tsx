import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { AppHeader } from './AppHeader';
import { PHONE_QUERY } from '../hooks/useMediaQuery';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';

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
