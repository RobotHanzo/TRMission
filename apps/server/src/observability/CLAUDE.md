# CLAUDE.md

`src/observability/` carries two signals, wired at the same call sites: **metrics** say how often,
**error reports** say what. App-wide context: `apps/server/CLAUDE.md`.

- `metrics.service.ts` / `hooks.ts` — prom-client, exposed at `/metrics`.
- `sentry.ts` + `instrument.mjs` — Sentry, opt-in via `SENTRY_DSN` (unset ⇒ `Sentry.init` is never
  called and the whole SDK is inert).
- `error-reporter.ts` — the framework-free `ErrorReporter` port.

## `instrument.mjs` is the process's first `--import` — leave it alone

`node --import ./instrument.mjs src/main.ts`. Under ESM the module graph is linked before any of it
evaluates, so an import inside `main.ts` would lose the race against `http`/`mongodb` and produce no
spans.

It is `.mjs` and not `.ts` because `@swc-node/register`'s ESM resolver resolves a relative specifier
against `dirname(parentURL)` — for a `--import` the parentURL is the cwd **directory**, so
`--import ./src/instrument.ts` lands one level too high and fails to resolve. Loading a plain `.mjs`
first goes through Node's own resolver, and it registers swc for the rest of the process. **Do not
"simplify" this back into `main.ts`.**

## `ErrorReporter`

Same shape as `MetricsHooks`, `NOOP_REPORTER` by default so tests stay silent. Wired into `GameHub`
for the four "should stay 0" events: the `receive` catch-all, unrecoverable games, bot-driver
stalls, and `leak_blocked` — which reports at **fatal** with the two seat ids and nothing else,
because attaching the snapshot would commit the very leak the guard just stopped.

## Nothing reaches Sentry unscrubbed

`beforeSend`/`beforeSendTransaction`/`beforeBreadcrumb` all run `@trm/shared`'s
`scrubTelemetryEvent`, the single denylist shared with web/admin/mobile. That denylist withholds
game secrets, credentials and ad identifiers only — `sendDefaultPii` is **on**, so request context
(client IP, headers, body) rides along and the dangerous keys inside it (`cookie`, `authorization`,
`password`) are dropped by name rather than by suppressing the lot.

Env: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` — all optional, all parsed in
`../config/env.ts`.
