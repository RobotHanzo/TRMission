import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the TRMission monorepo.
 *
 * The `@trm/engine` package gets extra "purity" guardrails: it must be a pure,
 * deterministic reducer, so non-deterministic globals are banned there (see ADR A4).
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/src/gen/**',
      '.yarn/**',
      '**/*.config.{js,mjs,cjs}',
      // jest infrastructure is CommonJS by necessity (loaded by jest itself, not the app).
      '**/__mocks__/**',
      '**/jest.resolver.js',
      '**/jest.setup.js',
      // plain CommonJS bin script (no build step, run directly by node).
      'tooling/tsc7/bin/**',
      // brand-asset generator (plain node script, run manually; see apps/mobile/assets/*.png).
      'apps/mobile/scripts/gen-brand-assets.js',
      // plain CommonJS node script run by the `web` package.json script (not app code).
      'apps/mobile/scripts/setup-web.js',
      // plain CommonJS node script run directly by the release/OTA lanes (see issue #62).
      'apps/mobile/scripts/fingerprintEnv.js',
      // plain node script run by hand before a Play submission to regenerate the Data safety
      // answers (docs/release/play-data-safety.md).
      'docs/release/play-data-safety.mjs',
      // plain node scripts run by hand to regenerate committed output, not app code: the shared
      // train-car art module (packages/client-core/src/art/) and the demo page that showcases it.
      'packages/client-core/tools/*.mjs',
      'docs/demos/**/tools/*.js',
      // Expo config plugins: CommonJS by necessity (Expo `require`s them from app.config.ts's
      // `plugins` array, outside any TS transform). Their logic is covered by *.test.ts instead.
      'apps/mobile/plugins/*.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Engine purity: determinism must be enforced structurally.
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'The engine must be deterministic — no wall-clock. Pass time in via state/config.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded counter PRNG from @trm/shared.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'The engine must be deterministic — no wall-clock.',
        },
        {
          object: 'crypto',
          property: 'randomUUID',
          message: 'No nondeterministic ids in the engine.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'No wall-clock in the engine.' },
      ],
    },
  },
  // Bot policy determinism: a pick must be a pure function of state + botId (the server
  // logs the chosen action, so replay/recovery must reproduce it byte-identically).
  {
    files: ['packages/bots/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Bot picks must be deterministic — seed from state.actionSeq (see rngFor).',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Bot picks must be deterministic — no wall-clock.',
        },
      ],
    },
  },
  // Stale-chunk recovery: every lazy route must carry the contract, structurally.
  // A bare `React.lazy` hands the module mapper whatever a cancelled `vite:preloadError` resolved
  // with — `undefined` — and the mapper throws a crash screen at a tab that was already reloading
  // (TRMISSION-WEB-7). `lazyChunk` is that contract; the docs said "always use it", which is exactly
  // the kind of rule this repo enforces in the linter instead. See apps/web/src/lib/CLAUDE.md.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              importNames: ['lazy'],
              message:
                'Use lazyChunk() from lib/preloadRecovery — bare React.lazy has no stale-deploy/flaky-network recovery (TRMISSION-WEB-7/8).',
            },
          ],
        },
      ],
    },
  },
  // preloadRecovery.ts IS the contract, so it is the one place that wraps React.lazy itself.
  {
    files: ['apps/web/src/lib/preloadRecovery.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // NestJS DI resolves constructor dependencies from emitted decorator metadata, which
  // requires injected classes to be VALUE imports. consistent-type-imports can't see
  // that usage, so it is disabled here; verbatimModuleSyntax still enforces correctness.
  {
    files: ['apps/server/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  // apps/server/instrument.mjs: plain Node ESM, loaded by node itself via `--import` before any
  // TS transform exists (see apps/server/CLAUDE.md). Not covered by the `*.config.*` ignore above.
  {
    files: ['apps/server/instrument.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
  // tooling/ota/*.mjs: plain Node ESM run directly by node — inside both Dockerfiles (before any
  // install exists, so it can have no dependencies), in CI, and by hand. Kept linted rather than
  // added to `ignores` above: this is the code that decides what a deployment will accept
  // (docs/release/server-ota.md).
  {
    files: ['tooling/ota/*.mjs'],
    languageOptions: {
      globals: { Buffer: 'readonly', console: 'readonly', process: 'readonly' },
    },
  },
  // Tests may use whatever they need.
  {
    files: ['**/*.{spec,test}.ts', '**/test/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
      // The e2e specs drive the hub with `encodeClient(++seq, …)`. On the LAST frame of a spec the
      // store-back is dead, which eslint 10 flags — but dropping it to `seq + 1` would mean the
      // next frame anyone appends silently reuses a seq, and the hub discards a replayed
      // client_seq as a duplicate. Keep the counter honest; the dead store is the cheap half.
      'no-useless-assignment': 'off',
    },
  },
);
