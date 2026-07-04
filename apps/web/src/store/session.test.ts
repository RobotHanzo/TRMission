import { describe, it, expect, vi, afterEach } from 'vitest';
import type { UserFeature } from '@trm/shared';
import { useSession } from './session';
import { api } from '../net/rest';

const user = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: [] as UserFeature[],
} as const;

describe('session store: logout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clears the user synchronously, before the network round-trip resolves', () => {
    // A logout whose request never resolves still must sign the user out immediately, so the
    // login route's auth gate sees the signed-out state and does not bounce to a blank home.
    vi.spyOn(api, 'logout').mockImplementation(() => new Promise(() => {}));
    useSession.setState({ user: { ...user }, accessToken: 'tok' });

    void useSession.getState().logout();

    expect(useSession.getState().user).toBeNull();
    expect(useSession.getState().accessToken).toBeNull();
  });
});

describe('session store: loginWithGoogleCredential', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applies the returned user on success', async () => {
    vi.spyOn(api, 'googleCredential').mockResolvedValue({
      user: { ...user },
      accessToken: 'tok',
    });
    useSession.setState({ user: null, accessToken: null, error: null });

    await useSession.getState().loginWithGoogleCredential('fake-jwt');

    expect(useSession.getState().user).toEqual(user);
    expect(useSession.getState().error).toBeNull();
  });

  it('sets an error message on failure', async () => {
    vi.spyOn(api, 'googleCredential').mockRejectedValue(new Error('invalid_credential'));
    useSession.setState({ user: null, accessToken: null, error: null });

    await useSession.getState().loginWithGoogleCredential('bad-jwt');

    expect(useSession.getState().user).toBeNull();
    expect(useSession.getState().error).toBe('invalid_credential');
  });
});
