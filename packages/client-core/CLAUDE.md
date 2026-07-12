# CLAUDE.md

`@trm/client-core` is the **shared headless client core** for `apps/web` and `apps/mobile`:
logic, stores, net contracts, tutorial curriculum, i18n bundles, and design tokens written ONCE
and imported by both apps. Rendering stays platform-native (DOM/SVG on web, RN/Skia on mobile) —
this package must NEVER import `react-dom`, `react-native`, or any `expo-*`/DOM/native module.
`react`, `zustand`, `i18next`, `react-i18next` are **peerDependencies** (each app provides its
own copy; keep the version ranges aligned across `apps/web`, `apps/mobile`, and this package).

Layout mirrors the app-side `src/` folders it was extracted from (`net/`, `game/`, `store/`,
`tutorial/`, `i18n/`, `theme/`). Platform differences are injected through small adapter
interfaces (e.g. the REST client's token persistence + base-URL config), never `Platform.OS`
checks — this package has no platform APIs to check.

Rules:

- Pure TS-source exports, no build step (same as `@trm/shared`); consumed directly by Vite,
  Metro, vitest, and jest-expo.
- Anything moved here comes out of BOTH apps in the same change — no lingering duplicate copies;
  a module move that breaks either app's suite doesn't land.
- Tests are vitest (`test/` or `*.spec.ts`); anything needing a DOM or native runtime belongs to
  the consuming app's suite instead.
