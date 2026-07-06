jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-linking', () => ({ parse: jest.fn() }));
jest.mock('../net/rest', () => ({ api: { mobileCarry: jest.fn() } }));
jest.mock('../store/session', () => ({ useSession: { getState: jest.fn() } }));

import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { signInWithDiscord } from './discord';
import { api } from '../net/rest';
import { useSession } from '../store/session';
import { API_BASE } from '../config';

const mCarry = api.mobileCarry as jest.Mock;
const mOpen = WebBrowser.openAuthSessionAsync as jest.Mock;
const mParse = Linking.parse as jest.Mock;
const mGetState = useSession.getState as jest.Mock;
const loginWithDiscordExchange = jest.fn();

describe('signInWithDiscord', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mGetState.mockReturnValue({ user: { id: 'g1', isGuest: true }, loginWithDiscordExchange });
    mCarry.mockResolvedValue({ code: 'carry-123' });
    mParse.mockReturnValue({ queryParams: { code: 'exch-1' } });
    mOpen.mockResolvedValue({ type: 'success', url: 'trmission://?code=exch-1' });
  });

  it('mints a carry code, opens the server start URL, and redeems the returned code', async () => {
    await signInWithDiscord();
    expect(mCarry).toHaveBeenCalledTimes(1);
    expect(mOpen).toHaveBeenCalledWith(
      `${API_BASE}/auth/oauth/discord/start?client=mobile&carry=carry-123`,
      'trmission://',
    );
    expect(loginWithDiscordExchange).toHaveBeenCalledWith('exch-1');
  });

  it('skips the carry mint on a fresh sign-in (no current session)', async () => {
    mGetState.mockReturnValue({ user: null, loginWithDiscordExchange });
    await signInWithDiscord();
    expect(mCarry).not.toHaveBeenCalled();
    expect(mOpen).toHaveBeenCalledWith(
      `${API_BASE}/auth/oauth/discord/start?client=mobile`,
      'trmission://',
    );
    expect(loginWithDiscordExchange).toHaveBeenCalledWith('exch-1');
  });

  it('does nothing when the user dismisses the browser', async () => {
    mOpen.mockResolvedValue({ type: 'dismiss' });
    await signInWithDiscord();
    expect(loginWithDiscordExchange).not.toHaveBeenCalled();
  });

  it('throws when the callback carries an error', async () => {
    mParse.mockReturnValue({ queryParams: { error: 'access_denied' } });
    await expect(signInWithDiscord()).rejects.toThrow(/access_denied/);
    expect(loginWithDiscordExchange).not.toHaveBeenCalled();
  });
});
