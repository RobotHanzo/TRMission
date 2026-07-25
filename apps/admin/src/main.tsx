import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles/tokens.css';
import './styles/admin.css';
// Kicks off the Sentry load before the app renders. The façade holds no `@sentry/*` import: with
// no VITE_SENTRY_DSN the SDK chunk is never fetched at all — see observability/report.ts.
import { initSentry } from './observability/report';
import { AdminErrorBoundary } from './components/AdminErrorBoundary';
import App from './App';

initSentry();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminErrorBoundary>
      <App />
    </AdminErrorBoundary>
  </StrictMode>,
);
