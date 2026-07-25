/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// The maintainer dashboard is served under /admin/ from the same origin as the API
// (the Strict refresh cookie requires it). Vite ^5 is pinned repo-wide (vitest 2).
const serverHost = process.env.VITE_SERVER_HOST ?? 'localhost';

// Source-map upload for readable Sentry stack traces — opt-in via SENTRY_AUTH_TOKEN (a
// build-machine secret, never an import.meta.env key). Without it the plugin is not installed and
// the build is unchanged. Maps are generated only for the upload and deleted after, never served.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN ?? '';
const uploadSourceMaps = sentryAuthToken !== '';
const sentryPlugins = (): PluginOption[] =>
  uploadSourceMaps
    ? [
        sentryVitePlugin({
          authToken: sentryAuthToken,
          // Omitted rather than undefined: sentry-cli falls back to its own SENTRY_ORG lookup.
          ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
          project: process.env.SENTRY_ADMIN_PROJECT ?? 'trmission-admin',
          // Must match `release` in src/observability/sentry.ts, or the maps bind to nothing.
          release: { name: process.env.VITE_COMMIT_HASH ?? 'dev' },
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          telemetry: false,
        }),
      ]
    : [];

export default defineConfig({
  base: '/admin/',
  plugins: [react(), ...sentryPlugins()],
  build: { sourcemap: uploadSourceMaps ? 'hidden' : false },
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': { target: `http://${serverHost}:3001`, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
