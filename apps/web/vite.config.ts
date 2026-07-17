import { defineConfig } from 'vitest/config';
import type { Connect, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxies REST + WebSocket to the NestJS server so the app is same-origin.
// Override VITE_SERVER_HOST when the server runs in a Docker sibling container.
const serverHost = process.env.VITE_SERVER_HOST ?? 'localhost';

// Mirrors apps/web/nginx.conf's bot map: link-preview crawlers hitting /, /room/*,
// /replay/*, or /maps (shared-map links carry ?code=) get the server's OG meta page
// instead of the SPA shell, in dev too (so a shared dev link — e.g. the
// trmission.robothanzo.dev tunnel — still unfurls).
const OG_BOT_UA =
  /facebookexternalhit|facebot|twitterbot|slackbot|discordbot|telegrambot|whatsapp|linkedinbot|pinterestbot|redditbot|skypeuripreview|embedly|iframely|line\/|kakaotalk/i;
const OG_PATH = /^\/(?:$|room\/|replay\/|maps$)/;

function ogPreviewPlugin(): Plugin {
  return {
    name: 'trm-og-preview',
    apply: 'serve',
    configureServer(server) {
      // Registered here (not returned) so it runs BEFORE Vite's internal SPA-fallback
      // middleware — otherwise every bot request would already have been served index.html.
      const middleware: Connect.NextHandleFunction = (req, res, next) => {
        const ua = req.headers['user-agent'] ?? '';
        const [pathname = '/', search = ''] = (req.url ?? '/').split('?', 2) as [string?, string?];
        if (req.method !== 'GET' || !OG_BOT_UA.test(ua) || !OG_PATH.test(pathname)) {
          next();
          return;
        }
        const forwardedHost =
          (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? '';
        const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
        // The original query is appended after the rewritten one (a shared-map link's ?code=…),
        // exactly like nginx's rewrite does in production.
        const qs = `path=${encodeURIComponent(pathname)}${search ? `&${search}` : ''}`;
        fetch(`http://${serverHost}:3001/api/v1/og/page?${qs}`, {
          headers: { 'x-forwarded-host': forwardedHost, 'x-forwarded-proto': forwardedProto },
        })
          .then(async (upstream) => {
            res.statusCode = upstream.status;
            res.setHeader(
              'content-type',
              upstream.headers.get('content-type') ?? 'text/html; charset=utf-8',
            );
            res.end(await upstream.text());
          })
          .catch(() => next());
      };
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), ogPreviewPlugin()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: `http://${serverHost}:3001`, changeOrigin: true },
      '/ws': { target: `ws://${serverHost}:3001`, ws: true },
      // Same routing nginx does in prod: robots + sitemap are server-rendered.
      '/robots.txt': {
        target: `http://${serverHost}:3001`,
        rewrite: () => '/api/v1/og/robots.txt',
      },
      '/sitemap.xml': {
        target: `http://${serverHost}:3001`,
        rewrite: () => '/api/v1/og/sitemap.xml',
      },
    },
    allowedHosts: ['trmission.robothanzo.dev', 'localhost'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
