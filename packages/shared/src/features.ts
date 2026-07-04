/**
 * Per-account gated features. Default-OFF for every account; granted from the
 * maintainer dashboard (permission `users.features`). Defined once here so the
 * server guard, the admin UI, and the web client can never drift — the same
 * no-drift pattern as the dashboard permission taxonomy.
 */
export const USER_FEATURES = ['replayReview', 'mapBuilder'] as const;
export type UserFeature = (typeof USER_FEATURES)[number];

export const isUserFeature = (s: string): s is UserFeature =>
  (USER_FEATURES as readonly string[]).includes(s);
