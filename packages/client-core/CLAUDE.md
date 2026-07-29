# CLAUDE.md

`@trm/client-core` is the **shared headless client core** for `apps/web` and `apps/mobile`:
logic, stores, net contracts, tutorial curriculum, i18n bundles, and design tokens written ONCE
and imported by both apps. Rendering stays platform-native (DOM/SVG on web, RN/Skia on mobile) —
this package must NEVER import `react-dom`, `react-native`, or any `expo-*`/DOM/native module.
`react`, `zustand`, `i18next`, `react-i18next` are **peerDependencies** (each app provides its
own copy; keep the version ranges aligned across `apps/web`, `apps/mobile`, and this package).

Layout mirrors the app-side `src/` folders it was extracted from (`net/`, `game/`, `store/`,
`sound/`, `tutorial/`, `i18n/`, `theme/`). Platform differences are injected through small adapter
interfaces (e.g. the REST client's token persistence + base-URL config), never `Platform.OS`
checks — this package has no platform APIs to check.

`assets/` is the exception to "headless":

- `assets/sounds/*.mp3` — the shared **SFX** (one copy for both clients, exported via the
  `./assets/*` subpath) that `src/sound/cues.ts` names. Each app binds those file names to its own
  asset reference — a Vite-emitted URL on web, a Metro asset id on mobile — and implements the
  `SoundPlayer` contract (Web Audio vs expo-audio); the cue table, event→cue model, `useSoundDriver`
  and `useSoundSetup` are all shared. Adding a cue means dropping the mp3 here, adding a `CUES` row,
  and adding one asset import per app.
- `assets/art/` — the authored **rolling-stock sheets** (`台鐵任務-車廂.svg` + `610.svg`). These are
  build-time input, never shipped: `tools/trainCarArt.mjs` compiles them into `src/art/trainCars.ts`.

## `src/art/trainCars.ts` — generated, do not hand-edit

The nine train-car illustrations both clients render. Regenerate with
`node packages/client-core/tools/trainCarArt.mjs` after touching `assets/art/` or the generator;
`--svg-dir docs/demos/train-cards/art` also refreshes the design-record demo.

Two constraints shape the generated form, and both exist so ONE body serves DOM and native:

- **No CSS.** The sheets style everything through `.cls-N` rules, which react-native-svg cannot
  apply, so the generator resolves them into presentation attributes. A `<style>` block or a
  `class=` reaching this module means blank cards on mobile — `test/trainCars.spec.ts` asserts
  neither appears.
- **No literal colours.** Every ink is a `$n` placeholder into a per-car palette, so the dark-mode
  night livery is `trainCarArt(color, dark)` — a palette swap in plain TS — rather than a media
  query. Each client passes its own answer to "is the app dark?" (`isDarkTheme` in `theme/tokens`).

Def ids are prefixed `trm-<car>-`; Illustrator's decorative layer ids are stripped, because a hand
holding two of a colour mounts the same body twice and ids must stay unique in the document.

Why each vehicle is inked the way it is — the crop measurements, the dimmed-not-repainted ramp, and
the open wagon's inversion — is documented in the generator and in `docs/demos/train-cards/`.

Rules:

- Pure TS-source exports, no build step (same as `@trm/shared`); consumed directly by Vite,
  Metro, vitest, and jest-expo.
- Anything moved here comes out of BOTH apps in the same change — no lingering duplicate copies;
  a module move that breaks either app's suite doesn't land.
- Tests are vitest (`test/` or `*.spec.ts`); anything needing a DOM or native runtime belongs to
  the consuming app's suite instead.
