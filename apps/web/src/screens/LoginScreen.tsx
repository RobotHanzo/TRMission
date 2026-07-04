import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session';
import { useUi, readRedirectParam } from '../store/ui';
import { api, type AuthConfig, type OauthProvider } from '../net/rest';
import { MapBackdrop } from '../components/MapBackdrop';
import { loadGoogleIdentityServices, googleLocale } from '../net/google';

type AuthMode = 'guest' | 'login' | 'register';

/** Provider start URL, forwarding the current post-login target so OAuth resumes it too. */
const oauthStartUrl = (provider: OauthProvider): string =>
  `/api/v1/auth/oauth/${provider}/start?redirect=${encodeURIComponent(readRedirectParam())}`;

/** Google's multi-colour "G" mark (brand icons aren't in Lucide). */
const GoogleIcon = () => (
  <svg className="oauth-icon" viewBox="0 0 48 48" width="18" height="18" aria-hidden focusable="false">
    <path
      fill="#4285F4"
      d="M47.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h13.2c-.6 3-2.3 5.6-4.9 7.3v6h7.9c4.6-4.3 7.3-10.5 7.3-17.3z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.5 0 11.9-2.2 15.9-5.8l-7.9-6c-2.2 1.5-5 2.3-8 2.3-6.2 0-11.4-4.2-13.3-9.8h-8.1v6.2C4.6 42.6 13.6 48 24 48z"
    />
    <path
      fill="#FBBC05"
      d="M10.7 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7v-6.2h-8.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.9l8.1-6.2z"
    />
    <path
      fill="#EA4335"
      d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.5 0 24 0 13.6 0 4.6 5.4 2.6 13.1l8.1 6.2C12.6 13.7 17.8 9.5 24 9.5z"
    />
  </svg>
);

/** Discord wordmark glyph; inherits the button's text colour. */
const DiscordIcon = () => (
  <svg className="oauth-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden focusable="false">
    <path d="M20.317 4.369A19.79 19.79 0 0 0 15.432 3a13.7 13.7 0 0 0-.617 1.27 18.27 18.27 0 0 0-5.631 0A13.6 13.6 0 0 0 8.567 3 19.74 19.74 0 0 0 3.677 4.37C.533 9.046-.32 13.605.106 18.1a19.9 19.9 0 0 0 6.073 3.058c.49-.668.927-1.377 1.302-2.122a12.9 12.9 0 0 1-2.05-.984c.172-.126.34-.257.502-.392a14.2 14.2 0 0 0 12.135 0c.164.14.332.27.502.392-.654.388-1.343.718-2.053.985.375.744.81 1.453 1.3 2.12a19.84 19.84 0 0 0 6.075-3.057c.5-5.21-.838-9.728-3.55-13.732zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.955 2.42-2.157 2.42zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.946 2.42-2.157 2.42z" />
  </svg>
);

