// On-disk layout + the swap primitive for server OTA (docs/release/server-ota.md).
//
// Deliberately dependency-free — no `@trm/*`, no `../config/env`, no NestJS. `recover.ts` imports
// this before the app graph is loaded (from `instrument.mjs`), at a moment when the source tree may
// still be half-swapped and `env.ts` would throw on an unrelated missing var. Keep it that way: an
// import added here can stop a broken deployment from repairing itself.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

/** Directory the OTA machinery owns, under the app root. */
const OTA_DIRNAME = '.trm-ota';
/** Written into the image by apps/server/Dockerfile — the fence an OTA bundle has to match. */
const FINGERPRINT_FILENAME = '.trm-deps-fingerprint';

/**
 * The app root the running server was installed at (`/app` in the image). Read straight from
 * `process.env` rather than through `config/env.ts` for the reason in the file header — the config
 * parse point mirrors this value as `env.selfUpdateAppRoot` so it is still documented in one place.
 */
export function otaAppRoot(): string {
  return process.env.TRM_SELFUPDATE_APP_ROOT ?? '/app';
}

export interface OtaPaths {
  readonly appRoot: string;
  readonly otaDir: string;
  readonly stateFile: string;
  readonly journalFile: string;
  readonly stagingDir: string;
  readonly prevDir: string;
  readonly fingerprintFile: string;
}

export function otaPaths(appRoot = otaAppRoot()): OtaPaths {
  const otaDir = join(appRoot, OTA_DIRNAME);
  return {
    appRoot,
    otaDir,
    stateFile: join(otaDir, 'state.json'),
    journalFile: join(otaDir, 'journal.json'),
    stagingDir: join(otaDir, 'staging'),
    prevDir: join(otaDir, 'prev'),
    fingerprintFile: join(appRoot, FINGERPRINT_FILENAME),
  };
}

/** What this image was built from; '' when the file is absent (a pre-OTA image ⇒ self-update off). */
export function imageFingerprint(paths = otaPaths()): string {
  try {
    return readFileSync(paths.fingerprintFile, 'utf8').trim();
  } catch {
    return '';
  }
}

export interface OtaState {
  /** Commit of the bundle currently swapped in. Absent ⇒ running the image exactly as built. */
  appliedCommit?: string;
  appliedAt?: string;
  /** Build id of the web release this deployment last flipped `current` to. */
  webBuildId?: string;
  /**
   * Set the moment a bundle is swapped in and cleared once the new build has stayed up
   * (`VERIFY_AFTER_MS`). `attempts` counts boots that saw it still set, so a bundle that cannot boot
   * is rolled back instead of leaving the container in a restart loop.
   */
  pendingVerify?: { commit: string; attempts: number };
}

/**
 * The record of one in-flight (or applied-but-unverified) swap. Kept until the new build proves it
 * can stay up, because it is also what a rollback needs.
 *
 * There is no per-path progress field on purpose: `resumeSwaps` derives what is left to do from
 * whether each staged tree still exists, which makes it idempotent and makes an interrupted apply
 * recoverable by simply running it again.
 */
