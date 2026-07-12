import { isRunningInExpoGo } from 'expo';
import type * as GoogleSigninPackage from '@react-native-google-signin/google-signin';

/**
 * `@react-native-google-signin/google-signin` resolves its native module via
 * `TurboModuleRegistry.getEnforcing` at IMPORT time, which throws under Expo Go: unlike
 * `expo-*` packages, this third-party native module is never bundled inside the generic Expo Go
 * client — it needs a custom dev/production build (same as the rest of this app's native
 * surface; see apps/mobile/CLAUDE.md). Load it lazily behind this guard so `expo start` + Expo
 * Go still boots; Google sign-in then no-ops until a real dev/production build.
 */
export const GoogleSigninModule: typeof GoogleSigninPackage | null = isRunningInExpoGo()
  ? null
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@react-native-google-signin/google-signin') as typeof GoogleSigninPackage);
