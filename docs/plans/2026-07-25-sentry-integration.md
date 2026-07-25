# Sentry integration — errors, tracing, session replay (issue #44)

One error/performance backend across all four surfaces: `apps/server`, `apps/web`, `apps/admin`,
`apps/mobile`. Errors + distributed tracing + web Session Replay.

## Binding decisions

1. **Opt-in by DSN.** Every surface reads a DSN from config; unset ⇒ `Sentry.init` is never called
   and the SDK is inert. Tests, CI, local dev and self-hosters need no Sentry account, and no gate
   in this repo may start depending on one.
2. **One scrubbing choke point, shared.** This game is hidden-information: a hand, a ticket, a deck
   order, or a game seed reaching an error backend is an anti-cheat problem, not just a privacy one
   (a maintainer reading a replay of a live opponent's session would see their hand). The denylist
   lives once in `@trm/shared` (`telemetry.ts`) and is applied from every surface's `beforeSend` /
   `beforeSendTransaction` / `beforeBreadcrumb`. `@trm/shared` gains **no** Sentry dependency — the
   scrubber is typed against a structural event shape.
3. **`sendDefaultPii: false` everywhere.** Plus explicit key-name scrubbing for tokens, cookies,
   auth headers, emails, and the ws-game ticket in URLs/query strings.
4. **Session Replay masks the secret surfaces.** `maskAllText` + `blockAllMedia` are on, and the
   viewer's own hand/tickets/secret trays are marked `sentry-mask` so a replay can never carry a
   live seat's private state.
5. **No Sentry in `packages/{engine,bots,map-data,codec,shared,client-core}`.** The engine's purity
   is structural (ESLint-enforced) and the shared packages are consumed by every app; instrumentation
   belongs to the apps. `@trm/shared` gets only the pure scrubber.
6. **Release = the commit already baked in.** `GIT_COMMIT` (server), `VITE_COMMIT_HASH`
   (web/admin), `version+buildNumber` (mobile) — no new provenance axis.

## Surfaces

### `apps/server` (`@sentry/nestjs`)

- `src/instrument.ts` — side-effect init module, loaded via `node --import` **before** `main.ts` so
  OpenTelemetry's ESM hooks patch `http`/`mongodb` before Nest imports them. Ordered after
  `@swc-node/register/esm-register` so the `.ts` file itself is loadable.
- `SentryModule.forRoot()` + `SentryGlobalFilter` (`APP_FILTER`) — every unhandled REST exception is
  captured; `HttpException`s keep Nest's response behaviour and are not reported.
- New framework-free `ErrorReporter` port (`src/observability/error-reporter.ts`, `NOOP_REPORTER`
  default, same shape as the existing `MetricsHooks` seam) wired into `GameHub` so the realtime
  loop's "should stay 0" events report with context: the `receive` catch-all, `leakBlocked`
  (fatal-level — the hidden-info egress guard), unrecoverable games, and bot-driver stalls.
- Env: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`.

### `apps/web` / `apps/admin` (`@sentry/react`)

- Neither app has an error boundary today — a render throw is a white screen. Add a real root
  boundary with a translated recovery screen (retry + reload), reporting through Sentry.
- `browserTracingIntegration` + `replayIntegration` (web only carries the board; admin carries
  operator PII, so both mask by default).
- Own rollup `manualChunks` bucket so the SDK caches separately from the app chunk.
- `@sentry/vite-plugin` uploads source maps only when `SENTRY_AUTH_TOKEN` is present; otherwise the
  build is byte-for-byte what it is today.
- Env (build-time, public by design): `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`,
  `VITE_SENTRY_TRACES_SAMPLE_RATE`, `VITE_SENTRY_REPLAY_SAMPLE_RATE`,
  `VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE`.

### `apps/mobile` (`@sentry/react-native`)

- Native module + `@sentry/react-native/expo` config plugin. This **changes the OTA
  `runtimeVersion` fingerprint** — the next OTA needs a fresh native build on both stores first.
- Init from `index.ts` right after the shims and `installCrashCapture()`; the existing
  AsyncStorage crash record stays (it is the offline/TestFlight fallback and needs no network).
- `RootErrorBoundary.componentDidCatch` also `captureException`s; `Sentry.wrap(App)`; React
  Navigation instrumentation for screen-level tracing.
- iOS privacy manifest gains crash/performance/diagnostic collected-data types.
- `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` in the iOS/Android/OTA lanes for source maps
  and debug symbols; every one is optional and the lanes still build without them.

## Verification

`yarn typecheck`, `yarn lint`, `yarn test`, `yarn format:check`, plus the mobile jest suite.
Unit tests cover the scrubber (hand/ticket/seed/token keys, nested, URL query) and each surface's
`beforeSend` wiring. A device/native build for mobile is **not** verifiable from here — flagged.
