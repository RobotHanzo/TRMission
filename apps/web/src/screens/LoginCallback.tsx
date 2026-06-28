import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';
import { useUi, readRedirectParam } from '../store/ui';
import { MapBackdrop } from '../components/MapBackdrop';

/**
 * The landing page after an OAuth round-trip. The server has already set the refresh cookie and
 * redirected here; App's `restore()` has run (booting is settled by the time this mounts), so the
 * session is either resolved (→ resume the target) or it failed (show the error + a way back).
 */
export function LoginCallback() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const navigateAfterAuth = useUi((s) => s.navigateAfterAuth);
  const navigateLogin = useUi((s) => s.navigateLogin);
  const errorCode = new URLSearchParams(window.location.search).get('error');

  // Only resume on a CLEAN success. With an ?error= present we must NOT auto-navigate even if a
  // (guest) session still resolves — otherwise the failure is silently swallowed and the user who
  // explicitly tried to link gets no feedback.
  useEffect(() => {
    if (user && !errorCode) navigateAfterAuth();
  }, [user, errorCode, navigateAfterAuth]);

  return (
    <div className="login-screen">
      <MapBackdrop />
      <div className="login-scrim" aria-hidden />
      <div className="login-card card stack">
        <div className="login-head">
          <h1>{t('appName')}</h1>
        </div>
        {user && !errorCode ? (
          <p className="muted">{t('signingIn')}</p>
        ) : (
          <>
            <p className="error">{t('oauthError')}</p>
            {errorCode && <p className="muted">{errorCode}</p>}
            {/* Preserve the original ?redirect= so a retry resumes where they were headed. */}
            <button className="primary" onClick={() => navigateLogin(readRedirectParam())}>
              {t('backToLogin')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
