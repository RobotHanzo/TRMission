import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyBundle } from '../src/selfupdate/applier';
import {
  isSafeOwnedPath,
  otaPaths,
  readJournal,
  readState,
  resumeSwaps,
  revertSwaps,
  writeJournal,
  writeState,
  type OtaJournal,
} from '../src/selfupdate/layout';
import { ManifestRejected, verifyManifest } from '../src/selfupdate/manifest';
import { recoverSelfUpdate } from '../src/selfupdate/recover';

const keys = generateKeyPairSync('ed25519');

function envelope(manifest: unknown, signer = keys.privateKey): Buffer {
  const payload = Buffer.from(JSON.stringify(manifest), 'utf8');
  return Buffer.from(
    JSON.stringify({
      payload: payload.toString('base64'),
      signature: sign(null, payload, signer).toString('base64'),
    }),
  );
}

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    commit: 'a'.repeat(40),
    builtAt: '2026-07-30T00:00:00.000Z',
    depsFingerprint: `sha256:${'f'.repeat(64)}`,
    webBuildId: 'a'.repeat(40),
    paths: ['apps/server/src', 'packages/engine/src'],
    bundle: {
      name: 'bundle.tar.gz',
      url: 'https://example.test/bundle.tar.gz',
      size: 10,
      sha256: '0'.repeat(64),
    },
    ...overrides,
  };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'trm-ota-'));
}

