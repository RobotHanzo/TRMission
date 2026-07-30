#!/usr/bin/env node
// The server-OTA fence (docs/release/server-ota.md).
//
// An OTA bundle carries the SOURCE the server loads and the built web bundles — nothing else. So the
// fingerprint covers exactly the inputs a bundle CANNOT express: `node_modules` (lockfile +
// manifests), the images themselves, the node major, and the server's runtime asset tree. Every
// bundle and every image carry one, and a deployment hot-applies a bundle only when the two match.
// Mismatch ⇒ the update needs a real image pull, which CI routes through the Portainer stack webhook
// instead. Same shape, and the same reason, as mobile's `runtimeVersion: fingerprint` fencing native
// changes (docs/mobile/ota.md).
//
// Deliberately dependency-free and plain .mjs: it runs inside both Dockerfiles (before any install
// has happened, from the raw context) as well as in CI and on a dev machine.
//
//   node tooling/ota/depsFingerprint.mjs            # print the fingerprint
//   node tooling/ota/depsFingerprint.mjs --explain   # print each hashed input, then the total
//
// This file is NOT a yarn workspace (no package.json) on purpose — adding one would change the
// fingerprint itself and force an image pull on every deployment.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Workspace globs from the root package.json are all single-level (`packages/*`), so a readdir is
 *  enough — no glob dependency. Keep in sync if a nested workspace pattern is ever added. */
const WORKSPACE_PARENTS = ['packages', 'apps', 'tooling'];

/** Non-workspace inputs. A change to any of these means the built image differs in a way source
 *  alone cannot express, so it must invalidate the fence. */
const FIXED_INPUTS = [
  'package.json',
  'yarn.lock',
  '.yarnrc.yml',
  '.nvmrc',
  'apps/server/Dockerfile',
  'apps/web/Dockerfile',
];

/**
 * Asset trees the server reads from disk at RUNTIME (the OG renderer's bundled fonts — resvg is
 * handed these files, `loadSystemFonts: false`). They are ~20MB and change approximately never,
 * which is the wrong shape for a payload that ships on every commit — so they ride in the image and
 * are fenced here instead. A font change therefore takes the image path, automatically and visibly,
 * rather than being silently left behind by an OTA that didn't carry it.
 *
 * `packages/client-core/assets` (sounds/art) is deliberately NOT here: it is consumed by the Vite
 * build, so it reaches a deployment inside the bundle's web dist already.
 */
const FIXED_TREES = ['apps/server/assets'];

/**
 * Text inputs are read CRLF-normalised: a Windows checkout must not produce a different fingerprint
 * from the Linux one CI and the Dockerfiles compute, or a dev-built image would refuse every bundle.
 * Binary inputs (the font tree) are hashed as raw bytes — a utf8 read would replace every
 * non-UTF8 sequence and throw away most of what distinguishes one font file from another.
 */
function fileSha256(absPath, text) {
  const raw = readFileSync(absPath);
  const content = text ? raw.toString('utf8').replace(/\r\n/g, '\n') : raw;
  return createHash('sha256').update(content).digest('hex');
}

function workspaceManifests(root) {
  const found = [];
  for (const parent of WORKSPACE_PARENTS) {
    let entries;
    try {
      entries = readdirSync(join(root, parent), { withFileTypes: true });
    } catch {
      continue; // a parent dir that doesn't exist here (e.g. a trimmed build context)
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const rel = posix.join(parent, entry.name, 'package.json');
      try {
        statSync(join(root, rel));
      } catch {
        continue; // a directory that is not a workspace (tooling/ota itself)
      }
      found.push(rel);
    }
  }
  return found;
}

/** Every file under `rel`, repo-relative, sorted. Absent dir ⇒ no contribution. */
function treeFiles(root, rel) {
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const child = posix.join(rel, entry.name);
    if (entry.isDirectory()) files.push(...treeFiles(root, child));
    else files.push(child);
  }
  return files.sort();
}

/**
 * sha256 over every input an OTA bundle cannot carry, in sorted path order, each contributing
 * `<path>\n<sha256(content)>\n` so a rename is as visible as an edit.
 *
 * @param {string} [root] repo root; defaults to this file's repo
 * @returns {{ fingerprint: string, inputs: { path: string, sha256: string }[] }}
 */
export function depsFingerprint(root = REPO_ROOT) {
  const binary = new Set(FIXED_TREES.flatMap((rel) => treeFiles(root, rel)));
  const paths = [...FIXED_INPUTS, ...workspaceManifests(root), ...binary].sort();
  const total = createHash('sha256');
  const inputs = [];
  for (const rel of paths) {
    let sha256;
    try {
      sha256 = fileSha256(join(root, rel), !binary.has(rel));
    } catch {
      continue; // absent here (e.g. .nvmrc excluded from a build context) — skipped consistently
    }
    total.update(`${rel}\n${sha256}\n`);
    inputs.push({ path: rel, sha256 });
  }
  return { fingerprint: `sha256:${total.digest('hex')}`, inputs };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const root = process.env.TRM_FINGERPRINT_ROOT ?? REPO_ROOT;
  const { fingerprint, inputs } = depsFingerprint(root);
  if (process.argv.includes('--explain')) {
    for (const input of inputs) console.error(`${input.sha256}  ${input.path}`);
    console.error(`${inputs.length} inputs`);
  }
  process.stdout.write(`${fingerprint}\n`);
}
