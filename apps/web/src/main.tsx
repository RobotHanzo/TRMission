import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import './i18n';
// Kicks off the Sentry load before the app renders. The façade holds no `@sentry/*` import: with
// no VITE_SENTRY_DSN the SDK chunk is never fetched at all — see observability/report.ts.
import { initSentry } from './observability/report';
import { installPreloadRecovery } from './lib/preloadRecovery';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { App } from './App';

initSentry();
// Before any lazy route can be reached, so a tab left open across a redeploy recovers instead of
// crashing on a chunk hash that no longer exists.
installPreloadRecovery();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');
createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
