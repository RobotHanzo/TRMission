// The Sentry SDK setup for apps/web (issue #44): errors, browser tracing, and Session Replay.
//
// **Loaded lazily** — nothing in the eager app graph may import this module. `./report.ts` is the
// façade everything else talks to, and it dynamically imports this only once it has seen a DSN, so
// an unconfigured build never downloads the SDK. Keep that boundary: a static import from a
// component or store would silently put ~92 kB gzipped back on the boot critical path.
//
// Everything leaving the page goes through `@trm/shared`'s scrubber, the same denylist the server
// and mobile use, because this is a hidden-information game: a hand or a mission list in a crash
// report is an anti-cheat problem, not just a privacy one. Replay gets a second, structural guard
// on top — see SECRET_CLASS.
import {
  browserTracingIntegration,
  captureException,
  init,
  replayIntegration,
  setTag,
  setUser,
} from '@sentry/react';
import { scrubTelemetryBreadcrumb, scrubTelemetryEvent, telemetrySampleRate } from '@trm/shared';
import { SECRET_CLASS } from './secrets';
import type { SentryHandle } from './report';

const env = import.meta.env;

/** Page-load/navigation traces: a modest default, tunable per deployment. */
const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
/** Replays of ORDINARY sessions default to off — they are the expensive, most privacy-sensitive
 *  signal, and the error-triggered buffer below is what actually helps a bug report. */
const DEFAULT_REPLAY_SAMPLE_RATE = 0;
/** …but when an error fires, keep the buffered replay that led up to it. */
const DEFAULT_REPLAY_ERROR_SAMPLE_RATE = 1;

/** Browser noise that is never actionable: extension frames, and the handful of benign errors
 *  every React app on the open web collects by the thousand. */
const IGNORED_ERRORS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  /^AbortError:/,
  /^NetworkError when attempting to fetch resource/,
  'Failed to fetch',
  'Load failed',
  // In-app browsers (chat apps, social apps) run the page inside their own WKWebView and inject a
  // native bridge into it — `sendDataToNative`/`sendPageHideMessage` reaching for
  // `window.webkit.messageHandlers`. When the host tears the bridge down the throw is attributed to
  // our document, so it can't be filtered by URL (TRMISSION-WEB-1). We never touch that API, so any
  // mention of it is somebody else's script.
  /messageHandlers/,
];
const DENY_URLS = [
  /extensions\//i,
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  // Cloudflare's edge-injected scripts: the Web Analytics / RUM beacon and Zaraz (which is how
  // `lib/analytics.ts` reaches GA4 at all). We neither ship nor version them, and their crashes
  // are always somebody else's — e.g. the beacon's CLS observer calling `Array.prototype.at` in
  // an engine that lacks it (TRMISSION-WEB-3). Zaraz is same-origin under /cdn-cgi/, so it needs
  // a path pattern rather than a host one.
  /beacon\.min\.js/i,
  /static\.cloudflareinsights\.com/i,
  /\/cdn-cgi\//i,
];

/**
 * WebKit rejects promises from a number of built-ins with a bare `DOMException` that carries NO
 * stack at all. With no frame there is nothing to attribute it to — not a file of ours, and not
 * the same-origin edge-injected analytics that `DENY_URLS` would otherwise catch — so it lands as
 * a stackless, unfixable report (TRMISSION-WEB-4). Matched on the pair (this exact WebKit message
 * AND zero frames), so a real SyntaxError thrown from our own code still reports normally.
 */
const STACKLESS_WEBKIT_VALUES = ['The string did not match the expected pattern.'];

export function isStacklessWebkitNoise(event: { exception?: { values?: unknown[] } }): boolean {
  const values = event.exception?.values as
    | { value?: string; stacktrace?: { frames?: unknown[] } }[]
    | undefined;
  if (values?.length !== 1) return false;
  const only = values[0]!;
  if (!STACKLESS_WEBKIT_VALUES.includes(only.value ?? '')) return false;
  return (only.stacktrace?.frames?.length ?? 0) === 0;
}

/** Initialise the SDK and hand `./report.ts` the functions it drives. */
export function start(): SentryHandle {
  init({
    dsn: env.VITE_SENTRY_DSN,
    environment: env.VITE_SENTRY_ENVIRONMENT ?? (env.DEV ? 'development' : 'production'),
    // Same commit the About panel shows, baked by the Docker build-arg.
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
    denyUrls: DENY_URLS,
    integrations: [
      browserTracingIntegration(),
      replayIntegration({
        // Belt: every text node and input value is masked, every image/video blocked.
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
        // Braces: the hand / mission trays are BLOCKED outright, not merely text-masked — their
        // secret is the card colours and route shapes, which survive text masking. See secrets.ts.
        block: [`.${SECRET_CLASS}`],
      }),
    ],
    beforeSend: (event) => (isStacklessWebkitNoise(event) ? null : scrubTelemetryEvent(event)),
    beforeSendTransaction: (event) => scrubTelemetryEvent(event),
    beforeBreadcrumb: (crumb) => scrubTelemetryBreadcrumb(crumb),
  });

  return {
    captureException: (error, componentStack) =>
      captureException(error, { contexts: { react: { componentStack } } }),
    setUser: (userId) => setUser(userId ? { id: userId } : null),
    setGameContext: (context) => {
      setTag('trm.gameId', context?.gameId ?? undefined);
      setTag('trm.roomCode', context?.roomCode ?? undefined);
    },
  };
}
