jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-linking', () => ({ parse: jest.fn() }));
jest.mock('../net/rest', () => ({ api: { mobileCarry: jest.fn() } }));
jest.mock('../store/session', () => ({ useSession: { getState: jest.fn() } }));
jest.mock('./pkce', () => ({ generatePkcePair: jest.fn() }));

import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { signInWithApple } from './apple';
import { api } from '../net/rest';
import { useSession } from '../store/session';
import { generatePkcePair } from './pkce';
import { API_BASE } from '../config';

const mCarry = api.mobileCarry as jest.Mock;
const mOpen = WebBrowser.openAuthSessionAsync as jest.Mock;
const mParse = Linking.parse as jest.Mock;
const mGetState = useSession.getState as jest.Mock;
const mPkce = generatePkcePair as jest.Mock;
const loginWithAppleExchange = jest.fn();

describe('signInWithApple (Android redirect flow)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mGetState.mockReturnValue({ user: { id: 'g1', isGuest: true }, loginWithAppleExchange });
    mCarry.mockResolvedValue({ code: 'carry-456' });
    mPkce.mockResolvedValue({ verifier: 'verifier-def', challenge: 'challenge-uvw' });
    mParse.mockReturnValue({ queryParams: { code: 'exch-2' } });
    mOpen.mockResolvedValue({ type: 'success', url: 'trmission://?code=exch-2' });
  });

  it('mints a carry code, generates a PKCE pair, opens the start URL with the challenge, and redeems the code with the verifier', async () => {
    await signInWithApple();
    expect(mCarry).toHaveBeenCalledTimes(1);
    expect(mPkce).toHaveBeenCalledTimes(1);
    expect(mOpen).toHaveBeenCalledWith(
      `${API_BASE}/auth/oauth/apple/start?client=mobile&challenge=challenge-uvw&carry=carry-456`,
      'trmission://',
    );
    expect(loginWithAppleExchange).toHaveBeenCalledWith('exch-2', 'verifier-def');
  });

  it('skips the carry mint on a fresh sign-in (no current session) but still sends a challenge', async () => {
    mGetState.mockReturnValue({ user: null, loginWithAppleExchange });
    await signInWithApple();
    expect(mCarry).not.toHaveBeenCalled();
    expect(mOpen).toHaveBeenCalledWith(
      `${API_BASE}/auth/oauth/apple/start?client=mobile&challenge=challenge-uvw`,
      'trmission://',
    );
    expect(loginWithAppleExchange).toHaveBeenCalledWith('exch-2', 'verifier-def');
  });

  it('does nothing when the user dismisses the browser', async () => {
    mOpen.mockResolvedValue({ type: 'dismiss' });
    await signInWithApple();
    expect(loginWithAppleExchange).not.toHaveBeenCalled();
  });

  it('throws when the callback carries an error', async () => {
    mParse.mockReturnValue({ queryParams: { error: 'access_denied' } });
    await expect(signInWithApple()).rejects.toThrow(/access_denied/);
    expect(loginWithAppleExchange).not.toHaveBeenCalled();
  });
});