export function LoginScreen() {
  const { t, i18n } = useTranslation();
  const loading = useSession((s) => s.loading);
  const error = useSession((s) => s.error);
  const clearError = useSession((s) => s.clearError);
  const user = useSession((s) => s.user);
  const playAsGuest = useSession((s) => s.playAsGuest);
  const login = useSession((s) => s.login);
  const register = useSession((s) => s.register);
  const loginWithGoogleCredential = useSession((s) => s.loginWithGoogleCredential);
  const navigateAfterAuth = useUi((s) => s.navigateAfterAuth);

  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [googleWidget, setGoogleWidget] = useState<'pending' | 'ready' | 'failed'>('pending');
  const googleButtonRef = useRef<HTMLDivElement>(null);

  // Resume the intended destination the moment a sign-in lands (guest/password here; OAuth via the
  // callback screen). This effect only runs while the login screen is mounted, i.e. while signed out.
  useEffect(() => {
    if (user) navigateAfterAuth();
  }, [user, navigateAfterAuth]);

  // Ask the server which methods are enabled and seed the default tab.
  useEffect(() => {
    let live = true;
    void api
      .config()
      .then((c) => {
        if (!live) return;
        setConfig(c);
        setMode(c.guest ? 'guest' : c.passwordLogin ? 'login' : null);
      })
      .catch(() => live && setConfig({ passwordLogin: true, guest: true, providers: { google: false, discord: false } }));
    return () => {
      live = false;
    };
  }, []);

  // Load Google Identity Services once we know the client id, render its own button, and fire
  // One Tap. Falls back to the legacy redirect anchor if the script can't load (blocked, offline).
  useEffect(() => {
    const clientId = config?.googleClientId;
    if (!config?.providers.google || !clientId) return;
    let live = true;
    void loadGoogleIdentityServices()
      .then((accounts) => {
        if (!live) return;
        accounts.initialize({
          client_id: clientId,
          callback: (resp) => void loginWithGoogleCredential(resp.credential),
          use_fedcm_for_prompt: true,
        });
        if (googleButtonRef.current) {
          accounts.renderButton(googleButtonRef.current, {
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            locale: googleLocale(i18n.language),
          });
        }
        accounts.prompt();
        setGoogleWidget('ready');
      })
      .catch(() => {
        if (live) setGoogleWidget('failed');
      });
    return () => {
      live = false;
    };
  }, [config?.providers.google, config?.googleClientId, i18n.language, loginWithGoogleCredential]);

  const pick = (m: AuthMode) => {
    clearError();
    setMode(m);
  };

  const modes: AuthMode[] = config
    ? [...(config.guest ? (['guest'] as const) : []), ...(config.passwordLogin ? (['login', 'register'] as const) : [])]
    : [];
  const hasOauth = !!config && (config.providers.google || config.providers.discord);
  const nothingEnabled = !!config && modes.length === 0 && !hasOauth;

  return (
    <div className="login-screen">
      <MapBackdrop />
      <div className="login-scrim" aria-hidden />
      <div className="login-card card stack">
        <div className="login-head">
          <h1>{t('appName')}</h1>
          <p className="muted">{t('tagline')}</p>
        </div>

        {!config && <p className="muted">{t('connecting')}</p>}
        {nothingEnabled && <p className="error">{t('authUnavailable')}</p>}

        {modes.length > 1 && (
          <div className="tabs" role="tablist">
            {modes.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                className={mode === m ? 'tab active' : 'tab'}
                onClick={() => pick(m)}
              >
                {t(m === 'guest' ? 'guest' : m === 'login' ? 'signIn' : 'signUp')}
              </button>
            ))}
          </div>
        )}

        {mode === 'guest' && (
          <div className="stack">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('guestName')}
              maxLength={24}
            />
            <button className="primary" disabled={loading} onClick={() => void playAsGuest(name)}>
              {t('playAsGuest')}
            </button>
          </div>
        )}

        {mode === 'register' && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('guestName')}
            maxLength={24}
            autoComplete="nickname"
          />
        )}

        {(mode === 'login' || mode === 'register') && (
          <div className="stack">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('email')}
              autoComplete="email"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            <button
              className="primary"
              disabled={loading || !email || password.length < 8}
              onClick={() =>
                void (mode === 'login' ? login(email, password) : register(email, password, name))
              }
            >
              {t(mode === 'login' ? 'signIn' : 'signUp')}
            </button>
          </div>
        )}

        {hasOauth && (
          <>
            {modes.length > 0 && <div className="oauth-divider">{t('orContinueWith')}</div>}
            <div className="stack">
              {config!.providers.google && (
                <>
                  <div
                    className="oauth-google-btn"
                    data-testid="google-signin-button"
                    ref={googleButtonRef}
                    hidden={googleWidget !== 'ready'}
                  />
                  {googleWidget !== 'ready' && (
                    <a className="oauth-btn oauth-google" href={oauthStartUrl('google')}>
                      <GoogleIcon />
                      {t('continueWithGoogle')}
                    </a>
                  )}
                </>
              )}
              {config!.providers.discord && (
                <a className="oauth-btn oauth-discord" href={oauthStartUrl('discord')}>
                  <DiscordIcon />
                  {t('continueWithDiscord')}
                </a>
              )}
            </div>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
