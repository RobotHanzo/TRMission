// Minimal typed runtime config.
const day = 24 * 60 * 60 * 1000;

export const env = {
  port: Number(process.env.PORT ?? 3001),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB ?? 'trmission',
  /** Persistence is on by default; set TRM_PERSISTENCE=0 to run purely in-memory (no auth/lobby). */
  persistence: process.env.TRM_PERSISTENCE !== '0',
  /** When set, seed a demo game on boot and log dev tickets for manual smoke play. */
  devGame: process.env.TRM_DEV_GAME === '1',
  /** Delay between consecutive bot moves (ms) so humans can follow the play. */
  botMoveDelayMs: Number(process.env.TRM_BOT_DELAY_MS ?? 600),

  // Auth (Step C). The default secret is for local dev only — set JWT_SECRET in prod.
  jwtSecret: process.env.JWT_SECRET ?? 'dev-insecure-secret-change-me',
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  /** ws-game ticket lifetime (short — it's redeemed immediately for a socket). */
  wsTicketTtl: process.env.WS_TICKET_TTL ?? '45s',
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

  /**
   * Random-events room option. Set TRM_RANDOM_EVENTS_ENABLED=1 to enable (default OFF).
   * NOTE the INVERTED idiom vs. the auth toggles above: this is opt-in (`=== '1'`), so a missing
   * env var yields `false` — the option stays off (and the server rejects/downgrades it) unless a
   * maintainer explicitly turns it on.
   */
  randomEvents: process.env.TRM_RANDOM_EVENTS_ENABLED === '1',

  // OAuth providers. A provider is "enabled" only when BOTH its id and secret are set.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  discordClientId: process.env.DISCORD_CLIENT_ID ?? '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
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
} as const;
