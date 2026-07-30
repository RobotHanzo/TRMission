#!/usr/bin/env node
// Assembles + signs a server-OTA bundle (docs/release/server-ota.md).
//
//   node tooling/ota/buildBundle.mjs \
//     --out dist-ota --commit <sha> --web-dist <dir> [--admin-dist <dir>] \
//     --bundle-url https://github.com/<owner>/<repo>/releases/download/server-ota/bundle-<sha>.tar.gz
//
// Writes into --out:
//   bundle-<commit>.tar.gz   source subtrees + the built web/admin bundles
//   manifest.json            { payload: base64(canonical manifest), signature: base64(ed25519) }
//
// Two deliberate properties of that shape:
//
//   * The signature covers the payload's exact BYTES, not a re-canonicalised object, so the server's
//     verifier never has to reproduce a canonical form — it verifies what it decoded and then parses
//     it. That removes the whole class of "signer and verifier disagree on key order" bugs.
//   * Payload and signature live in ONE file. Published as two assets they could not be swapped
//     atomically, and every deploy would leave a window where a deployment fetched a new manifest
//     with an old signature — indistinguishable from tampering, and enough to trip the
//     alert-on-any-increase rejection metric on every release.
//
// The signing key comes from --key-file or $TRM_OTA_SIGNING_KEY (PKCS#8 PEM, optionally
// base64-wrapped so it survives a GitHub Actions secret). Without one the bundle is still written
// and no signature is produced — useful for a local dry run, and a deployment refuses an unsigned
// manifest, so it cannot be applied anywhere.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { depsFingerprint } from './depsFingerprint.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** Bumped only for a breaking manifest change; the server refuses a schema it does not know. */
const MANIFEST_SCHEMA = 1;

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required --${name}`);
  }
  return value;
}

function exists(absPath) {
  try {
    statSync(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * The workspaces whose source the server actually loads, walked transitively from
 * apps/server/package.json. Derived rather than listed so a new `@trm/*` dependency is covered
 * without anyone remembering to edit this file — and so client-only packages (client-core and its
 * several MB of sound/art assets) stay out of a server bundle.
 */
function serverWorkspaceDirs(root) {
  const byName = new Map();
  for (const parent of ['packages', 'apps', 'tooling']) {
    for (const entry of safeReaddir(join(root, parent))) {
      const manifestPath = join(root, parent, entry, 'package.json');
      if (!exists(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      byName.set(manifest.name, { dir: `${parent}/${entry}`, manifest });
    }
  }
  const closure = new Set();
  const queue = ['@trm/server'];
  while (queue.length > 0) {
    const name = queue.pop();
    const entry = byName.get(name);
    if (entry === undefined || closure.has(entry.dir)) continue;
    closure.add(entry.dir);
    for (const deps of [entry.manifest.dependencies, entry.manifest.devDependencies]) {
      for (const dep of Object.keys(deps ?? {})) if (dep.startsWith('@trm/')) queue.push(dep);
    }
  }
  return [...closure].sort();
}

function safeReaddir(absPath) {
  try {
    return readdirSync(absPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * The paths an OTA owns, relative to the server app root. Narrow on purpose: `src` and
 * `tsconfig.json` per workspace, never a whole workspace directory — the swap is a `rename()` of
 * each of these, and a workspace root can contain a hoisted `node_modules` that an OTA must never
 * touch. `assets` is excluded too: 20MB of OG fonts that change ~never is the wrong shape for a
 * payload shipped on every commit, so they ride in the image and are fenced by the deps fingerprint
 * (see depsFingerprint.mjs's FIXED_TREES) along with package.json, the lockfile and the Dockerfiles.
 */
function ownedPaths(root) {
  const paths = ['tsconfig.base.json', 'apps/server/instrument.mjs'];
  for (const dir of serverWorkspaceDirs(root)) {
    for (const leaf of ['src', 'tsconfig.json']) {
      if (exists(join(root, dir, leaf))) paths.push(`${dir}/${leaf}`);
    }
  }
  return paths.filter((path) => exists(join(root, path))).sort();
}

function copyTree(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    dereference: true,
    // Defence in depth: an OTA payload must never carry dependencies or build leftovers, even if a
    // future owned path were widened to a workspace root.
    filter: (src) => !/[\\/](?:node_modules|\.turbo|coverage)(?:[\\/]|$)/.test(src),
  });
}

function loadSigningKey() {
  const keyFile = arg('key-file', '');
  const raw =
    keyFile !== '' ? readFileSync(keyFile, 'utf8') : (process.env.TRM_OTA_SIGNING_KEY ?? '');
  if (raw.trim() === '') return null;
  const pem = raw.includes('-----BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`OTA signing key must be ed25519, got ${key.asymmetricKeyType}`);
  }
  return key;
}

/** Compact, recursively key-sorted JSON. The bytes this returns are the signed bytes. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const body = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

const out = resolve(arg('out'));
const commit = arg('commit');
const webDist = resolve(arg('web-dist'));
const adminDist = arg('admin-dist', '');
const bundleUrl = arg('bundle-url', '');
const builtAt = arg('built-at', new Date().toISOString());

const stage = join(out, 'stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const paths = ownedPaths(REPO_ROOT);
for (const path of paths) copyTree(join(REPO_ROOT, path), join(stage, 'server', path));
copyTree(webDist, join(stage, 'web'));
if (adminDist !== '') copyTree(adminDist, join(stage, 'web', 'admin'));

const bundleName = `bundle-${commit}.tar.gz`;
const bundlePath = join(out, bundleName);
rmSync(bundlePath, { force: true });
// GNU tar flags only (ubuntu runners + the node:24-slim image both have GNU tar). --sort/--mtime
// make the archive reproducible for the same input tree, so a re-run is a no-op by digest.
// Run FROM the stage dir with relative paths: GNU tar reads a `C:\…` argument as a remote host, so
// absolute paths here would break every local run on Windows.
execFileSync(
  'tar',
  [
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '-czf',
    join('..', bundleName),
    'server',
    'web',
  ],
  { cwd: stage, stdio: 'inherit' },
);
rmSync(stage, { recursive: true, force: true });

const bytes = readFileSync(bundlePath);
const manifest = {
  schema: MANIFEST_SCHEMA,
  commit,
  builtAt,
  depsFingerprint: depsFingerprint(REPO_ROOT).fingerprint,
  webBuildId: commit,
  paths,
  bundle: {
    name: bundleName,
    url: bundleUrl,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
};

const payload = Buffer.from(canonicalJson(manifest), 'utf8');
const key = loadSigningKey();
if (key === null) {
  console.warn('[ota] no signing key — the manifest is unsigned, so no deployment will accept it');
}
writeFileSync(
  join(out, 'manifest.json'),
  `${JSON.stringify(
    {
      payload: payload.toString('base64'),
      signature: key === null ? '' : sign(null, payload, key).toString('base64'),
    },
    null,
    2,
  )}\n`,
);

console.log(`[ota] ${bundleName} ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MiB`);
console.log(`[ota] fingerprint ${manifest.depsFingerprint}`);
console.log(`[ota] paths (${paths.length}): ${paths.join(', ')}`);
