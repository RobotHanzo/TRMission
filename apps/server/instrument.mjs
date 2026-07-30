// Sentry's boot hook (issue #44). Loaded as the process's FIRST `--import`:
//
//   node --import ./instrument.mjs src/main.ts
//
// Why a separate .mjs file rather than `import './observability/sentry'` at the top of main.ts:
// under ESM the whole module graph is resolved and LINKED before any of it evaluates, so an import
// inside main.ts would still lose the race against `node:http`/`express`/`mongodb` — and Sentry's
// OpenTelemetry instrumentations must patch those before anything imports them, or no span is ever
// produced. `--import` is the only hook that runs early enough.
//
// Why this file is .mjs and not .ts: `@swc-node/register`'s ESM resolver resolves a relative
// specifier against `dirname(parentURL)`, and for a `--import` the parentURL is the cwd DIRECTORY —
// so it lands one level too high and `--import ./src/instrument.ts` fails to resolve
// ("cannot be resolved in file://…/apps/server/"). Loading a plain .mjs FIRST goes through Node's
// own resolver instead, and from inside this file the parentURL is a real file path, so the
// dynamic import of the TypeScript implementation below resolves correctly.
//
// The static import also means the swc register hooks are installed for the rest of the process,
// which is what lets `src/main.ts` load. Keep this as the sole `--import`.
import '@swc-node/register/esm-register';

// Server-OTA repair, BEFORE anything imports the app graph (docs/release/server-ota.md). If a
// previous process died midway through swapping source trees in, the tree on disk is a mix of old and
// new — an import from main.ts would throw, the container would restart, and it would throw again.
// This is the only place that runs early enough to finish (or roll back) that swap. A deployment that
// has never applied an OTA finds no journal and returns immediately.
const { recoverSelfUpdate } = await import('./src/selfupdate/recover.ts');
recoverSelfUpdate();

const { initSentry } = await import('./src/observability/sentry.ts');

// No SENTRY_DSN configured ⇒ initSentry() returns false, nothing is installed, and the process
// behaves exactly as it did before this file existed.
if (initSentry()) {
  console.log('[sentry] error reporting + tracing enabled');
}
