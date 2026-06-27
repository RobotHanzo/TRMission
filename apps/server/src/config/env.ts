// Minimal typed runtime config. Step C replaces this with a validated config module
// (JWT secrets, CORS allowlist, …).
export const env = {
  port: Number(process.env.PORT ?? 3001),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB ?? 'trmission',
  /** Persistence is on by default; set TRM_PERSISTENCE=0 to run purely in-memory. */
  persistence: process.env.TRM_PERSISTENCE !== '0',
  /** When set, seed a demo game on boot and log dev tickets for manual smoke play. */
  devGame: process.env.TRM_DEV_GAME === '1',
} as const;
