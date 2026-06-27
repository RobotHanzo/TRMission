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
        { name: 'Date', message: 'The engine must be deterministic — no wall-clock. Pass time in via state/config.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded counter PRNG from @trm/shared.' },
        { object: 'Date', property: 'now', message: 'The engine must be deterministic — no wall-clock.' },
        { object: 'crypto', property: 'randomUUID', message: 'No nondeterministic ids in the engine.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'No wall-clock in the engine.' },
      ],
    },
  },
  // Tests may use whatever they need.
  {
    files: ['**/*.{spec,test}.ts', '**/test/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
    },
  },
);
