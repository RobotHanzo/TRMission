import type { PublicUser } from '../net/rest';

jest.mock('../net/rest', () => ({
  api: {
    me: jest.fn(),
    guest: jest.fn(),
    login: jest.fn(),
    register: jest.fn(),
    upgrade: jest.fn(),
    googleCredential: jest.fn(),
    appleCredential: jest.fn(),
    mobileExchange: jest.fn(),
    logout: jest.fn(),
    updatePreferences: jest.fn(),
  },
  setOnTokenChange: jest.fn(),
  setAccessToken: jest.fn(),
}));
jest.mock('../net/secureStore', () => ({
  getRefreshToken: jest.fn(),
  setRefreshToken: jest.fn(),
  clearRefreshToken: jest.fn(),
}));
jest.mock('./ui', () => ({ useUi: { getState: () => ({ applyPreferences: jest.fn() }) } }));
jest.mock('../push/register', () => ({
  registerDeviceForPush: jest.fn().mockResolvedValue(undefined),
  unregisterDeviceForPush: jest.fn().mockResolvedValue(undefined),
}));

import { useSession } from './session';
import { api } from '../net/rest';
import { clearRefreshToken, getRefreshToken } from '../net/secureStore';

const mApi = api as jest.Mocked<typeof api>;
const mGetRefresh = getRefreshToken as jest.Mock;
const mClearRefresh = clearRefreshToken as jest.Mock;

const prefs = { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' } as const;
const guest: PublicUser = {
  id: 'g1',
  displayName: '旅客',
  isGuest: true,
  preferences: prefs,
  features: [],
};
const registered: PublicUser = { ...guest, id: 'u1', isGuest: false, displayName: 'Nate' };

describe('session store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSession.setState({
      user: null,
      accessToken: null,
      signInMethod: null,
      loading: false,
      booting: true,
      error: null,
    });
    mGetRefresh.mockResolvedValue(null);
    mClearRefresh.mockResolvedValue(undefined);
  });

  it('playAsGuest sets the user and marks the sign-in method', async () => {
    mApi.guest.mockResolvedValue({ user: guest, accessToken: 'a', refreshToken: 'r' });
    await useSession.getState().playAsGuest('旅客');
    expect(mApi.guest).toHaveBeenCalledWith('旅客');
    expect(useSession.getState().user).toEqual(guest);
    expect(useSession.getState().signInMethod).toBe('guest');
    expect(useSession.getState().loading).toBe(false);
  });

  it('restore() with a stored refresh token resolves the user via api.me()', async () => {
    mGetRefresh.mockResolvedValue('stored-refresh');
    mApi.me.mockResolvedValue(registered);
    await useSession.getState().restore();
    expect(mApi.me).toHaveBeenCalledTimes(1);
    expect(useSession.getState().user).toEqual(registered);
    expect(useSession.getState().booting).toBe(false);
  });

  it('restore() with no stored token skips the me() probe (fast boot)', async () => {
    mGetRefresh.mockResolvedValue(null);
    await useSession.getState().restore();
    expect(mApi.me).not.toHaveBeenCalled();
    expect(useSession.getState().user).toBeNull();
    expect(useSession.getState().booting).toBe(false);
  });

  it('loginWithAppleCredential records the apple method (P5 branches on it)', async () => {
    mApi.appleCredential.mockResolvedValue({ user: registered, accessToken: 'a', refreshToken: 'r' });
    await useSession.getState().loginWithAppleCredential('id-token', 'Nate');
    expect(mApi.appleCredential).toHaveBeenCalledWith('id-token', 'Nate');
    expect(useSession.getState().signInMethod).toBe('apple');
    expect(useSession.getState().user).toEqual(registered);
  });

  it('signOut clears local state and the keystore refresh token', async () => {
    mApi.guest.mockResolvedValue({ user: guest, accessToken: 'a', refreshToken: 'r' });
    await useSession.getState().playAsGuest();
    mApi.logout.mockResolvedValue(undefined);

    await useSession.getState().signOut();

    expect(useSession.getState().user).toBeNull();
    expect(useSession.getState().signInMethod).toBeNull();
    expect(mClearRefresh).toHaveBeenCalled();
  });

  it('an auth failure surfaces the error and leaves the user signed out', async () => {
    mApi.login.mockRejectedValue(new Error('invalid credentials'));
    await useSession.getState().login('a@b.co', 'nope');
    expect(useSession.getState().user).toBeNull();
    expect(useSession.getState().error).toBe('invalid credentials');
    expect(useSession.getState().loading).toBe(false);
  });
});
