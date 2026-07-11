// The PURE test lane: node-env vitest over `src/**/*.spec.ts` (tutorial parity/curriculum/board
// math — no RN imports allowed). RN components stay in the jest-expo lane (`*.test.ts(x)`); the
// two globs are disjoint on purpose — jest's testMatch excludes `*.spec.*`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.spec.ts'], environment: 'node' },
});
