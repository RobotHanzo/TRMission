# Ads (`apps/mobile/src/ads/`)

App-wide context: `apps/mobile/CLAUDE.md`. Google AdMob via `react-native-google-mobile-ads`
(issue #50). The mobile twin of `apps/web`'s AdSense surface (`config/adsense.ts` +
`components/AdSlot.tsx`); placement research and the owner's privacy decision live in
`docs/plans/2026-07-25-mobile-admob.md`.

## Where ads may and may not go

Only two placements exist, and the list is a policy boundary, not a backlog:

- **`AdBanner`** — anchored adaptive banner, docked at the bottom of the four **browse** surfaces:
  Home (lobby), the Encyclopedia **contents** page, Leaderboard, History.
- **`interstitial.ts`** — one full-screen ad when a **finished** offline vs-bots game is left.

Never on the live game, the room lobby, the tutorial, the Encyclopedia _player_, replay, boot/login,
or the first-entry welcome takeover. AdMob forbids ads that interfere with navigation or core content, and
banners beside interactive controls; the interstitial rules also forbid app-load/exit placement and
back-to-back ads. **Adding a placement means re-reading those rules, not copying an existing call.**

The banner is a **flow footer**, not an overlay — Home's create/join controls sit at the end of that
column and an overlay on top of them is the accidental-click shape the guidance rules out. It also
self-hides on an unfocused tab: native bottom tabs keep every tab mounted, so four live banner
requests would otherwise run at once.

## Config is checked in, not env

`app.config.ts`'s `ADMOB` block holds the master switch, the app ids and the unit ids as
**literals**, surfaced to the runtime through `extra` (→ `src/config.ts`). Not env vars:
config-plugin props feed the OTA **runtimeVersion fingerprint**, so an env-derived app id would give
the OTA lane a different fingerprint from the store lanes — the same lockstep trap as `TRM_SENTRY_*`
and the Google client ids. `enabled` is the master switch.

**Unit ids are per-platform (`{ android, ios }`), and that is not optional.** An ad unit belongs to
exactly one AdMob _app_, and the Android and iOS entries are separate AdMob apps — an Android unit
id does not exist inside the iOS app, so requesting it there never fills. Every placement therefore
has to be created twice in the console. Both ids ship in both binaries (they are public); `adUnitId`
picks by `Platform.OS`. A blank id for one platform just means that placement renders nothing there.

`adUnitId()` returns Google's `TestIds` under `__DEV__` **regardless** of what is checked in:
clicking a live ad on your own inventory is invalid traffic that can suspend the account.

The publisher id inside those literals is also what `apps/web/public/app-ads.txt` authorises — AdMob
will not serve this app's inventory until it has crawled that file off the store listing's developer
website. Changing AdMob accounts means changing both; `docs/release/admob-app-ads-txt.md` is the
runbook and `apps/web/src/config/appAdsTxt.test.ts` fails the build if the two drift.

## The version pin, and what shipping ads declared

`react-native-google-mobile-ads` is **pinned exact to 16.3.4** and the pin is load-bearing: 16.4.0
bumps the native SDK to play-services-ads 25.4.0, whose Kotlin metadata is 2.3.0 and cannot be read
by the Kotlin the Expo SDK's Android toolchain runs (`:react-native-google-mobile-ads:`
`compileReleaseKotlin` fails). Bumping `kotlinVersion` instead breaks other autolinked modules
(upstream invertase#863), so keep the caret off until Expo's own Kotlin catches up.

**Still true on Expo SDK 57 / RN 0.86.** A Dependabot batch (`5a26925`, merged in `06841cd`) moved
the pin to 16.4.0 and the Android release lane failed with exactly this error — the expected Kotlin
metadata version was 2.1.0, unchanged from the SDK 56 finding above. The pin is now enforced a
second time, in `.github/dependabot.yml`'s `ignore` list, so a grouped batch cannot quietly lift it
again; re-test it only when the SDK's own Kotlin moves.

**Adding the plugin changed the OTA fingerprint** — the first OTA after it landed needed a fresh
native build on both stores.

AdMob is also what unblocked Android's `AD_ID` permission and put Device ID (flagged as tracking)
in the iOS privacy manifest — while the manifest's top-level `NSPrivacyTracking` stays **false**
with no tracking domains, mirroring the Mobile Ads SDK's own manifest. That pairing is
load-bearing: read the comment in `app.config.ts` before touching either key (ITMS-91064).

## Bring-up order (`ads.ts`)

`initAds()` runs UMP consent → ATT → `mobileAds().initialize()`, in that order, and only initialises
when `canRequestAds`. Every step swallows its own failure: a UMP outage or a denied prompt must
degrade to "no ads", never to a broken app. Called from **`App.tsx` once booting flips false** — not
from `index.ts` like Sentry, because the consent form and the ATT prompt are native modals and Apple
requires the app foregrounded and visible before ATT is requested.

`useAds().privacyOptionsRequired` drives `screens/settings/AdPrivacyRow` — it renders nothing where
UMP requires no form (`showPrivacyOptionsForm()` would just fail there).

## Opt-out parity with web

`useAdsVisible` honours `hideAds` (per-device, `store/ui.ts`) **only** for accounts holding the
`adFree` feature — identical anti-bypass rule to web's `AdSlot`, so a stored flag alone can never
suppress ads. The Settings switch is gated on the same feature.

## Native-module gate

`googleMobileAds.ts` is `null` on the react-native-web harness and under Expo Go (a third-party
native module is never bundled there), so every surface renders nothing and every helper no-ops —
same shape as `../push/expoNotifications.ts`. Backed by `__mocks__/react-native-google-mobile-ads.js`
and `__mocks__/expo-tracking-transparency.js`.

Unlike the push gate, web needs a real **file split** (`googleMobileAds.web.ts`) on top of the
runtime `Platform.OS` branch. Metro resolves the `require('react-native-google-mobile-ads')` inside
that branch even for a web bundle, and the package imports `react-native/Libraries/…` internals that
Expo's web resolver rejects outright — so without the split the whole harness bundle fails to build.

## Gotcha

`showInterstitial()` reads its persisted cap **before** registering ad listeners, so a test that
emits `CLOSED` immediately after calling it lands before anything is listening and passes only via
the 5s show-timeout. Wait for `show()` first (`untilShown` in `interstitial.test.ts`).
