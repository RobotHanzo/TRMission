import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { LandingScreen } from './LandingScreen';
import { useUi } from '../store/ui';

// Navigation actions tear down any live socket; stub the collaborator like ui.test.ts does.
vi.mock('../net/connection', () => ({ disconnectGame: vi.fn() }));

describe('LandingScreen (signed-out /)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    useUi.setState({ view: 'home', roomCode: null, gameId: null, ticket: null });
  });

  it('describes the game and offers both departures without an account', () => {
    render(<LandingScreen />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('搶占路線');
    expect(screen.getByRole('button', { name: /新手教學/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /多人對戰/ })).toBeInTheDocument();
  });

  it('the tutorial departure opens the tutorial (no login gate)', () => {
    render(<LandingScreen />);
    fireEvent.click(screen.getByRole('button', { name: /新手教學/ }));
    expect(useUi.getState().view).toBe('tutorial');
    expect(window.location.pathname).toBe('/tutorial');
  });

  it('the multiplayer departure goes to the login screen', () => {
    render(<LandingScreen />);
    fireEvent.click(screen.getByRole('button', { name: /多人對戰/ }));
    expect(useUi.getState().view).toBe('login');
    expect(window.location.pathname).toBe('/login');
  });

  it('links the privacy policy and account deletion (OAuth homepage requirements)', () => {
    render(<LandingScreen />);
    fireEvent.click(screen.getAllByRole('button', { name: '隱私權政策' })[0]!);
    expect(useUi.getState().view).toBe('privacy');
    expect(window.location.pathname).toBe('/privacy');
    expect(screen.getByRole('link', { name: '刪除帳號與資料' })).toHaveAttribute(
      'href',
      '/account/delete',
    );
  });
});
