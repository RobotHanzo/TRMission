// The Sentry SDK setup for apps/admin (issue #44): errors, browser tracing, and Session Replay.
//
// **Loaded lazily** — nothing in the eager app graph may import this module; `./report.ts` is the
// façade everything else talks to. A static import would put ~92 kB gzipped on the boot critical
// path of a build that may well have no DSN at all.
//
// Same contract as apps/web's, with a different masking rationale: the dashboard is where
// operator-visible account data lives (ids, emails, ban state, audit entries), and a LIVE game's
// hidden state never reaches this surface — so `maskAllText` is the guard, with no board-specific
// block list to maintain.
import {
  browserTracingIntegration,
  captureException,
  init,
  replayIntegration,
  setUser,
} from '@sentry/react';
import { scrubTelemetryBreadcrumb, scrubTelemetryEvent, telemetrySampleRate } from '@trm/shared';
import type { SentryHandle } from './report';

const env = import.meta.env;

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
/** The dashboard is low-traffic and maintainer-only, so a recorded session is cheap — but it is
 *  still full of account data, so ordinary sessions stay off by default and only errors buffer. */
const DEFAULT_REPLAY_SAMPLE_RATE = 0;
const DEFAULT_REPLAY_ERROR_SAMPLE_RATE = 1;

const IGNORED_ERRORS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  /^AbortError:/,
  'Failed to fetch',
  'Load failed',
];

/** Initialise the SDK and hand `./report.ts` the functions it drives. */
export function start(): SentryHandle {
  init({
    dsn: env.VITE_SENTRY_DSN,
    environment: env.VITE_SENTRY_ENVIRONMENT ?? (env.DEV ? 'development' : 'production'),
    release: env.VITE_COMMIT_HASH ?? 'dev',
    sendDefaultPii: false,
    tracesSampleRate: telemetrySampleRate(
      env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      DEFAULT_TRACES_SAMPLE_RATE,
    ),
    replaysSessionSampleRate: telemetrySampleRate(
      env.VITE_SENTRY_REPLAY_SAMPLE_RATE,
      DEFAULT_REPLAY_SAMPLE_RATE,
    ),
    replaysOnErrorSampleRate: telemetrySampleRate(
      env.VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE,
      DEFAULT_REPLAY_ERROR_SAMPLE_RATE,
    ),
    ignoreErrors: IGNORED_ERRORS,
    integrations: [
      browserTracingIntegration(),
      replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
    ],
    beforeSend: (event) => scrubTelemetryEvent(event),
    beforeSendTransaction: (event) => scrubTelemetryEvent(event),
    beforeBreadcrumb: (crumb) => scrubTelemetryBreadcrumb(crumb),
  });

  return {
    captureException: (error, componentStack) =>
      captureException(error, { contexts: { react: { componentStack } } }),
    setUser: (userId) => setUser(userId ? { id: userId } : null),
  };
}
