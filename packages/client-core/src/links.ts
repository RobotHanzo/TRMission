// External destinations shared by both clients. Vanity URLs redirect server-side, so the
// underlying invite/target can rotate without touching client code.
export const DISCORD_URL = 'https://trmission.robothanzo.dev/discord';

/** The iOS app's store page, behind the same kind of vanity redirect (nginx `location = /ios`) —
 *  so the storefront, the app id, or a future regional variant can change without a client deploy.
 *  Absolute, like the Discord one: a shared link has to work off-origin too. */
export const APP_STORE_URL = 'https://trmission.robothanzo.dev/ios';

/** The public help page (issue #80) — a page of the web app, and the URL registered as the App
 *  Store / Play support URL. Mobile opens it on the configured server origin, like the legal docs. */
export const SUPPORT_PATH = '/support';

/** The monitored mailbox printed on the support and legal pages — the fallback whenever the
 *  in-page form is unavailable. */
export const SUPPORT_EMAIL = 'trmission@robothanzo.dev';
