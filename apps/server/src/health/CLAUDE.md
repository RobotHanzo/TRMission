# CLAUDE.md

`src/health/` serves the unauthenticated, deployment-shaped endpoints: liveness/readiness, the mobile
forced-update gate, and the deep-link association files.

- `GET /version/mobile` publishes the **forced-update floor** `MOBILE_MIN_BUILD`; builds below it are
  told to update. It is independent of OTA (`apps/mobile` still runs it every boot).
- `well-known.controller.ts` serves `/.well-known/apple-app-site-association` and
  `assetlinks.json` from `APPLE_APP_ID` + `ANDROID_PACKAGE_NAME` + `ANDROID_CERT_SHA256`, scoping the
  `/room/*` Universal/App Link so a shared room URL opens straight into the app. **Unset ⇒ 404.**

The mobile OAuth round trip does **NOT** use these files — it completes via a `trmission://`
custom-scheme redirect, since ASWebAuthenticationSession/Custom Tabs only honor a scheme match
mid-session, never Associated Domains (`AuthConfig.mobileCallback`, `src/auth/CLAUDE.md`).
