// Boot-time repair for server OTA (docs/release/server-ota.md).
//
// WHY THIS RUNS FROM instrument.mjs AND NOT FROM main.ts: under ESM the whole module graph is
// resolved and evaluated before `bootstrap()` executes, so by the time any code in main.ts runs the
// source tree has already been read. If a previous process died midway through a swap, that read is
// of a half-swapped tree — an import throws, the container restarts, and it throws again. Repair has
// to happen in a process that has not yet touched the app graph, which is exactly what a `--import`
// hook is.
//
// Keep this module's imports to `./layout` and node builtins for the same reason: anything reaching
// into the app graph (`../config/env`, NestJS, `@trm/*`) could itself be the thing that is broken.
import {
  clearJournal,
  otaPaths,
  pointSymlink,
  readJournal,
  readState,
  resumeSwaps,
  revertSwaps,
  writeState,
  type OtaState,
} from './layout';

/**
 * Boots that may see an unverified bundle before it is rolled back. The first boot after an apply is
 * expected to consume one attempt and then clear the marker once the process has stayed up
 * (`SelfUpdateService`), so this allows one genuine retry — a container restart policy with backoff
 * gets two shots at a flaky boot before the deployment falls back to the previous code.
 */
const MAX_BOOT_ATTEMPTS = 2;

/** Drop `pendingVerify` without tripping exactOptionalPropertyTypes. */
function withoutPendingVerify(state: OtaState): OtaState {
  const { pendingVerify: _pendingVerify, ...rest } = state;
  return rest;
}

/**
 * Finish or roll back an interrupted/unproven OTA apply. Safe and cheap to call on every boot: with
 * no journal on disk it returns immediately, which is the case for every deployment that has never
 * applied an update.
 */
export function recoverSelfUpdate(): void {
  const paths = otaPaths();
  const journal = readJournal(paths);
  if (journal === null) return;

  // A completed apply leaves nothing staged, so this is a no-op unless the previous process died
  // between two of the renames.
  const resumed = resumeSwaps(journal, paths.appRoot);
  if (resumed > 0) {
    console.warn(
      `[ota] resumed an interrupted apply: ${resumed} tree(s) swapped to ${journal.commit}`,
    );
  }

  const state = readState(paths);
  const attempts = (state.pendingVerify?.attempts ?? 0) + 1;

  if (attempts > MAX_BOOT_ATTEMPTS) {
    const reverted = revertSwaps(journal, paths.appRoot);
    if (journal.webCurrentLink !== undefined && journal.webPreviousTarget !== undefined) {
      try {
        pointSymlink(journal.webCurrentLink, journal.webPreviousTarget);
      } catch {
        /* volume gone or read-only; the server-side rollback below still stands */
      }
    }
    clearJournal(paths);
    const { appliedCommit: _appliedCommit, ...rolledBack } = withoutPendingVerify(state);
    writeState(
      journal.previousCommit === undefined
        ? rolledBack
        : { ...rolledBack, appliedCommit: journal.previousCommit },
      paths,
    );
    console.error(
      `[ota] ROLLED BACK ${journal.commit} after ${attempts - 1} failed boots — ${reverted} tree(s) restored. ` +
        `The deployment is running ${journal.previousCommit ?? 'the image as built'}; fix forward or redeploy the image.`,
    );
    return;
  }

  writeState({ ...state, pendingVerify: { commit: journal.commit, attempts } }, paths);
}
