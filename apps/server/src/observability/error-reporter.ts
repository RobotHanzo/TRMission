// Error-reporting seam for the realtime core, defined without any Sentry import for the same
// reason MetricsHooks is defined without prom-client: the hub stays dependency-free and trivially
// testable (tests pass NOOP_REPORTER, which is also the default).
//
// Metrics answer "how often"; this answers "what exactly, and where". The two are wired at the same
// call sites — every counter documented as "should stay 0" also reports here with the context a
// maintainer needs to act on it.
import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { scrubTelemetryValue } from '@trm/shared';

/** Extra context attached to a report. Values are scrubbed before they leave the process, but keep
 *  them to ids and small scalars anyway — never a `GameState`, hand, or ticket list. */
export type ReportContext = Record<string, string | number | boolean | null | undefined>;

export interface ErrorReporter {
  /**
   * Report an unexpected failure. `tag` is a stable, low-cardinality label for the call site
   * (`ws.receive`, `hub.leak_blocked`, …) so events group sensibly.
   */
  capture(error: unknown, tag: string, context?: ReportContext): void;
  /**
   * Report a condition that is a bug but produced no `Error` — the egress guard firing, a bot
   * driver with no legal action. `level` defaults to 'error'.
   */
  captureMessage(message: string, tag: string, context?: ReportContext, level?: ReportLevel): void;
}

export type ReportLevel = 'warning' | 'error' | 'fatal';

export const NOOP_REPORTER: ErrorReporter = {
  capture() {},
  captureMessage() {},
};

/** The Sentry-backed reporter. Inert (like every other `@sentry/*` helper) until `initSentry` has
 *  run with a DSN, so this is safe to construct unconditionally. */
@Injectable()
export class SentryErrorReporter implements ErrorReporter {
  capture(error: unknown, tag: string, context: ReportContext = {}): void {
    Sentry.captureException(error, (scope) => {
      applyContext(scope, tag, context);
      return scope;
    });
  }

  captureMessage(
    message: string,
    tag: string,
    context: ReportContext = {},
    level: ReportLevel = 'error',
  ): void {
    Sentry.captureMessage(message, (scope) => {
      applyContext(scope, tag, context);
      scope.setLevel(level);
      return scope;
    });
  }
}

function applyContext(scope: Sentry.Scope, tag: string, context: ReportContext): void {
  scope.setTag('trm.site', tag);
  // Scrubbed even though these are meant to be ids only — the denylist is the guarantee, not the
  // convention at each call site.
  scope.setContext('trm', scrubTelemetryValue(context) as Record<string, unknown>);
}
