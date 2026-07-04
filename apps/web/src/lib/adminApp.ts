// Where the maintainer dashboard lives. Same origin in prod (nginx serves both apps
// under one domain — see apps/web/nginx.conf); dev runs the two Vite servers on
// different ports, so a plain relative redirect from :5173 would 404 instead of
// reaching admin's dev server — VITE_ADMIN_ORIGIN lets that be pointed explicitly.
const DEV_ADMIN_ORIGIN = import.meta.env.VITE_ADMIN_ORIGIN ?? 'http://localhost:5174';
const adminOrigin = (): string => (import.meta.env.DEV ? DEV_ADMIN_ORIGIN : '');

/** True for any `?redirect=` target that belongs to the admin panel, not this SPA. */
export const isAdminTarget = (target: string): boolean =>
  target === '/admin' || target.startsWith('/admin/');

/** Hard-navigate to the admin panel — it's a separate build, not a route this router owns. */
export const goToAdmin = (target: string): void => {
  window.location.href = `${adminOrigin()}${target}`;
};
