import { defineConfig } from 'vitest/config';
import type { Connect, Plugin, PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Source-map upload for readable Sentry stack traces. Entirely opt-in: without SENTRY_AUTH_TOKEN
// (a build-machine secret — never an import.meta.env key, which would ship it in the bundle) the
// plugin is not installed and the build is byte-for-byte what it was before Sentry existed.
// Maps are generated only for the upload and deleted afterwards, so they are never served publicly.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN ?? '';
const uploadSourceMaps = sentryAuthToken !== '';
const sentryPlugins = (): PluginOption[] =>
  uploadSourceMaps
    ? [
        sentryVitePlugin({
          authToken: sentryAuthToken,
          // Omitted rather than undefined: sentry-cli falls back to its own SENTRY_ORG lookup.
          ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
          project: process.env.SENTRY_PROJECT ?? 'trmission-web',
          // Must match `release` in src/observability/sentry.ts, or the maps bind to nothing.
          release: { name: process.env.VITE_COMMIT_HASH ?? 'dev' },
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          telemetry: false,
        }),
      ]
    : [];

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
  plugins: [react(), ogPreviewPlugin(), ...sentryPlugins()],
  build: {
    sourcemap: uploadSourceMaps ? 'hidden' : false,
    rollupOptions: {
      output: {
        // Split the big, stable third-party libs out of the app chunk so they cache across
        // app deploys and download in parallel with it. Internal @trm/* packages ship TS
        // source (not node_modules), so they intentionally stay with the app code — the
        // heavy map-data/engine geometry is on the landing critical path anyway.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Session Replay's recorder is the single biggest piece of the Sentry SDK and is reached
          // ONLY through the lazily-imported src/observability/replay.ts. Leave it unassigned so
          // Rollup keeps it in that async chunk — naming a chunk here would hoist it back onto the
          // landing critical path, which is what this rule set exists to prevent.
          if (/[\\/]@sentry[\\/]replay(-canvas)?[\\/]/.test(id)) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/.test(id)) return 'i18n';
          if (id.includes('@bufbuild')) return 'protobuf';
          // The rest of the Sentry SDK changes on its own release cadence — its own chunk so it
          // caches across app deploys instead of invalidating them.
          if (id.includes('@sentry')) return 'sentry';
          return 'vendor';
        },
      },
    },
  },
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
