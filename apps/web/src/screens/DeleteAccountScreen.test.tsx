import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type * as RestModule from '../net/rest';
import '../i18n';
import { DeleteAccountScreen } from './DeleteAccountScreen';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { api, ApiError, type PublicUser } from '../net/rest';

vi.mock('../net/connection', () => ({ disconnectGame: vi.fn(), connectGame: vi.fn() }));
vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof RestModule>();
  return {
    ...mod,
    setOnTokenChange: vi.fn(),
    setAccessToken: vi.fn(),
    api: { deleteAccount: vi.fn() },
  };
});

const mocked = api as unknown as { deleteAccount: ReturnType<typeof vi.fn> };

const user: PublicUser = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: [],
};

describe('DeleteAccountScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({ user: { ...user }, booting: false });
    window.history.replaceState(null, '', '/account/delete');
  });

  it('routing: an anonymous visit gates to /login with the redirect param', () => {
    useSession.setState({ user: null });
    useUi.getState().syncFromUrl(false);
    expect(useUi.getState().view).toBe('login');
    expect(window.location.search).toContain('redirect=%2Faccount%2Fdelete');
  });

  it('routing: an authed visit lands on the screen', () => {
    useUi.getState().syncFromUrl(true);
    expect(useUi.getState().view).toBe('deleteAccount');
  });

  it('keeps the button disabled until the display name is typed, then deletes', async () => {
    mocked.deleteAccount.mockResolvedValue(undefined);
    render(<DeleteAccountScreen />);
    const confirm = screen.getByRole('button', { name: /永久刪除帳號/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/輸入.*Tester/), { target: { value: 'Tester' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocked.deleteAccount).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/帳號已刪除/)).toBeInTheDocument();
    expect(useSession.getState().user).toBeNull();
  });

  it('surfaces the maintainer 409 as a specific message', async () => {
    mocked.deleteAccount.mockRejectedValue(new ApiError(409, 'maintainer'));
    render(<DeleteAccountScreen />);
    fireEvent.change(screen.getByLabelText(/輸入.*Tester/), { target: { value: 'Tester' } });
    fireEvent.click(screen.getByRole('button', { name: /永久刪除帳號/ }));
    expect(await screen.findByText(/仍具有維護者權限/)).toBeInTheDocument();
  });
});
