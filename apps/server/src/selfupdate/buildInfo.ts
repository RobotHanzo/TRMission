// What commit this process is actually running.
//
// `GIT_COMMIT` is baked into the IMAGE, so after a hot-applied OTA it names the wrong revision — and
// a wrong release tag is worse than none: Sentry would bind new stack traces to the previous build's
// source maps, and /version would tell an operator the update never landed. Everything that reports a
// version goes through here instead (docs/release/server-ota.md).
import { env } from '../config/env';
import { otaPaths, readState } from './layout';

/** Uncached: `status()` must reflect an apply that happened inside this same process. */
export function currentCommit(): string {
  return readState(otaPaths(env.selfUpdateAppRoot)).appliedCommit ?? env.gitCommit;
}

let cached: string | undefined;

/**
 * The commit to tag releases with. Cached, because it cannot change for the lifetime of the process:
 * `selfupdate/recover.ts` has already settled the on-disk state before the app graph loads, and an
 * apply is always followed by a restart.
 */
export function runningCommit(): string {
  cached ??= currentCommit();
  return cached;
}
