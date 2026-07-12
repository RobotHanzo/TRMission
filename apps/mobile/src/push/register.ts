import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../net/rest';
import { useSettings } from '../store/settings';

// The last native token we registered, so sign-out can unregister exactly it.
let registeredToken: string | null = null;

const platform = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');

/** Android 8+ requires a channel before any notification can display. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'TRMission',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Register the NATIVE device token (FCM on Android / APNs on iOS — NOT an Expo push token; the
 * P0 server talks to FCM/APNs directly) with the account. Returns false — and does nothing —
 * without OS permission. Permission REQUESTS only ever come from the contextual prompt or the
 * settings toggle, never implicitly from here.
 */
export async function ensurePushRegistration(): Promise<boolean> {
  const perms = await Notifications.getPermissionsAsync();
  if (!perms.granted) return false;
  await ensureAndroidChannel();
  const token = await Notifications.getDevicePushTokenAsync();
  const value = String(token.data);
  await api.registerDevice(platform(), value);
  registeredToken = value;
  return true;
}

/**
 * The session-lifecycle hook (after sign-in and after boot-time restore): registers iff the
 * user opted in (settings.notifications) AND the OS permission is already granted. The OS
 * grant alone is not consent — the in-app toggle can be off while the permission stays granted.
 */
export async function registerDeviceForPush(): Promise<void> {
  if (!useSettings.getState().notifications) return;
  await ensurePushRegistration().catch(() => undefined);
}

/** Unregister this device's push token. Call BEFORE logout revokes the Bearer. Safe to repeat. */
export async function unregisterDeviceForPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  await api.removeDevice(token).catch(() => undefined);
}

/** FCM/APNs rotate tokens; keep the server registry current. Returns the unsubscribe. */
export function watchTokenRotation(): () => void {
  const sub = Notifications.addPushTokenListener((t) => {
    void (async () => {
      const value = String(t.data);
      if (!value || value === registeredToken) return;
      try {
        await api.registerDevice(platform(), value);
        registeredToken = value;
      } catch {
        // Best-effort: retried on the next sign-in/restore registration.
      }
    })();
  });
  return () => sub.remove();
}
