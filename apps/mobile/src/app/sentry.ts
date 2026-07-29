// Sentry for apps/mobile (issue #44): errors, tracing, and (opt-in) mobile Session Replay.
//
// Relationship to `crashCapture.ts`, which stays exactly as it was: that persists the last fatal JS
// error to AsyncStorage so Settings can share it, and needs no network, no account, and no
// configuration. It is the offline/TestFlight fallback. Sentry is the online path — richer, with a
// symbolicated stack — and the two are deliberately independent so a wedged network can never cost
// us the crash report the local one already has.
//
// Opt-in by DSN, like every other surface: no `sentryDsn` in the app config means `Sentry.init` is
// never called and the SDK is inert.
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { scrubTelemetryBreadcrumb, scrubTelemetryEvent, telemetrySampleRate } from '@trm/shared';
import {
  APP_VERSION,
  BUILD_NUMBER,
  GIT_COMMIT,
  SENTRY_DSN,
  SENTRY_ENVIRONMENT,
  SENTRY_REPLAY_ERROR_SAMPLE_RATE,
  SENTRY_REPLAY_SAMPLE_RATE,
  SENTRY_TRACES_SAMPLE_RATE,
} from '../config';

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/**
 * Navigation instrumentation — must be constructed BEFORE `Sentry.init` and handed the
 * NavigationContainer ref (see App.tsx), which is how screen-to-screen transactions get their names.
 */
export const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: false,
});

let started = false;

/** Whether `initSentry` actually brought the SDK up. `@sentry/react-native` does not re-export the
 *  browser SDK's `isInitialized()`, and an un-init'd SDK simply has no client. */
const isLive = (): boolean => Sentry.getClient() !== undefined;

/**
 * Initialise Sentry if a DSN is configured. Returns whether reporting is live.
 *
 * Called from `index.ts` right after the Hermes shims and `installCrashCapture()`, so everything
 * from app-graph evaluation onward is covered. Skipped on the react-native-web harness: that is a
 * desktop testing surface, never a shipped one, and the RN SDK's native paths have no business
 * running there.
 */
export function initSentry(): boolean {
  if (started) return isLive();
  started = true;
  if (Platform.OS === 'web' || !SENTRY_DSN) return false;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    // `version+build (commit)` — the same triple Settings → About shows, so a Sentry release maps
    // one-to-one onto a store build.
    release: `${APP_VERSION}+${BUILD_NUMBER}`,
    dist: String(BUILD_NUMBER),
    sendDefaultPii: false,
    tracesSampleRate: telemetrySampleRate(SENTRY_TRACES_SAMPLE_RATE, DEFAULT_TRACES_SAMPLE_RATE),
    // Mobile Session Replay records the SCREEN. On a hidden-information game that includes the
    // player's own hand and missions, and the Skia board is a single native view whose masking we
    // have not verified on a device — so both rates default to 0 (off) and must be turned on
    // deliberately, per apps/mobile/CLAUDE.md. The integration is wired with maximal masking so
    // that when it is enabled, it starts from the safe end.
    replaysSessionSampleRate: telemetrySampleRate(SENTRY_REPLAY_SAMPLE_RATE, 0),
    replaysOnErrorSampleRate: telemetrySampleRate(SENTRY_REPLAY_ERROR_SAMPLE_RATE, 0),
    integrations: [
      navigationIntegration,
      Sentry.mobileReplayIntegration({
        maskAllText: true,
        maskAllImages: true,
        maskAllVectors: true,
      }),
    ],
    // The single denylist, shared with the server and both web apps (@trm/shared/telemetry).
    beforeSend: (event) => scrubTelemetryEvent(event),
    beforeSendTransaction: (event) => scrubTelemetryEvent(event),
    beforeBreadcrumb: (crumb) => scrubTelemetryBreadcrumb(crumb),
  });
  Sentry.setTag('trm.commit', GIT_COMMIT);
  return true;
}

/**
 * Attach (or clear) the signed-in account id — the id only, never a display name or email.
 *
 * Web and admin attach `{ id, email, username }` (and `sendDefaultPii: true`); this surface stays
 * id-only on purpose — but id-only is still LINKED under Apple's definition (association with the
 * account through any identifier), so the iOS privacy manifest declares the three diagnostic types
 * with `NSPrivacyCollectedDataTypeLinked: true` and App Store Connect's questionnaire answers the
 * same. Clearing this call is the only thing that would make Linked=false honest again; if you do
 * that, flip the manifest in the same change — and note it moves the OTA fingerprint, so it ships
 * with a fresh native build on both stores. See apps/mobile/CLAUDE.md.
 */
export function setSentryUser(userId: string | null): void {
  if (!isLive()) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Report a caught error with a stable, low-cardinality call-site tag. No-op without a DSN. */
export function captureAppError(error: unknown, tag: string): void {
  Sentry.captureException(error, (scope) => {
    scope.setTag('trm.site', tag);
    return scope;
  });
}
