// Minimal typed runtime config for Step A. Step C replaces this with a validated
// config module (Mongo URI, JWT secrets, CORS allowlist, …).
export const env = {
  port: Number(process.env.PORT ?? 3001),
  /** When set, seed a demo game on boot and log dev tickets for manual smoke play. */
  devGame: process.env.TRM_DEV_GAME === '1',
} as const;
