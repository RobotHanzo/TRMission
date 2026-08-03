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
  build-time input, never shipped: `tools/trainCarArt.mjs` compiles them into
  `src/art/skins/rollingStock.ts`.

## `src/art/` — the train-card skin packs

A skin is purely cosmetic: it swaps the artwork on a train-car card and nothing else. The id
taxonomy is `@trm/shared`'s `TRAIN_CAR_SKINS` (server, admin and both clients agree on it there);
this package owns the artwork each id resolves to.

- `types.ts` — `TrainCarArtwork`/`TrainCarArtSet`, the shape EVERY pack emits.
- `skins/rollingStock.ts` — **generated, do not hand-edit.** The default pack: the nine authored
  side elevations. Regenerate with `node packages/client-core/tools/trainCarArt.mjs` after
  touching `assets/art/` or the generator; `--svg-dir docs/demos/train-cards/art` also refreshes
  the design-record demo.
- `skins/classic.ts` — the original hand-drawn carriage + steam locomotive that `rollingStock`
  replaced in c7f0a8c, kept as a pack. Hand-written because the artwork IS its colour arithmetic.
- `trainCars.ts` — the registry + `trainCarArt(color, dark, skin)` / `trainCarSvg(...)`. Both
  clients render through this and nothing else.

Two constraints shape every pack, and both exist so ONE body serves DOM and native:

- **No CSS.** The sheets style everything through `.cls-N` rules, which react-native-svg cannot
  apply, so the generator resolves them into presentation attributes. A `<style>` block or a
  `class=` reaching a pack means blank cards on mobile — `test/trainCars.spec.ts` asserts neither
  appears, for every registered pack.
- **No literal colours.** Every ink is a `$n` placeholder into a per-car palette, so the dark-mode
  night livery is `trainCarArt(color, dark, skin)` — a palette swap in plain TS — rather than a
  media query. Each client passes its own answer to "is the app dark?" (`isDarkTheme` in
  `theme/tokens`). A pack with no night variant sets `paletteDark` to the same palette;
  translucency is `fill-opacity`, never an `rgba()` ink (it could not survive a palette swap).

Def ids are prefixed `trm-`; Illustrator's decorative layer ids are stripped, because a hand
holding two of a colour mounts the same body twice and ids must stay unique in the document.

**Adding a pack** is one entry in `@trm/shared`'s `TRAIN_CAR_SKINS`/`TRAIN_CAR_SKIN_META`, one
module under `skins/`, one line in the registry — plus each client's art-band geometry for it
(`.rs-skin-*` in web's `game.css`, `ART_BAND` in mobile's `TrainCarCard`), since packs are drawn
to different proportions and that inset is presentation. It then ships ENABLED: availability is
stored server-side as the disabled complement (`apps/server/src/skins/`).

Which pack a viewer actually gets is `game/trainCarSkins.ts` — `resolveTrainCarSkin(preference,
enabledSkinIds)`, which falls back to the default for a pack this build does not bundle or a
maintainer has switched off. Note the asymmetry with official maps, and it is deliberate: a
switched-off skin is NOT rejected on the preferences PATCH, because preferences save as one blob
and 400-ing the skin field would block that account from changing its theme or language.

Why each vehicle is inked the way it is — the crop measurements, the dimmed-not-repainted ramp, and
the open wagon's inversion — is documented in the generator and in `docs/demos/train-cards/`.

Rules:

- Pure TS-source exports, no build step (same as `@trm/shared`); consumed directly by Vite,
  Metro, vitest, and jest-expo.
- Anything moved here comes out of BOTH apps in the same change — no lingering duplicate copies;
  a module move that breaks either app's suite doesn't land.
- Tests are vitest (`test/` or `*.spec.ts`); anything needing a DOM or native runtime belongs to
  the consuming app's suite instead.
