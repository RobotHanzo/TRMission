# Error reporting (`apps/admin/src/observability/`, issue #44)

App-wide context: `apps/admin/CLAUDE.md`.

`../components/AdminErrorBoundary.tsx` wraps `<App/>` in `main.tsx` — without it an uncaught render
throw leaves a maintainer on a blank page mid-incident. It uses inline styles and reads its strings
defensively off the i18n singleton, so it still renders when the tokens/CSS or the i18n init is the
thing that broke.

Sentry is opt-in via the build-time `VITE_SENTRY_DSN` and mirrors `apps/web`'s contract exactly,
including the lazy-load façade: `report.ts` carries no `@sentry/*` import and pulls in `sentry.ts`
only once it has seen a DSN, so a DSN-less build doesn't ship the SDK at all. Beyond that:
everything goes through `@trm/shared`'s `scrubTelemetryEvent` (game secrets, credentials and ad
identifiers — nothing else), tracing on, and Session Replay recorded **only** for erroring sessions.
`sendDefaultPii: true` and the signed-in maintainer is attached as `{ id, email, username }`.

Replay masking is **off**: no LIVE game's hidden state reaches this app, and the account data that
does is exactly what an operator needs to see to reconstruct what they were doing — so there is no
block list to maintain here either (unlike `apps/web`'s `SECRET_CLASS`).
