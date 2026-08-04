// Applying a verified OTA bundle (docs/release/server-ota.md).
//
// Order of operations is load-bearing:
//
//   1. download + digest-check + extract + validate   — nothing outside .trm-ota/ has changed yet
//   2. write and flip the WEB release                 — cheap, reversible, and nginx picks it up live
//   3. journal, then swap the SERVER source trees     — the irreversible part, now recoverable
//   4. hand back to the caller to restart the process
//
// Web goes first so that when the restart drops every socket — which is what makes clients check
// their build id — the new bundle is already what nginx serves. Reversed, every client would look,
// see the old build, and stay on it until the next poll.
import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import {
  clearJournal,
  otaPaths,
  pointSymlink,
  readState,
  resumeSwaps,
  revertSwaps,
  symlinkTarget,
  writeJournal,
  writeState,
  type OtaJournal,
  type OtaPaths,
} from './layout';
import { MAX_BUNDLE_BYTES, ManifestRejected, sha256Hex, type OtaManifest } from './manifest';

const execFileAsync = promisify(execFile);

/** Web releases kept in the shared volume. Two is enough: `current`, plus the `previous` that
 *  nginx.conf falls back to for a tab that hasn't reloaded yet. Three leaves one spare to roll to. */
const KEEP_WEB_RELEASES = 3;
/** Parked (pre-swap) source trees kept for rollback. */
const KEEP_PREV_TREES = 2;

export interface WebTier {
  /** Root of the volume shared with the nginx container (its `current` symlink lives here). */
  root: string;
  /** Whether that volume is really the one nginx serves — see apps/web/docker-seed-releases.sh. */
  shared: boolean;
}

/**
 * Whether the web tier's release volume is actually reachable from this container. The sentinel is
 * written by the nginx container's own entrypoint, so its presence is the only honest signal that a
 * release written here is a release someone will serve. Without it the server still updates itself
 * and simply reports web OTA as unavailable, rather than silently writing releases into its own
 * private filesystem.
 */
export function inspectWebTier(root: string): WebTier {
  return { root, shared: existsSync(join(root, '.web-tier')) };
}

