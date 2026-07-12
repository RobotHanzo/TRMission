const mockSignInAsync = jest.fn();
const mockIsAvailable = jest.fn().mockResolvedValue(true);
jest.mock('expo-apple-authentication', () => ({
  signInAsync: (...a: unknown[]) => mockSignInAsync(...a),
  isAvailableAsync: (...a: unknown[]) => mockIsAvailable(...a),
}));
const mockDeleteAccount = jest.fn().mockResolvedValue(undefined);
jest.mock('../net/rest', () => ({
  api: { deleteAccount: (...a: unknown[]) => mockDeleteAccount(...a) },
}));
const mockUnregister = jest.fn().mockResolvedValue(undefined);
jest.mock('../push/register', () => ({
  unregisterDeviceForPush: (...a: unknown[]) => mockUnregister(...a),
}));
let mockMethod: string | null = 'password';
const mockClearLocal = jest.fn().mockResolvedValue(undefined);
jest.mock('../store/session', () => ({
  useSession: {
    getState: () => ({ signInMethod: mockMethod, clearLocalSession: mockClearLocal }),
  },
}));

import { Platform } from 'react-native';
import { performAccountDeletion } from './deleteAccount';

describe('performAccountDeletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteAccount.mockResolvedValue(undefined);
  });

  it('non-Apple accounts: deletes without any SIWA round-trip', async () => {
    mockMethod = 'password';
    await expect(performAccountDeletion()).resolves.toBe('deleted');
    expect(mockSignInAsync).not.toHaveBeenCalled();
    expect(mockDeleteAccount).toHaveBeenCalledWith(undefined);
    expect(mockUnregister).toHaveBeenCalled(); // token gone before the account is
    expect(mockClearLocal).toHaveBeenCalled();
  });

  it('Apple accounts: re-auths (on iOS) and forwards the fresh authorizationCode', async () => {
    mockMethod = 'apple';
    mockSignInAsync.mockResolvedValue({ authorizationCode: 'fresh-code' });
    await expect(performAccountDeletion()).resolves.toBe('deleted');
    if (Platform.OS === 'ios') {
      expect(mockDeleteAccount).toHaveBeenCalledWith('fresh-code');
    } else {
      // SIWA re-auth is an iOS-only surface; elsewhere deletion proceeds without the code.
      expect(mockDeleteAccount).toHaveBeenCalledWith(undefined);
    }
  });

  it('Apple re-auth cancelled → deletion still proceeds without the code (best-effort revocation)', async () => {
    mockMethod = 'apple';
    mockSignInAsync.mockRejectedValue(
      Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    await expect(performAccountDeletion()).resolves.toBe('deleted');
    expect(mockDeleteAccount).toHaveBeenCalledWith(undefined);
  });

  it('server failure → failed, local session untouched', async () => {
    mockMethod = 'password';
    mockDeleteAccount.mockRejectedValueOnce(new Error('409 maintainer'));
    await expect(performAccountDeletion()).resolves.toBe('failed');
    expect(mockClearLocal).not.toHaveBeenCalled();
  });
});
