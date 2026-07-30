// Sentry wiring for the server (issue #44). Two rules govern everything here:
//
//   1. It is OPT-IN. No SENTRY_DSN ⇒ `Sentry.init` is never called and every `@sentry/nestjs`
//      helper degrades to a no-op, so tests/CI/dev and self-hosters run exactly as before.
//   2. NOTHING leaves this process unscrubbed. This is a hidden-information game: a hand, a kept
//      ticket, a deck order, or the RNG seed reaching an error backend is an anti-cheat problem,
//      not just a privacy one. `scrubTelemetryEvent` (@trm/shared) is the single denylist, shared
//      with the web/admin/mobile clients so the four can't drift. It withholds game secrets,
//      credentials and ad identifiers — and nothing else, so who/where/what stays legible.
//
// Must be initialised BEFORE the app graph imports `http`/`mongodb` — see src/instrument.ts.
import * as Sentry from '@sentry/nestjs';
import { scrubTelemetryBreadcrumb, scrubTelemetryEvent, telemetrySampleRate } from '@trm/shared';
import { runningCommit } from '../selfupdate/buildInfo';
import { env } from '../config/env';

/** Default trace sampling when SENTRY_TRACES_SAMPLE_RATE is unset — enough to see latency shape
 *  without turning a busy hub into a trace firehose. */
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

/** Endpoints whose traces are pure noise: the Prometheus scrape and the container health probe run
 *  on a timer forever and would otherwise dominate the transaction quota. Matched against the
 *  transaction name, which for an HTTP server span is `"<METHOD> <route>"`. */
const UNTRACED_PATHS = ['/metrics', '/healthz'];

let started = false;

/**
 * Initialise Sentry if a DSN is configured. Returns whether reporting is live, so callers can log
 * the decision once at boot. Idempotent — a second call is ignored.
 */
export function initSentry(): boolean {
  if (started) return Sentry.isInitialized();
  started = true;
  if (!env.sentryDsn) return false;

  const sampleRate = telemetrySampleRate(env.sentryTracesSampleRate, DEFAULT_TRACES_SAMPLE_RATE);

  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.sentryEnvironment,
    // The commit already baked into the image (CI build-arg → Docker ENV); ties an event to a
    // source tree without introducing a second provenance axis.
    release: runningCommit(),
    // Let the SDK attach the request context (client IP, headers, body) it collects by default:
    // "which account, from where, with what payload" is most of what makes a 500 diagnosable, and
    // the pieces of it that ARE dangerous — `cookie`, `authorization`, `password` — are dropped by
    // key name in the denylist below rather than by suppressing the whole envelope.
    sendDefaultPii: true,
    // A sampler rather than a flat `tracesSampleRate` (which it would supersede anyway) so the
    // infra pollers can be dropped outright instead of eating the quota at the same rate as play.
    tracesSampler: ({ name }) =>
      UNTRACED_PATHS.some((path) => name.endsWith(path)) ? 0 : sampleRate,
    beforeSend: (event) => scrubTelemetryEvent(event),
    beforeSendTransaction: (event) => scrubTelemetryEvent(event),
    beforeBreadcrumb: (crumb) => scrubTelemetryBreadcrumb(crumb),
  });
  return true;
}

/** Whether `initSentry` actually brought the SDK up (false whenever SENTRY_DSN is unset). */
export const sentryEnabled = (): boolean => Sentry.isInitialized();
