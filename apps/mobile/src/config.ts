import * as Application from 'expo-application';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  serverOrigin?: string;
  buildNumber?: number;
  gitCommit?: string;
  googleWebClientId?: string;
  googleIosClientId?: string;
  sentryDsn?: string;
  sentryEnvironment?: string;
  sentryTracesSampleRate?: string;
  sentryReplaySampleRate?: string;
  sentryReplayErrorSampleRate?: string;
  admob?: {
    enabled?: boolean;
    units?: Record<string, { android?: string; ios?: string } | undefined>;
  };
};

/** Absolute origin of the TRMission server (the app is not served same-origin). */
export const SERVER_ORIGIN = extra.serverOrigin ?? 'https://trmission.robothanzo.dev';
/** REST base — every control-plane call hangs off this. */
export const API_BASE = `${SERVER_ORIGIN}/api/v1`;
/** Realtime WebSocket endpoint (protobuf frames). */
export const WS_URL = `${SERVER_ORIGIN.replace(/^http/, 'ws')}/ws`;
// Version identity comes from the NATIVE binary (expo-application reads CFBundleShortVersionString /
// CFBundleVersion / versionName / versionCode straight off the installed app), NOT from
// `Constants.expoConfig`: an applied OTA update REPLACES the whole expoConfig — `version` and the
// `extra` block included — with the values the publish lane happened to evaluate. The OTA lane has
// no release tag to derive them from, so trusting the config would make every updated device report
// the placeholder `0.1.0` / build 1 and the forced-update gate below would wall the app off as
// hopelessly old (issue #55). The `extra`/config values stay as the fallback for the RNW web
// harness, where expo-application has no native side and returns null.
/** Marketing version (CFBundleShortVersionString / Android versionName), e.g. "0.1.0". */
export const APP_VERSION =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'dev';
/** This binary's build number — the axis GET /version/mobile.minBuild gates against. */
export const BUILD_NUMBER = Number(Application.nativeBuildVersion) || (extra.buildNumber ?? 0);
/** Full SHA of the commit the JS currently running was built from (app.config.ts's GIT_COMMIT) —
 *  the binary's own commit until an OTA update applies, the published bundle's after. 'dev' outside
 *  a git checkout. Settings → About shows a short prefix, mirroring the admin dashboard's
 *  server/web commit rows. */
export const GIT_COMMIT = extra.gitCommit ?? 'dev';
/** Google Sign-In client ids (empty until provisioned in P6). */
export const GOOGLE_WEB_CLIENT_ID = extra.googleWebClientId ?? '';
export const GOOGLE_IOS_CLIENT_ID = extra.googleIosClientId ?? '';

// Sentry (app/sentry.ts). Baked at `expo prebuild`/bundle time from TRM_SENTRY_* env vars; unset
// ⇒ the SDK is never initialised. A DSN is an ingest endpoint, not a credential, so shipping it in
// the app config is fine — the auth token used for source-map upload never goes near `extra`.
/** Sentry ingest DSN. Empty ⇒ error reporting, tracing and replay are all off. */
export const SENTRY_DSN = extra.sentryDsn || '';
/** Environment tag; defaults to the release channel notion of "production" for store builds. */
export const SENTRY_ENVIRONMENT =
  extra.sentryEnvironment || (__DEV__ ? 'development' : 'production');
/** Fraction of navigations traced (0-1, clamped). Default 0.1. */
export const SENTRY_TRACES_SAMPLE_RATE = extra.sentryTracesSampleRate;
/** Fraction of ORDINARY sessions recorded by mobile Session Replay. Default 0 — see app/sentry.ts. */
export const SENTRY_REPLAY_SAMPLE_RATE = extra.sentryReplaySampleRate;
/** Fraction of ERRORING sessions whose buffered replay is kept. Default 0 — see app/sentry.ts. */
export const SENTRY_REPLAY_ERROR_SAMPLE_RATE = extra.sentryReplayErrorSampleRate;

// Google AdMob (src/ads/). LITERALS in app.config.ts's ADMOB block, not env vars — see the comment
// there for why (config-plugin props are an OTA fingerprint input).
/** Master switch. False ⇒ no ad renders, nothing preloads, the Mobile Ads SDK is never initialised. */
export const ADMOB_ENABLED = extra.admob?.enabled === true;
/**
 * Per-placement, per-platform ad-unit ids. Both platforms' ids ship in both binaries and
 * `src/ads/ads.ts` picks by `Platform.OS` — an ad unit belongs to exactly one AdMob app, and the
 * Android and iOS apps are separate, so the ids are NOT interchangeable.
 */
export const ADMOB_UNITS: Record<string, { android: string; ios: string }> = {
  banner: {
    android: extra.admob?.units?.banner?.android ?? '',
    ios: extra.admob?.units?.banner?.ios ?? '',
  },
  offlineGameEnd: {
    android: extra.admob?.units?.offlineGameEnd?.android ?? '',
    ios: extra.admob?.units?.offlineGameEnd?.ios ?? '',
  },
};
