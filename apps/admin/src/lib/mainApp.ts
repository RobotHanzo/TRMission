// Where the main game app lives. Same origin in prod (nginx serves both apps under
// one domain — see apps/web/nginx.conf); dev runs the two Vite servers on different
// ports, so a plain relative redirect from :5174 would hit admin's own dev server
// instead of :5173 — VITE_WEB_ORIGIN lets that be pointed explicitly.
const DEV_WEB_ORIGIN = import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:5173';
/** The main app's own origin — empty string in prod (same-origin), the dev Vite port otherwise.
 *  Anything that hard-navigates or opens a tab into apps/web's routes (login, admin-replay) must
 *  build its URL off this, never `window.location.origin` — that's wherever *this* app happens to
 *  be running (admin's own :5174 in dev), which would hit admin's dev server instead of web's. */
export const webOrigin = (): string => (import.meta.env.DEV ? DEV_WEB_ORIGIN : '');

/** The main app's login URL, remembering the admin path to resume after sign-in. */
export const mainLoginUrl = (returnTo: string): string =>
  `${webOrigin()}/login?redirect=${encodeURIComponent(returnTo)}`;

/** Hard-navigate away to the main app's login — admin has no login dialog of its own. */
export const goToMainLogin = (returnTo: string): void => {
  window.location.href = mainLoginUrl(returnTo);
};