async function download(manifest: OtaManifest, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetch(manifest.bundle.url, {
    ...(signal === undefined ? {} : { signal }),
    redirect: 'follow',
  });
  if (!response.ok) throw new ManifestRejected(`bundle_http_${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_BUNDLE_BYTES) throw new ManifestRejected('bundle_too_large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new ManifestRejected('bundle_too_large');
  if (bytes.byteLength !== manifest.bundle.size) throw new ManifestRejected('bundle_size_mismatch');
  if (sha256Hex(bytes) !== manifest.bundle.sha256)
    throw new ManifestRejected('bundle_digest_mismatch');
  return bytes;
}

function readWebBuildId(webDir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(webDir, 'build.json'), 'utf8')) as {
      buildId?: unknown;
    };
    return typeof parsed.buildId === 'string' ? parsed.buildId : null;
  } catch {
    return null;
  }
}

async function extract(archive: string, into: string): Promise<void> {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  // No -P, so absolute paths and `..` members are stripped by tar itself; --no-same-owner keeps
  // extraction from trying to chown as a non-root user. The archive is signed, so this is defence in
  // depth on top of the signature, not the primary control.
  //
  // Run FROM the target dir with a relative archive path rather than passing absolutes: GNU tar reads
  // a `C:\…` argument as a remote host, so absolutes here would make this untestable on a Windows dev
  // machine (it works fine in the container, which is the only place it really runs).
  await execFileAsync('tar', ['-xzf', relative(into, archive), '--no-same-owner'], { cwd: into });
}

function pruneReleases(dir: string, keep: number, protectedPaths: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const stamped = entries
    .map((name) => join(dir, name))
    .filter((path) => !protectedPaths.includes(path))
    .map((path) => ({ path, mtime: safeMtime(path) }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of stamped.slice(keep)) rmSync(stale.path, { recursive: true, force: true });
}

function safeMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Copy the bundle's web output into the shared volume and flip `current` (plus `previous`, which
 * nginx.conf serves stale `/assets/` from). Returns what `current` pointed at before, so an aborted
 * apply can put it back.
 */
function applyWebRelease(
  manifest: OtaManifest,
  stagedWebDir: string,
  web: WebTier,
): { previousTarget?: string; target: string } {
  const releases = join(web.root, 'releases');
  const target = join(releases, manifest.webBuildId);
  mkdirSync(releases, { recursive: true });
  if (!existsSync(join(target, 'index.html'))) {
    const tmp = `${target}.tmp`;
    rmSync(tmp, { recursive: true, force: true });
    // A copy, not a rename: the release volume is a different filesystem from .trm-ota/.
    cpSync(stagedWebDir, tmp, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(tmp, target);
  }
  const currentLink = join(web.root, 'current');
  const previousTarget = symlinkTarget(currentLink);
  if (previousTarget !== undefined && previousTarget !== target) {
    pointSymlink(join(web.root, 'previous'), previousTarget);
  }
  pointSymlink(currentLink, target);
  pruneReleases(releases, KEEP_WEB_RELEASES, [
    target,
    ...(previousTarget === undefined ? [] : [previousTarget]),
  ]);
  return { ...(previousTarget === undefined ? {} : { previousTarget }), target };
}

export interface ApplyOptions {
  manifest: OtaManifest;
  /** Commit currently running, recorded so a rollback can restore the reported version. */
  runningCommit: string;
  web: WebTier;
  paths?: OtaPaths;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

/**
 * Download, verify, and swap in a bundle. On return the new source is in place and the caller must
 * restart the process — nothing in the running module graph has been reloaded.
 *
 * Throws (leaving the deployment untouched) for any failure before the source swap begins. Once the
 * swap begins, a failure reverts what moved and rethrows; a crash instead leaves the journal, which
 * `recover.ts` resumes on the next boot.
 */
export async function applyBundle(options: ApplyOptions): Promise<void> {
  const { manifest } = options;
  const paths = options.paths ?? otaPaths();
  const log = options.log ?? (() => {});

  const workDir = join(paths.stagingDir, manifest.commit);
  const archive = join(paths.stagingDir, manifest.bundle.name);
  mkdirSync(paths.stagingDir, { recursive: true });

  const bytes = await download(manifest, options.signal);
  writeFileSync(archive, bytes);
  log(`downloaded ${manifest.bundle.name} (${bytes.byteLength} bytes, digest ok)`);

  try {
    await extract(archive, workDir);
  } finally {
    rmSync(archive, { force: true });
  }

  // Everything from here on is either applied or discarded — an extracted tree that got rejected,
  // or one whose swap was reverted, is never looked at again. Without the `finally` a refused
  // bundle would leave its whole extracted source+web tree under .trm-ota/staging/<commit> for the
  // life of the container, once per commit that fails validation.
  try {
    await applyExtracted(options, paths, workDir, log);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function applyExtracted(
  options: ApplyOptions,
  paths: OtaPaths,
  workDir: string,
  log: (message: string) => void,
): Promise<void> {
  const { manifest, web, runningCommit } = options;
  const stagedServer = join(workDir, 'server');
  const stagedWeb = join(workDir, 'web');
  for (const rel of manifest.paths) {
    if (!existsSync(join(stagedServer, rel)))
      throw new ManifestRejected(`bundle_missing_path:${rel}`);
  }
  if (!existsSync(join(stagedWeb, 'index.html'))) throw new ManifestRejected('bundle_missing_web');
  // The web bundle's own build.json must agree with the manifest's webBuildId. If they disagree,
  // every client polls /build.json, sees an id that never matches the bundle it is served, and
  // reloads — the loop `useAutoReload`'s cooldown exists to survive. Cheaper to refuse here.
  if (readWebBuildId(stagedWeb) !== manifest.webBuildId) {
    throw new ManifestRejected('bundle_build_id_mismatch');
  }

  const webResult = web.shared ? applyWebRelease(manifest, stagedWeb, web) : undefined;
  if (webResult !== undefined) log(`web release ${manifest.webBuildId} is live`);
  else log('web tier volume not shared with this container — server-only update');

  const journal: OtaJournal = {
    commit: manifest.commit,
    previousCommit: runningCommit,
    stagingServerDir: stagedServer,
    prevDir: join(paths.prevDir, manifest.commit),
    paths: manifest.paths,
    ...(webResult?.previousTarget === undefined
      ? {}
      : { webPreviousTarget: webResult.previousTarget }),
    ...(webResult === undefined
      ? {}
      : { webTarget: webResult.target, webCurrentLink: join(web.root, 'current') }),
  };
  writeJournal(journal, paths);

  try {
    const moved = resumeSwaps(journal, paths.appRoot);
    log(`swapped ${moved} source trees to ${manifest.commit}`);
  } catch (error) {
    revertSwaps(journal, paths.appRoot);
    if (webResult?.previousTarget !== undefined) {
      pointSymlink(join(web.root, 'current'), webResult.previousTarget);
    }
    clearJournal(paths);
    throw error;
  }

  const state = readState(paths);
  writeState(
    {
      ...state,
      appliedCommit: manifest.commit,
      appliedAt: new Date().toISOString(),
      ...(webResult === undefined ? {} : { webBuildId: manifest.webBuildId }),
      pendingVerify: { commit: manifest.commit, attempts: 0 },
    },
    paths,
  );

  pruneReleases(paths.prevDir, KEEP_PREV_TREES, [journal.prevDir]);
}
