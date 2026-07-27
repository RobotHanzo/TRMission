# Error reporting (`apps/web/src/observability/`, issue #44)

App-wide context: `apps/web/CLAUDE.md`.

- **`report.ts` is the only observability module the app graph may import.** It holds no `@sentry/*`
  import and dynamically imports `sentry.ts` only after seeing a `VITE_SENTRY_DSN`. Vite inlines
  that build-time var, so a DSN-less build makes the whole import dead code and the ~92 kB gzipped
  SDK **is not in the bundle at all**; a configured build fetches it in an async chunk instead of
  blocking boot. A static `@sentry/react` import from a component or store silently undoes both —
  don't add one.
- `sentry.ts` — the SDK setup (`start()`), reached only through the façade. Browser tracing +
  Session Replay. Replays of ordinary sessions default to **off**
  (`VITE_SENTRY_REPLAY_SAMPLE_RATE=0`); only an erroring session's buffered replay is kept. The
  trade-off of lazy loading: errors thrown in the first tick or two of boot are dropped, not queued
  (a queue would be one more place for game state to sit).
- **`secrets.ts`'s `SECRET_CLASS` is load-bearing — and it is the ONLY replay masking on this
  surface.** `maskAllText`/`maskAllInputs`/`blockAllMedia` are off (a replay of grey boxes says only
  that something broke, which the error already said). Session Replay records the live DOM, and a
  maintainer reviewing a replay may be seated at the same table, so `PlayerHand`, `TicketPanel`,
  `TicketChooser` and `PaymentModal`'s option list carry the class and are `block`ed outright — an
  unmasked hand is a live anti-cheat leak, and text masking never covered it anyway (the secret is
  the card colours and route shapes). **Any new UI that renders `you.hand`, kept/offered missions,
  or anything derived from them must carry it too.**
- Everything on the wire to Sentry goes through `@trm/shared`'s `scrubTelemetryEvent`, the same
  denylist the server and mobile use — game secrets, credentials and ad identifiers only.
  Identifiers are sent on purpose: `sendDefaultPii: true`, and `App.tsx` attaches
  `{ id, email, username }` as the Sentry user so a report says which account hit it.
- Source maps upload only when `SENTRY_AUTH_TOKEN` is set at build time (`vite.config.ts`); they are
  deleted right after upload and never served.

The root render boundary is `../components/AppErrorBoundary.tsx`; stale-chunk recovery after a
redeploy is `../lib/CLAUDE.md`.
