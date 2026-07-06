jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
}));
jest.mock('../net/rest', () => ({ api: { registerDevice: jest.fn(), removeDevice: jest.fn() } }));

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerDeviceForPush, unregisterDeviceForPush } from './register';
import { api } from '../net/rest';

const mPerms = Notifications.getPermissionsAsync as jest.Mock;
const mReq = Notifications.requestPermissionsAsync as jest.Mock;
const mToken = Notifications.getDevicePushTokenAsync as jest.Mock;
const mRegister = api.registerDevice as jest.Mock;
const mRemove = api.removeDevice as jest.Mock;
const expectedPlatform = Platform.OS === 'ios' ? 'ios' : 'android';

describe('push registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers the native device token when permission is already granted', async () => {
    mPerms.mockResolvedValue({ granted: true, canAskAgain: true });
    mToken.mockResolvedValue({ type: 'ios', data: 'native-token-abc' });
    mRegister.mockResolvedValue(undefined);

    await registerDeviceForPush();

    expect(mReq).not.toHaveBeenCalled();
    expect(mRegister).toHaveBeenCalledWith(expectedPlatform, 'native-token-abc');
  });

  it('requests permission when not yet granted, then registers', async () => {
    mPerms.mockResolvedValue({ granted: false, canAskAgain: true });
    mReq.mockResolvedValue({ granted: true });
    mToken.mockResolvedValue({ type: 'android', data: 'tok' });
    mRegister.mockResolvedValue(undefined);

    await registerDeviceForPush();

    expect(mReq).toHaveBeenCalledTimes(1);
    expect(mRegister).toHaveBeenCalledWith(expectedPlatform, 'tok');
  });

  it('is a no-op when permission is denied', async () => {
    mPerms.mockResolvedValue({ granted: false, canAskAgain: false });

    await registerDeviceForPush();

    expect(mReq).not.toHaveBeenCalled();
    expect(mRegister).not.toHaveBeenCalled();
  });

  it('unregister removes the last registered token', async () => {
    mPerms.mockResolvedValue({ granted: true, canAskAgain: true });
    mToken.mockResolvedValue({ type: 'ios', data: 'tok-1' });
    mRegister.mockResolvedValue(undefined);
    mRemove.mockResolvedValue(undefined);

    await registerDeviceForPush();
    await unregisterDeviceForPush();

    expect(mRemove).toHaveBeenCalledWith('tok-1');
  });
});