function writeFile(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

describe('OTA manifest verification', () => {
  it('accepts a manifest signed by the configured key', () => {
    const manifest = verifyManifest(envelope(validManifest()), keys.publicKey);
    expect(manifest.commit).toBe('a'.repeat(40));
    expect(manifest.paths).toEqual(['apps/server/src', 'packages/engine/src']);
  });

  it('rejects a payload signed by a DIFFERENT key', () => {
    const attacker = generateKeyPairSync('ed25519');
    expect(() =>
      verifyManifest(envelope(validManifest(), attacker.privateKey), keys.publicKey),
    ).toThrow(/bad_signature/);
  });

  it('rejects a payload edited after signing', () => {
    const signed = JSON.parse(envelope(validManifest()).toString('utf8')) as {
      payload: string;
      signature: string;
    };
    const tampered = Buffer.from(JSON.stringify(validManifest({ commit: 'b'.repeat(40) })), 'utf8');
    const forged = Buffer.from(JSON.stringify({ ...signed, payload: tampered.toString('base64') }));
    expect(() => verifyManifest(forged, keys.publicKey)).toThrow(/bad_signature/);
  });

  it('rejects an unsigned manifest', () => {
    const payload = Buffer.from(JSON.stringify(validManifest()), 'utf8');
    const unsigned = Buffer.from(
      JSON.stringify({ payload: payload.toString('base64'), signature: '' }),
    );
    expect(() => verifyManifest(unsigned, keys.publicKey)).toThrow(/bad_signature/);
  });

  it('rejects a schema it does not understand rather than guessing', () => {
    expect(() => verifyManifest(envelope(validManifest({ schema: 2 })), keys.publicKey)).toThrow(
      /unsupported_schema/,
    );
  });

  // Signed or not, a path outside the owned shape must never reach a rename().
  it.each([
    ['../../etc', ['../../etc']],
    ['absolute', ['/etc/passwd']],
    ['traversal mid-path', ['apps/../../etc']],
    ['node_modules', ['packages/engine/node_modules']],
    ['too deep', ['a/b/c/d/e']],
  ])('rejects an unsafe declared path (%s)', (_label, paths) => {
    expect(() => verifyManifest(envelope(validManifest({ paths })), keys.publicKey)).toThrow(
      /unsafe_path|schema_mismatch/,
    );
  });

  it('screens owned paths directly too', () => {
    expect(isSafeOwnedPath('apps/server/src')).toBe(true);
    expect(isSafeOwnedPath('tsconfig.base.json')).toBe(true);
    expect(isSafeOwnedPath('')).toBe(false);
    expect(isSafeOwnedPath('a/../b')).toBe(false);
    expect(isSafeOwnedPath('apps\\server\\src')).toBe(false);
  });
});

describe('OTA swap primitive', () => {
  function stage(root: string): OtaJournal {
    writeFile(join(root, 'app/apps/server/src/main.ts'), 'old-server');
    writeFile(join(root, 'app/packages/engine/src/index.ts'), 'old-engine');
    writeFile(join(root, 'staging/server/apps/server/src/main.ts'), 'new-server');
    writeFile(join(root, 'staging/server/packages/engine/src/index.ts'), 'new-engine');
    return {
      commit: 'newsha',
      previousCommit: 'oldsha',
      stagingServerDir: join(root, 'staging/server'),
      prevDir: join(root, 'prev'),
      paths: ['apps/server/src', 'packages/engine/src'],
    };
  }

  it('swaps every declared tree and parks the outgoing one', () => {
    const root = scratch();
    const journal = stage(root);
    expect(resumeSwaps(journal, join(root, 'app'))).toBe(2);
    expect(readFileSync(join(root, 'app/apps/server/src/main.ts'), 'utf8')).toBe('new-server');
    expect(readFileSync(join(root, 'prev/apps/server/src/main.ts'), 'utf8')).toBe('old-server');
  });

  it('is idempotent — a second pass moves nothing', () => {
    const root = scratch();
    const journal = stage(root);
    resumeSwaps(journal, join(root, 'app'));
    expect(resumeSwaps(journal, join(root, 'app'))).toBe(0);
    expect(readFileSync(join(root, 'app/packages/engine/src/index.ts'), 'utf8')).toBe('new-engine');
  });

  // The recovery contract: an apply interrupted between two renames is finished by re-running it.
  it('finishes an apply interrupted midway', () => {
    const root = scratch();
    const journal = stage(root);
    const appRoot = join(root, 'app');
    // Simulate "first path swapped, then the process died".
    resumeSwaps({ ...journal, paths: ['apps/server/src'] }, appRoot);
    expect(readFileSync(join(appRoot, 'packages/engine/src/index.ts'), 'utf8')).toBe('old-engine');

    expect(resumeSwaps(journal, appRoot)).toBe(1);
    expect(readFileSync(join(appRoot, 'apps/server/src/main.ts'), 'utf8')).toBe('new-server');
    expect(readFileSync(join(appRoot, 'packages/engine/src/index.ts'), 'utf8')).toBe('new-engine');
  });

  it('reverts back to the parked trees', () => {
    const root = scratch();
    const journal = stage(root);
    const appRoot = join(root, 'app');
    resumeSwaps(journal, appRoot);
    expect(revertSwaps(journal, appRoot)).toBe(2);
    expect(readFileSync(join(appRoot, 'apps/server/src/main.ts'), 'utf8')).toBe('old-server');
    expect(readFileSync(join(appRoot, 'packages/engine/src/index.ts'), 'utf8')).toBe('old-engine');
  });
});

describe('OTA boot recovery', () => {
  function stageApplied(root: string): { appRoot: string; journal: OtaJournal } {
    const appRoot = join(root, 'app');
    writeFile(join(appRoot, 'apps/server/src/main.ts'), 'old-server');
    writeFile(join(root, 'staging/server/apps/server/src/main.ts'), 'new-server');
    const journal: OtaJournal = {
      commit: 'newsha',
      previousCommit: 'oldsha',
      stagingServerDir: join(root, 'staging/server'),
      prevDir: join(root, 'prev'),
      paths: ['apps/server/src'],
    };
    resumeSwaps(journal, appRoot);
    const paths = otaPaths(appRoot);
    writeJournal(journal, paths);
    writeState(
      { appliedCommit: 'newsha', pendingVerify: { commit: 'newsha', attempts: 0 } },
      paths,
    );
    return { appRoot, journal };
  }

  it('counts a boot against an unverified bundle without touching it', () => {
    const root = scratch();
    const { appRoot } = stageApplied(root);
    process.env.TRM_SELFUPDATE_APP_ROOT = appRoot;
    try {
      recoverSelfUpdate();
    } finally {
      delete process.env.TRM_SELFUPDATE_APP_ROOT;
    }
    const paths = otaPaths(appRoot);
    expect(readState(paths).pendingVerify).toEqual({ commit: 'newsha', attempts: 1 });
    expect(readFileSync(join(appRoot, 'apps/server/src/main.ts'), 'utf8')).toBe('new-server');
  });

  it('rolls back a bundle that cannot boot, and reports the previous commit again', () => {
    const root = scratch();
    const { appRoot } = stageApplied(root);
    process.env.TRM_SELFUPDATE_APP_ROOT = appRoot;
    try {
      recoverSelfUpdate(); // attempts → 1
      recoverSelfUpdate(); // attempts → 2
      recoverSelfUpdate(); // over the limit ⇒ roll back
    } finally {
      delete process.env.TRM_SELFUPDATE_APP_ROOT;
    }
    const paths = otaPaths(appRoot);
    expect(readFileSync(join(appRoot, 'apps/server/src/main.ts'), 'utf8')).toBe('old-server');
    expect(readJournal(paths)).toBeNull();
    const state = readState(paths);
    expect(state.appliedCommit).toBe('oldsha');
    expect(state.pendingVerify).toBeUndefined();
  });

  it('does nothing at all when no update has ever been applied', () => {
    const root = scratch();
    process.env.TRM_SELFUPDATE_APP_ROOT = root;
    try {
      expect(() => recoverSelfUpdate()).not.toThrow();
    } finally {
      delete process.env.TRM_SELFUPDATE_APP_ROOT;
    }
    expect(existsSync(otaPaths(root).stateFile)).toBe(false);
  });
});

describe('applying a real bundle end to end', () => {
  /** Builds the same archive layout tooling/ota/buildBundle.mjs produces. */
  function buildArchive(root: string, commit: string): { path: string; bytes: Buffer } {
    const stage = join(root, 'bundle-src');
    writeFile(join(stage, 'server/apps/server/src/main.ts'), 'new-server');
    writeFile(join(stage, 'server/packages/engine/src/index.ts'), 'new-engine');
    writeFile(join(stage, 'web/index.html'), '<html>new</html>');
    writeFile(join(stage, 'web/build.json'), JSON.stringify({ buildId: commit }));
    writeFile(join(stage, 'web/assets/app-new.js'), 'console.log(1)');
    const path = join(root, 'bundle.tar.gz');
    execFileSync('tar', ['-czf', join('..', 'bundle.tar.gz'), 'server', 'web'], { cwd: stage });
    return { path, bytes: readFileSync(path) };
  }

  it('digest-checks, flips the web release, swaps the source, and journals it', async () => {
    const root = scratch();
    const commit = 'c'.repeat(40);
    const { bytes } = buildArchive(root, commit);
    const appRoot = join(root, 'app');
    writeFile(join(appRoot, 'apps/server/src/main.ts'), 'old-server');
    writeFile(join(appRoot, 'packages/engine/src/index.ts'), 'old-engine');
    const webRoot = join(root, 'srv-web');
    writeFile(join(webRoot, '.web-tier'), 'seeded'); // the nginx-side sentinel
    writeFile(join(webRoot, 'releases/old/index.html'), '<html>old</html>');
    const { pointSymlink } = await import('../src/selfupdate/layout');
    pointSymlink(join(webRoot, 'current'), join(webRoot, 'releases/old'));

    const manifest = verifyManifest(
      envelope(
        validManifest({
          commit,
          webBuildId: commit,
          bundle: {
            name: 'bundle.tar.gz',
            url: 'https://example.test/bundle.tar.gz',
            size: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
        }),
      ),
      keys.publicKey,
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(bytes))) as typeof fetch;
    try {
      await applyBundle({
        manifest,
        runningCommit: 'oldsha',
        web: { root: webRoot, shared: true },
        paths: otaPaths(appRoot),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Source swapped, old trees parked for rollback.
    expect(readFileSync(join(appRoot, 'apps/server/src/main.ts'), 'utf8')).toBe('new-server');
    expect(readFileSync(join(appRoot, 'packages/engine/src/index.ts'), 'utf8')).toBe('new-engine');
    // Web release written and `current` flipped; `previous` still serves the old asset hashes.
    expect(readFileSync(join(webRoot, 'current/index.html'), 'utf8')).toBe('<html>new</html>');
    expect(readFileSync(join(webRoot, 'previous/index.html'), 'utf8')).toBe('<html>old</html>');
    // Journal + rollback marker survive until the new build proves itself.
    const paths = otaPaths(appRoot);
    // Staging is emptied on the way out — the journal points into it, but recovery derives what is
    // left to do from the live tree, and a completed apply has nothing left to resume.
    expect(existsSync(join(paths.stagingDir, commit))).toBe(false);
    expect(readJournal(paths)?.commit).toBe(commit);
    expect(readState(paths)).toMatchObject({
      appliedCommit: commit,
      webBuildId: commit,
      pendingVerify: { commit, attempts: 0 },
    });
  });

  it('refuses a bundle whose digest does not match the manifest', async () => {
    const root = scratch();
    const commit = 'd'.repeat(40);
    const { bytes } = buildArchive(root, commit);
    const manifest = verifyManifest(
      envelope(
        validManifest({
          commit,
          webBuildId: commit,
          bundle: {
            name: 'bundle.tar.gz',
            url: 'https://example.test/bundle.tar.gz',
            size: bytes.byteLength,
            sha256: '1'.repeat(64),
          },
        }),
      ),
      keys.publicKey,
    );
    const appRoot = join(root, 'app');
    writeFile(join(appRoot, 'apps/server/src/main.ts'), 'old-server');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(bytes))) as typeof fetch;
    try {
      await expect(
        applyBundle({
          manifest,
          runningCommit: 'oldsha',
          web: { root: join(root, 'srv-web'), shared: false },
          paths: otaPaths(appRoot),
        }),
      ).rejects.toThrow(ManifestRejected);
    } finally {
      globalThis.fetch = originalFetch;
    }
    // Nothing moved: a failed verification leaves the deployment exactly as it was.
    expect(readFileSync(join(appRoot, 'apps/server/src/main.ts'), 'utf8')).toBe('old-server');
    expect(readJournal(otaPaths(appRoot))).toBeNull();
  });

  it('leaves nothing staged behind when a bundle extracts but is then refused', async () => {
    const root = scratch();
    // The archive stamps its own build.json with `commit`; the manifest claims a different
    // webBuildId, so this is refused only AFTER the tarball has been downloaded and extracted.
    const commit = 'e'.repeat(40);
    const { bytes } = buildArchive(root, commit);
    const manifest = verifyManifest(
      envelope(
        validManifest({
          commit,
          webBuildId: 'f'.repeat(40),
          bundle: {
            name: 'bundle.tar.gz',
            url: 'https://example.test/bundle.tar.gz',
            size: bytes.byteLength,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          },
        }),
      ),
      keys.publicKey,
    );
    const appRoot = join(root, 'app');
    writeFile(join(appRoot, 'apps/server/src/main.ts'), 'old-server');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(bytes))) as typeof fetch;
    try {
      await expect(
        applyBundle({
          manifest,
          runningCommit: 'oldsha',
          web: { root: join(root, 'srv-web'), shared: false },
          paths: otaPaths(appRoot),
        }),
      ).rejects.toThrow(ManifestRejected);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // The extracted tree is gone: a refused bundle must not cost the app volume ~20MB per commit
    // for the life of the container. The archive itself is dropped right after extraction.
    const paths = otaPaths(appRoot);
    expect(existsSync(join(paths.stagingDir, commit))).toBe(false);
    expect(existsSync(join(paths.stagingDir, 'bundle.tar.gz'))).toBe(false);
    expect(readFileSync(join(appRoot, 'apps/server/src/main.ts'), 'utf8')).toBe('old-server');
  });
});
