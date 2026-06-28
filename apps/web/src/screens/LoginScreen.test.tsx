import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import { LoginScreen } from './LoginScreen';
import { api } from '../net/rest';
import { useSession } from '../store/session';

describe('LoginScreen', () => {
  beforeEach(() => useSession.setState({ user: null, error: null, loading: false }));
  afterEach(() => vi.restoreAllMocks());

  it('renders only the enabled methods (guest + Google, no password)', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({
      passwordLogin: false,
      guest: true,
      providers: { google: true, discord: false },
    });
    render(<LoginScreen />);

    expect(await screen.findByRole('button', { name: '以訪客身分遊玩' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使用 Google 繼續' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '使用 Discord 繼續' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('電子郵件')).not.toBeInTheDocument();
  });

  it('shows the password tabs + both providers when everything is enabled', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({
      passwordLogin: true,
      guest: true,
      providers: { google: true, discord: true },
    });
    render(<LoginScreen />);

    expect(await screen.findByRole('link', { name: '使用 Discord 繼續' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使用 Google 繼續' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '登入' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '註冊' })).toBeInTheDocument();
  });

  it('points the Google button at the start route, forwarding the redirect target', async () => {
    window.history.replaceState(null, '', '/login?redirect=%2Froom%2FABCD');
    vi.spyOn(api, 'config').mockResolvedValue({
      passwordLogin: false,
      guest: false,
      providers: { google: true, discord: false },
    });
    render(<LoginScreen />);

    const link = await screen.findByRole('link', { name: '使用 Google 繼續' });
    expect(link).toHaveAttribute(
      'href',
      '/api/v1/auth/oauth/google/start?redirect=%2Froom%2FABCD',
    );
  });

  it('reports when no sign-in method is available', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({
      passwordLogin: false,
      guest: false,
      providers: { google: false, discord: false },
    });
    render(<LoginScreen />);

    expect(await screen.findByText('目前沒有可用的登入方式，請稍後再試。')).toBeInTheDocument();
  });
});
