import { isRunningInExpoGo } from 'expo';
import type * as ExpoNotifications from 'expo-notifications';

/**
 * `expo-notifications` crashes at IMPORT time under Expo Go on Android: SDK 53 removed remote
 * push from Expo Go, and the package's DevicePushTokenAutoRegistration side effect (Expo's own
 * push-service auto-registration, which this app never uses — see push/register.ts) calls
 * addPushTokenListener the moment the module loads, which throws there. Load it lazily behind
 * this guard so `expo start` + Expo Go still boots; push then no-ops until a real dev/production
 * build, which is the only place this app's direct FCM/APNs push needs to work anyway.
 */
export const Notifications: typeof ExpoNotifications | null = isRunningInExpoGo()
  ? null
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-notifications') as typeof ExpoNotifications);
