// Minimal typed runtime config.
const day = 24 * 60 * 60 * 1000;

export const env = {
  port: Number(process.env.PORT ?? 3001),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB ?? 'trmission',
  /** Git commit SHA baked into the running build (CI build-arg → Docker ENV). 'dev' locally. */
  gitCommit: process.env.GIT_COMMIT ?? 'dev',
  /** Persistence is on by default; set TRM_PERSISTENCE=0 to run purely in-memory (no auth/lobby). */
  persistence: process.env.TRM_PERSISTENCE !== '0',
  /** When set, seed a demo game on boot and log dev tickets for manual smoke play. */
  devGame: process.env.TRM_DEV_GAME === '1',
  /** Delay between consecutive bot moves (ms) so humans can follow the play. */
  botMoveDelayMs: Number(process.env.TRM_BOT_DELAY_MS ?? 600),
  /** Per-turn time limit (ms); on lapse the server auto-plays a default action (issue #13).
   *  Default 75s; 0 disables the timer entirely (used in tests). */
  turnTimeoutMs: Number(process.env.TRM_TURN_TIMEOUT_MS ?? 75_000),
  /** Force-update floor for the mobile app: builds below this are told to update. 0 = off. */
  mobileMinBuild: Number(process.env.MOBILE_MIN_BUILD ?? 0),

  // Mobile push (src/push). Each platform enables only when ALL of its credentials are set.
  fcmProjectId: process.env.FCM_PROJECT_ID ?? '',
  fcmClientEmail: process.env.FCM_CLIENT_EMAIL ?? '',
  fcmPrivateKey: (process.env.FCM_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  apnsTeamId: process.env.APNS_TEAM_ID ?? '',
  apnsKeyId: process.env.APNS_KEY_ID ?? '',
  apnsPrivateKey: (process.env.APNS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  apnsBundleId: process.env.APNS_BUNDLE_ID ?? '',
  apnsSandbox: process.env.APNS_SANDBOX === '1',
  /** Debounce before a your-turn push to a socketless player (ms; 0 = immediate). */
  pushYourTurnDelayMs: Number(process.env.PUSH_YOUR_TURN_DELAY_MS ?? 15_000),

  // Auth (Step C). The default secret is for local dev only — set JWT_SECRET in prod.
  jwtSecret: process.env.JWT_SECRET ?? 'dev-insecure-secret-change-me',
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  /** ws-game ticket lifetime (short — it's redeemed immediately for a socket). */
  wsTicketTtl: process.env.WS_TICKET_TTL ?? '45s',
  /** Admin replay ticket lifetime — short-lived handoff from the dashboard to apps/web's
   *  ticket-authorized replay route (ADR: same pattern as the ws-game ticket). */
  adminReplayTicketTtl: process.env.ADMIN_REPLAY_TICKET_TTL ?? '5m',
  refreshTtlMs: Number(process.env.REFRESH_TTL_MS ?? 30 * day),
  guestTtlMs: Number(process.env.GUEST_TTL_MS ?? 30 * day),
  cookieSecure: process.env.COOKIE_SECURE === '1',
  /** CORS allowlist (comma-separated). Empty ⇒ reflect dev origin. */
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),

  // Auth-method toggles. Each entry method is independently switchable; the web reads the
  // resulting flags from GET /auth/config and the server enforces them (UI hiding is not enough).
  /** Email + password login/registration/upgrade. Set AUTH_PASSWORD_LOGIN_ENABLED=0 to disable. */
  authPasswordLogin: process.env.AUTH_PASSWORD_LOGIN_ENABLED !== '0',
  /** Instant guest sessions. Set AUTH_GUEST_ENABLED=0 to disable. */
  authGuest: process.env.AUTH_GUEST_ENABLED !== '0',

  // OAuth providers. A provider is "enabled" only when BOTH its id and secret are set.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  discordClientId: process.env.DISCORD_CLIENT_ID ?? '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
  /** Extra Google OAuth client ids (iOS/Android apps) accepted as ID-token audiences. */
  googleMobileClientIds: (process.env.GOOGLE_MOBILE_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Sign in with Apple audiences: bundle ids / Services IDs accepted as identity-token `aud`. */
  appleClientIds: (process.env.APPLE_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Sign in with Apple token revocation (account deletion). All three + a client id required. */
  appleTeamId: process.env.APPLE_TEAM_ID ?? '',
  appleKeyId: process.env.APPLE_KEY_ID ?? '',
  applePrivateKey: (process.env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  /** Universal/App Link verification (served under /.well-known when set). */
  appleAppId: process.env.APPLE_APP_ID ?? '', // "TEAMID.bundle.id"
  androidPackageName: process.env.ANDROID_PACKAGE_NAME ?? '',
  androidCertSha256: (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /**
   * Public base URL the browser uses to reach this app. Builds both the provider `redirect_uri`
   * (`${base}/api/v1/auth/oauth/:provider/callback`) and the post-callback web redirect
   * (`${base}/login/callback`). Must be the SAME origin that serves the SPA (so the Strict refresh
   * cookie is sent on the follow-up /auth/refresh). Defaults to the first CORS origin, else dev web.
   */
  oauthRedirectBase:
    process.env.OAUTH_REDIRECT_BASE ??
    (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean)[0] ??
    'http://localhost:5173',
  /**
   * Signed OAuth `state` lifetime (ms) — the round-trip to the provider and back. The `trm_oauth`
   * nonce cookie is given this exact maxAge, so the cookie never out-/under-lives the state it guards.
   */
  oauthStateTtlMs: Number(process.env.OAUTH_STATE_TTL_MS ?? 10 * 60 * 1000),

  /**
   * Maintainer-dashboard bootstrap: comma-separated emails granted the `owner` dashboard role at
   * boot (registered, non-guest accounts only). Authoritative on every boot — re-asserts owner if
   * one was accidentally demoted. An email registered after boot is picked up on the next restart.
   */
  dashboardOwnerEmails: (process.env.DASHBOARD_OWNER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  // Background purge of stale LOBBY rooms / LIVE games (dashboard/purge.service.ts). On by
  // default with conservative thresholds below; set PURGE_AUTO_ENABLED=0 to disable.
  // A STARTED room's own updatedAt freezes the moment play begins, so it's swept using its
  // linked game's updatedAt — gameLivePurgeHours governs both.
  purgeAutoEnabled: process.env.PURGE_AUTO_ENABLED !== '0',
  purgeIntervalMs: Number(process.env.PURGE_INTERVAL_MS ?? 60 * 60 * 1000),
  roomLobbyPurgeHours: Number(process.env.ROOM_LOBBY_PURGE_HOURS ?? 24),
  gameLivePurgeHours: Number(process.env.GAME_LIVE_PURGE_HOURS ?? 24 * 7),
} as const;
