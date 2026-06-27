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
  },
});