export interface OtaJournal {
  commit: string;
  /** Commit that was running before this apply, so a rollback can restore the reported version. */
  previousCommit?: string;
  /** Absolute dir holding the incoming trees, laid out like the app root. */
  stagingServerDir: string;
  /** Absolute dir the outgoing trees are parked in, laid out like the app root. */
  prevDir: string;
  /** App-root-relative paths this bundle owns. */
  paths: string[];
  /** Absolute path of the web tier's `current` symlink, so a rollback can find it without the
   *  config layer (recover.ts must not import `env`). Absent ⇒ no web release was flipped. */
  webCurrentLink?: string;
  /** Where that symlink pointed before the flip. */
  webPreviousTarget?: string;
  /** Web release dir this apply flipped to. */
  webTarget?: string;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  // Write-then-rename: a torn state.json would be indistinguishable from a corrupt one, and the
  // recovery path reads it on every boot.
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

export function readState(paths = otaPaths()): OtaState {
  return readJson<OtaState>(paths.stateFile) ?? {};
}

export function writeState(state: OtaState, paths = otaPaths()): void {
  writeJson(paths.stateFile, state);
}

export function readJournal(paths = otaPaths()): OtaJournal | null {
  return readJson<OtaJournal>(paths.journalFile);
}

export function writeJournal(journal: OtaJournal, paths = otaPaths()): void {
  writeJson(paths.journalFile, journal);
}

export function clearJournal(paths = otaPaths()): void {
  rmSync(paths.journalFile, { force: true });
}

/** Most owned paths a bundle may declare — a sanity bound, not a real limit (today it is ~16). */
export const MAX_OWNED_PATHS = 64;

/**
 * Whether a bundle-declared path is one this server is willing to overwrite. A manifest is signed,
 * so this is defence in depth rather than the primary gate — but the blast radius of getting it
 * wrong is "an attacker with the signing key relocates arbitrary files", so it is worth being
 * explicit: repo-relative, no traversal, no `node_modules` (an OTA must never touch dependencies),
 * and shallow.
 */
export function isSafeOwnedPath(rel: string): boolean {
  if (rel === '' || isAbsolute(rel) || rel.includes('\\') || rel.includes('\0')) return false;
  const parts = rel.split('/');
  if (parts.length > 4) return false;
  return parts.every(
    (part) => part !== '' && part !== '.' && part !== '..' && part !== 'node_modules',
  );
}

/**
 * Swap in every staged tree that has not been swapped yet, parking the outgoing one under
 * `journal.prevDir`. Returns how many paths moved.
 *
 * Idempotent, and that is the whole recovery story: "has this path been swapped?" is answered by
 * whether its staged copy still exists, so calling this again after an interrupted run finishes the
 * job — no progress bookkeeping to get out of sync with the filesystem.
 *
 * Each individual swap is two `rename()`s within one filesystem, so a path is never partially
 * written; only the sequence across paths can be interrupted.
 */
export function resumeSwaps(journal: OtaJournal, appRoot = otaAppRoot()): number {
  let moved = 0;
  for (const rel of journal.paths) {
    const staged = join(journal.stagingServerDir, rel);
    if (!existsSync(staged)) continue; // already swapped by an earlier pass
    const live = join(appRoot, rel);
    const parked = join(journal.prevDir, rel);
    if (existsSync(live)) {
      mkdirSync(dirname(parked), { recursive: true });
      rmSync(parked, { recursive: true, force: true });
      renameSync(live, parked);
    }
    mkdirSync(dirname(live), { recursive: true });
    renameSync(staged, live);
    moved += 1;
  }
  return moved;
}

/**
 * Re-point a symlink atomically: create it under a temp name, then `rename()` over the old one. A
 * plain `ln -sfn` unlinks first, which would leave nginx a missing document root for an instant.
 */
export function pointSymlink(link: string, target: string): void {
  const tmp = `${link}.tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(target, tmp);
  try {
    renameSync(tmp, link);
  } catch {
    // Renaming over an existing link is not permitted everywhere (Windows refuses it), and `link`
    // might not be a symlink at all if an operator bind-mounted a directory there. Fall back to
    // replace-in-place — no longer atomic, so a request could find no document root for an instant.
    // Production (Linux, symlink) always takes the path above.
    rmSync(link, { recursive: true, force: true });
    renameSync(tmp, link);
  }
}

/** Where a symlink points, or undefined if it is missing or not a symlink. */
export function symlinkTarget(link: string): string | undefined {
  try {
    if (!lstatSync(link).isSymbolicLink()) return undefined;
    return readlinkSync(link);
  } catch {
    return undefined;
  }
}

/** Put every parked tree back, discarding the swapped-in one. Also idempotent. */
export function revertSwaps(journal: OtaJournal, appRoot = otaAppRoot()): number {
  let moved = 0;
  for (const rel of journal.paths) {
    const parked = join(journal.prevDir, rel);
    if (!existsSync(parked)) continue;
    const live = join(appRoot, rel);
    rmSync(live, { recursive: true, force: true });
    mkdirSync(dirname(live), { recursive: true });
    renameSync(parked, live);
    moved += 1;
  }
  return moved;
}
