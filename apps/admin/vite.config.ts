/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The maintainer dashboard is served under /admin/ from the same origin as the API
// (the Strict refresh cookie requires it). Vite ^5 is pinned repo-wide (vitest 2).
const serverHost = process.env.VITE_SERVER_HOST ?? 'localhost';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
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
