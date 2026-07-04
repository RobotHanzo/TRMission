// Loads Google Identity Services (GSI) once per page and exposes the narrow `accounts.id` surface
// LoginScreen needs for One Tap + the rendered sign-in button.

interface GoogleCredentialResponse {
  credential: string;
}
interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  use_fedcm_for_prompt?: boolean;
}
interface GoogleButtonOptions {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  locale?: string;
}
export interface GoogleAccountsId {
  initialize(config: GoogleIdConfiguration): void;
  prompt(): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 3000;

let loadPromise: Promise<GoogleAccountsId> | null = null;

/**
 * Injects the GSI script once (module-level singleton — safe to call from multiple mounts) and
 * resolves with `window.google.accounts.id`. Rejects on a load error or a ~3s timeout (some
 * ad-blockers/extensions silently no-op the request instead of firing `onerror`), so callers can
 * always fall back to the legacy redirect button rather than hang.
 */
export function loadGoogleIdentityServices(): Promise<GoogleAccountsId> {
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      const timer = setTimeout(() => {
        reject(new Error('google identity services load timed out'));
      }, LOAD_TIMEOUT_MS);
      script.onload = () => {
        clearTimeout(timer);
        if (window.google?.accounts?.id) resolve(window.google.accounts.id);
        else reject(new Error('google identity services script loaded without window.google'));
      };
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error('google identity services script failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return loadPromise;
}

/** Maps the app's locale to a GSI `data-locale`/`locale` option value. */
export const googleLocale = (locale: string): string => (locale === 'zh-Hant' ? 'zh-TW' : 'en');
