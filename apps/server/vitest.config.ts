import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS DI resolves constructor dependencies from emitted decorator metadata, which
// esbuild (vitest's default transform) does not produce. swc does — so booting the
// Nest app in integration tests works without sprinkling @Inject everywhere.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
        keepClassNames: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Bots play instantly in tests (no inter-move delay) so games finish fast.
    env: { TRM_BOT_DELAY_MS: '0' },
    // Full-game e2e specs boot a Nest app + mongodb-memory-server; the 5s default
    // is tight under CI runner contention even though it's comfortable locally.
    testTimeout: 20000,
    // mongodb-memory-server's cross-run download lock keys off process.pid to tell
    // "another instance in this process" apart from "a different process". Worker
    // threads (vitest's default pool) all share one pid but have isolated module
    // state, so on a cold binary cache every e2e file's MongoMemoryServer.create()
    // believes it alone holds the lock and races the others to download+rename the
    // same temp file — ENOENT on the loser, then a beforeAll hook timeout. Forks
    // give each test file a real OS pid, which the lock's isAlive(pid) check needs
    // to actually serialize the download.
    pool: 'forks',
  },
});
