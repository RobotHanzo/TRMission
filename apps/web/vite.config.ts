import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev proxies REST + WebSocket to the NestJS server so the app is same-origin.
// Override VITE_SERVER_HOST when the server runs in a Docker sibling container.
const serverHost = process.env.VITE_SERVER_HOST ?? 'localhost';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: `http://${serverHost}:3001`, changeOrigin: true },
      '/ws': { target: `ws://${serverHost}:3001`, ws: true },
    },
    allowedHosts: ['trmission.robothanzo.dev', 'localhost'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
