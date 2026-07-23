import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  serverOrigin?: string;
  buildNumber?: number;
  gitCommit?: string;
  googleWebClientId?: string;
  googleIosClientId?: string;
};

/** Absolute origin of the TRMission server (the app is not served same-origin). */
export const SERVER_ORIGIN = extra.serverOrigin ?? 'https://trmission.robothanzo.dev';
/** REST base — every control-plane call hangs off this. */
export const API_BASE = `${SERVER_ORIGIN}/api/v1`;
/** Realtime WebSocket endpoint (protobuf frames). */
export const WS_URL = `${SERVER_ORIGIN.replace(/^http/, 'ws')}/ws`;
/** Marketing version (CFBundleShortVersionString / Android versionName), e.g. "0.1.0". */
export const APP_VERSION = Constants.expoConfig?.version ?? 'dev';
/** This binary's build number — the axis GET /version/mobile.minBuild gates against. */
export const BUILD_NUMBER = extra.buildNumber ?? 0;
/** Full SHA of the commit this binary was built from (app.config.ts's GIT_COMMIT) — 'dev' outside
 *  a git checkout. Settings → About shows a short prefix, mirroring the admin dashboard's
 *  server/web commit rows. */
export const GIT_COMMIT = extra.gitCommit ?? 'dev';
/** Google Sign-In client ids (empty until provisioned in P6). */
export const GOOGLE_WEB_CLIENT_ID = extra.googleWebClientId ?? '';
export const GOOGLE_IOS_CLIENT_ID = extra.googleIosClientId ?? '';
