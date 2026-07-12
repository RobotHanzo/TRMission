jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));
jest.mock('../net/rest', () => ({ api: { registerDevice: jest.fn(), removeDevice: jest.fn() } }));

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  ensurePushRegistration,
  registerDeviceForPush,
  unregisterDeviceForPush,
  watchTokenRotation,
} from './register';
import { api } from '../net/rest';
import { useSettings } from '../store/settings';

const mPerms = Notifications.getPermissionsAsync as jest.Mock;
const mReq = Notifications.requestPermissionsAsync as jest.Mock;
const mToken = Notifications.getDevicePushTokenAsync as jest.Mock;
const mListen = Notifications.addPushTokenListener as jest.Mock;
const mRegister = api.registerDevice as jest.Mock;
const mRemove = api.removeDevice as jest.Mock;
const expectedPlatform = Platform.OS === 'ios' ? 'ios' : 'android';

describe('push registration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mRegister.mockResolvedValue(undefined);
    mRemove.mockResolvedValue(undefined);
    await unregisterDeviceForPush(); // forget any token a previous test registered
    jest.clearAllMocks();
  });

  it('ensurePushRegistration registers the native token when permission is granted', async () => {
    mPerms.mockResolvedValue({ granted: true, canAskAgain: true });
    mToken.mockResolvedValue({ type: 'ios', data: 'native-token-abc' });

    await expect(ensurePushRegistration()).resolves.toBe(true);

    expect(mReq).not.toHaveBeenCalled();
    expect(mRegister).toHaveBeenCalledWith(expectedPlatform, 'native-token-abc');
  });

  it('NEVER requests permission implicitly — no permission means a false no-op', async () => {
    mPerms.mockResolvedValue({ granted: false, canAskAgain: true });

    await expect(ensurePushRegistration()).resolves.toBe(false);

    expect(mReq).not.toHaveBeenCalled();
    expect(mRegister).not.toHaveBeenCalled();
  });

  it('the session hook is settings-gated: opted out ⇒ nothing, opted in ⇒ registers', async () => {
    mPerms.mockResolvedValue({ granted: true, canAskAgain: true });
    mToken.mockResolvedValue({ type: 'android', data: 'tok' });

    useSettings.setState({ notifications: false });
    await registerDeviceForPush();
    expect(mRegister).not.toHaveBeenCalled();

    useSettings.setState({ notifications: true });
    await registerDeviceForPush();
    expect(mRegister).toHaveBeenCalledWith(expectedPlatform, 'tok');
  });

  it('unregister removes the remembered token exactly once', async () => {
    mPerms.mockResolvedValue({ granted: true, canAskAgain: true });
    mToken.mockResolvedValue({ type: 'ios', data: 'tok-1' });

    await ensurePushRegistration();
    await unregisterDeviceForPush();
    expect(mRemove).toHaveBeenCalledWith('tok-1');

    await unregisterDeviceForPush(); // nothing remembered any more
    expect(mRemove).toHaveBeenCalledTimes(1);
  });

  it('token rotation re-registers the NEW token', async () => {
    mPerms.mockResolvedValue({ granted: true, canAskAgain: true });
    mToken.mockResolvedValue({ type: 'android', data: 'tok-old' });
    await ensurePushRegistration();

    watchTokenRotation();
    const cb = mListen.mock.calls[0]![0] as (t: unknown) => void;
    cb({ type: 'android', data: 'tok-new' });
    await new Promise((r) => setTimeout(r, 0));

    expect(mRegister).toHaveBeenLastCalledWith(expectedPlatform, 'tok-new');
  });
});
