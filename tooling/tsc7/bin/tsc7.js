#!/usr/bin/env node
'use strict';

// Resolve via the package.json `bin` field, not a subpath import — the native
// TypeScript 7 package's `exports` map doesn't expose `./bin/tsc`, and Yarn's
// builtin compat/typescript patch reinjects its own classic-API `tsc` binary
// wherever a plain `typescript`/`tsc` bin name is resolved, so `.bin/tsc`
// cannot be trusted to point at the real native compiler.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const pkgPath = require.resolve('@typescript/native/package.json');
const pkg = require(pkgPath);
const tsc = path.join(path.dirname(pkgPath), pkg.bin.tsc);

try {
  execFileSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: 'inherit' });
} catch (err) {
  process.exit(typeof err.status === 'number' ? err.status : 1);
}
