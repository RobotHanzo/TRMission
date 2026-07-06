import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  serverOrigin?: string;
  buildNumber?: number;
};

/** Absolute origin of the TRMission server (the app is not served same-origin). */
export const SERVER_ORIGIN = extra.serverOrigin ?? 'http://localhost:3001';
/** REST base — every control-plane call hangs off this. */
export const API_BASE = `${SERVER_ORIGIN}/api/v1`;
/** Realtime WebSocket endpoint (protobuf frames). */
export const WS_URL = `${SERVER_ORIGIN.replace(/^http/, 'ws')}/ws`;
/** This binary's build number — the axis GET /version/mobile.minBuild gates against. */
export const BUILD_NUMBER = extra.buildNumber ?? 0;
