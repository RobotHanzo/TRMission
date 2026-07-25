# Mobile ads: placement research + AdMob wiring (issue #50)

`apps/web` already monetises with AdSense (`config/adsense.ts`, `components/AdSlot.tsx`, the
`adFree` account feature + `hideAds` opt-out). This brings `apps/mobile` onto the same footing with
Google AdMob, and replaces the app config's stale "no ads/analytics anywhere" posture.

## Placement research

Google's rules that actually constrain us
([banner](https://support.google.com/admob/answer/6128877),
[interstitial](https://support.google.com/admob/answer/6066980),
[disallowed](https://support.google.com/admob/answer/6201362)):

- Banners may not sit next to interactive controls, nor on a screen the user continuously interacts
  with (i.e. never on a game board).
- Interstitials belong at natural transition points — between levels/stages — never on app
  load or exit, never twice in a row, and no more than one per two user actions.
- An interstitial between stages should fire on the explicit Continue/Next tap, after a beat, so a
  tapping user isn't ambushed.

Mapped onto this app:

| Surface                                                                                     | Ad                       | Why                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home (lobby), Encyclopedia index, Leaderboard, History                                      | anchored adaptive banner | Static browse surfaces; the banner docks below the content flow, so it is never adjacent to the join/create controls.                                |
| Offline (vs-bots) game → GAME_OVER → leave                                                  | interstitial             | The one real "end of a stage" break in the app. Fires on the explicit Play-again / Back-home tap, preloaded at GAME_OVER.                            |
| Live online game, Room lobby, Tutorial, Encyclopedia _player_, Replay, Boot/Login, Settings | none                     | Gameplay, onboarding, or interactive sandbox demos — ads there interfere with core functionality. Room + online game also carry other players' time. |

Not built: **rewarded ads** (there is no cosmetic/currency/hint economy to reward into, and
inventing one on spec is not warranted) and **app-open ads** (they collide with the boot chain's
forced-update gate and room deep-link stash, and are the placement users hate most).

Frequency caps on the interstitial, in `ads/interstitial.ts`: never on a device's **first** finished
offline game, then at most one per 3 minutes. Never blocks navigation — if nothing is preloaded the
tap proceeds immediately.

## Privacy posture (owner decision, 2026-07-25)

**Personalized ads with ATT.** Consequences, all landed here:

- `android.blockedPermissions` no longer blocks `com.google.android.gms.permission.AD_ID`.
- `NSPrivacyTracking: true`; `expo-tracking-transparency` requests ATT after the UMP form.
- `NSPrivacyTrackingDomains` stays **empty on purpose**. iOS blocks connections to domains listed
  there when ATT is denied, and the Google Mobile Ads SDK already ships its own privacy manifest
  declaring its tracking domains correctly. Duplicating them here would kill ad fill for every
  ATT-denied user.
- Both stores' privacy declarations change (docs/release/{play-console,app-store-connect}-setup.md)
  and the privacy policy gains a mobile-ads paragraph (`apps/web/src/screens/PrivacyScreen.tsx`).

`MaxAdContentRating.G` — the app rates Everyone / PEGI 3. `ageRestrictedTreatment` stays unset: the
app is general-audience, not primarily child-directed, and CHILD is a legal certification.

## Config lives in the repo, not in env

`src/config/admob.ts` is checked-in static config, exactly like web's `config/adsense.ts` — app ids
and unit ids are not secret (they ship inside the binary regardless). This also sidesteps the trap
that bit Sentry and the Google client ids: **config-plugin props feed the OTA runtimeVersion
fingerprint**, so env-derived ids would make the fingerprint depend on which lane evaluated
`app.config.ts`. Static constants are identical on every lane by construction.

`enabled: false` is the master switch and ships off until an AdMob account exists; the checked-in app
ids are Google's documented sample ids until then. `__DEV__` builds always substitute `TestIds`, so
a developer can never click a live ad.

## Shape

```
src/config/admob.ts     static config (master switch, app ids, per-placement unit ids)
src/ads/googleMobileAds.ts  lazy native-module gate (null on web harness / Expo Go)
src/ads/ads.ts          UMP consent → ATT → mobileAds().initialize(); useAds() store
src/ads/AdBanner.tsx    the one banner component (focus-gated, adFree-aware)
src/ads/interstitial.ts preload + capped show
```

Opt-out parity with web: an account holding the `adFree` feature gets a Settings switch
(`hideAds`, per-device) that suppresses every placement. A `hideAds` flag without the feature does
nothing — same anti-bypass rule as `AdSlot`.

## Verification

`yarn workspace @trm/mobile typecheck | lint | test`, plus `npx expo config --type public` to prove
`app.config.ts` still evaluates (the plugin, privacy manifest and SKAdNetwork list are only
exercised there). Real fill needs an AdMob account; the device smoke is the acceptance bar.

**Native rebuild required.** Adding the plugin changes the OTA runtimeVersion fingerprint — the
first OTA after this lands needs a fresh store build on both platforms first (docs/mobile/ota.md).
