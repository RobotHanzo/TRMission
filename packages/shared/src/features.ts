/**
 * Per-account gated features. Off unless granted — either directly to the account from the
 * maintainer dashboard (permission `users.features`), or via the global default set every
 * account gets on top of its own grants (permission `config.features`). Defined once here so
 * the server guard, the admin UI, and the web client can never drift — the same no-drift
 * pattern as the dashboard permission taxonomy.
 */
export const USER_FEATURES = ['replayReview', 'mapBuilder', 'randomEvents'] as const;
export type UserFeature = (typeof USER_FEATURES)[number];

export const isUserFeature = (s: string): s is UserFeature =>
  (USER_FEATURES as readonly string[]).includes(s);
