/**
 * The class that marks a DOM subtree as carrying THIS viewer's hidden game state — their hand,
 * their kept/offered missions, the payment combinations enumerated from their hand.
 *
 * Session Replay records the live DOM, and a maintainer reviewing a replay may be seated at the
 * same table: an unmasked hand would be a live anti-cheat leak, not just a privacy one. Everything
 * wearing this class is `block`ed (replaced with a placeholder) by the replay integration — see
 * `observability/sentry.ts`, which owns the mapping.
 *
 * Kept in its own module so the components that mark themselves don't pull `@sentry/react` into the
 * main bundle just to name a string.
 */
export const SECRET_CLASS = 'trm-secret';

/** Append the marker to an existing className. */
export const withSecretClass = (className?: string): string =>
  className ? `${className} ${SECRET_CLASS}` : SECRET_CLASS;
