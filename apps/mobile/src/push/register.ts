import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../net/rest';

// The last native token we registered, so sign-out can unregister exactly it.
let registeredToken: string | null = null;

/**
 * Register this device for push: ensure notification permission, fetch the NATIVE device token
 * (FCM on Android / APNs on iOS — NOT an Expo push token; the P0 server talks to FCM/APNs directly),
 * and hand it to the account. A no-op when permission is denied.
 *
 * P1 registers right after a successful sign-in. P5 owns the fuller lifecycle (contextual prompt
 * timing, foreground suppression, tap deep-links).
 */
export async function registerDeviceForPush(): Promise<void> {
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && current.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return;

  const token = await Notifications.getDevicePushTokenAsync();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const value = String(token.data);
  await api.registerDevice(platform, value);
  registeredToken = value;
}

/** Unregister this device's push token (sign-out). Requires a still-valid access token. */
export async function unregisterDeviceForPush(): Promise<void> {
  if (!registeredToken) return;
  await api.removeDevice(registeredToken).catch(() => undefined);
  registeredToken = null;
}
