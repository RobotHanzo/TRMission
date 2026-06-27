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
} as const;
