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
or the Home welcome takeover. AdMob forbids ads that interfere with navigation or core content, and
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

## Gotcha

`showInterstitial()` reads its persisted cap **before** registering ad listeners, so a test that
emits `CLOSED` immediately after calling it lands before anything is listening and passes only via
the 5s show-timeout. Wait for `show()` first (`untilShown` in `interstitial.test.ts`).
