# Google Play Console setup

One-time human setup that `mobile-android.yml` depends on. Nothing here can be scripted — Play
requires a real developer account and the app's very first release to be uploaded through the
Console UI before its API will talk to the app at all. Do the steps in order; each one unblocks
the next.

Package name throughout: `dev.robothanzo.trmission` (`apps/mobile/app.config.ts`).

## 1. Developer account

1. Sign up at [play.google.com/console](https://play.google.com/console) with the Google account
   that should own the app long-term (not a personal throwaway — transferring ownership later is
   painful). One-time $25 registration fee.
2. Pick **Personal** or **Organization**. This choice has a real consequence (Step 8): a
   **personal** account is legally required to run a **closed test with ≥12 opted-in testers for
   14 consecutive days** before it can request production access for a first app; an
   **organization** account (needs a D-U-N-S number) is exempt. If TRMission will only ever have
   one or two accounts publishing, personal is fine — just budget the 14-day calendar time into
   the launch plan.
3. Complete identity verification (Play now requires it before you can publish anything).

## 2. Create the app

Play Console → **Create app**:

- App name: `TRMission 台鐵任務` (matches `fastlane/metadata/android/*/title.txt`)
- Default language: `zh-TW` (Traditional Chinese) — the zh-Hant set is the primary listing
  (`docs/superpowers/plans/2026-07-06-mobile-p6-release-compliance.md`, Task 9)
- App or game: **App**
- Free or paid: **Free**
- Accept the Play Console Developer Program Policies + US export laws declarations

This only creates a shell — the **Setup → App integrity / Store listing / Content rating / etc.**
checklist on the app's dashboard is what actually unlocks publishing. Work through it; Steps 3–4
below cover the parts that need real content instead of a checkbox.

## 3. Store listing, ratings, data safety

Everything the copy/data content should say is already spec'd in
`docs/superpowers/plans/2026-07-06-mobile-p6-release-compliance.md` Task 9 — use it verbatim
rather than improvising in the Console:

- **Main store listing**: title/short/full description come straight from
  `apps/mobile/fastlane/metadata/android/{zh-TW,en-US}/*.txt` (already committed — you can either
  type them in by hand once, or let `fastlane android metadata` push them once API access exists,
  Step 7). Screenshots per `docs/mobile/store-screenshots.md`.
- **Content rating (IARC questionnaire)**: declare **Users Interact** (chat) and **Shares
  User-Generated Content** (custom maps). Expected outcome: Everyone / PEGI 3 with an interaction
  disclosure.
- **Target audience**: not primarily designed for children; standard age range.
- **Data safety form**: use the exact table in Task 9 Step 4 (email, display name, avatar URL,
  user id, push token, game history, chat/UGC — nothing else, no ads/analytics/tracking SDKs).
  Deletion URL: `https://<production origin>/account/delete`.
- **Ads**: declare no ads. **Government app / COVID-19 app / financial features / news app**: all
  no.
- **EU DSA**: declare **non-trader** status.
- **Privacy policy URL**: `https://<production origin>/privacy`.
- Support email: a real monitored mailbox (this also has to replace the
  `PLACEHOLDER-SUPPORT-EMAIL` in `apps/web/src/screens/PrivacyScreen.tsx`, per Task 9 Step 5 — a
  separate small commit, not a Console step).

None of this blocks Step 4–8 below; the app can build/upload to internal testing with an
incomplete listing. It **does** block applying for production access (Step 8).

## 4. App signing

Play Console → **Setup → App signing**. New apps default to **Play App Signing**, which you want
(Google re-signs your upload with its own key for distribution; you keep signing the AAB with your
own **upload key**).

The upload keystore is the one already used by `mobile-android.yml`
(`ANDROID_KEYSTORE_BASE64`/`ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD`
secrets, provisioned in an earlier phase). If it doesn't exist yet:

```bash
keytool -genkeypair -v -keystore release.keystore -alias trmission -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore   # → ANDROID_KEYSTORE_BASE64 secret
```

Back up `release.keystore` + its passwords in the team password manager — losing it (before Play
App Signing is enrolled) permanently strands the app under this package name.

After the **first** upload (Step 5), record both SHA-256 fingerprints from **Setup → App
signing**: the **upload key** cert and the **app signing key** cert. The **app signing key**'s
SHA-256 is what production installs actually run with — it's what `ANDROID_CERT_SHA256`
(server env, feeds `.well-known/assetlinks.json` for Android App Links) must contain. This is a
launch-gate item already tracked in
`docs/superpowers/plans/2026-07-06-mobile-p6-release-compliance.md` Task 10 Step 2 / Task 11.

## 5. First manual upload (bootstraps the app — required, can't be skipped)

The Play Developer Publishing API refuses to touch an app that has never had a release uploaded
through the Console UI — `fastlane supply`/`upload_to_play_store` will fail with a "no
application was found" style error against a brand-new app. Do exactly one manual upload before
touching CI or the service account:

1. Build a signed AAB. **Prefer running `mobile-android.yml` once via workflow_dispatch** and
   downloading the `trmission-release-aab` artifact (`gh workflow run mobile-android.yml`, then
   `gh run download --name trmission-release-aab`) — this keeps the release keystore out of your
   local machine entirely.

   If you build locally instead, you **must** pass the same injected-signing properties the
   workflow does — a bare `./gradlew :app:bundleRelease` silently falls back to
   `expo prebuild`'s default `release` signingConfig, which points at the **debug** keystore (this
   is the standard Expo/RN template default, not a bug). That's exactly what produces Play's "You
   uploaded an APK or Android App Bundle that was signed in debug mode" error.

   ```bash
   cd apps/mobile && npx expo prebuild --platform android --no-install
   cd android
   ./gradlew :app:bundleRelease \
     -Pandroid.injected.signing.store.file=/absolute/path/to/release.keystore \
     -Pandroid.injected.signing.store.password=<password> \
     -Pandroid.injected.signing.key.alias=<alias> \
     -Pandroid.injected.signing.key.password=<password>
   ```

   The four property names must match exactly — a typo is silently ignored (no error), and AGP
   falls back to the same debug-signing behavior. Use an absolute path for the keystore file.
   Before uploading, confirm the signer: `keytool -printcert -jarfile app-release.aab` — the
   `Owner:`/`Issuer:` line must be your release cert, not `CN=Android Debug`.

2. Play Console → your app → **Testing → Internal testing → Create new release**, upload that
   `.aab`, add release notes, save + roll out to internal testing.

Once this lands, the app exists as far as the API is concerned, and every later step is scriptable.

## 6. Recruit internal testers

**Testing → Internal testing → Testers**: add a tester list (email addresses or a Google Group).
Internal testing has no review wait and no minimum tester count — this is the track CI publishes
to (Step 8). This is also where you'll eventually run the personal-account closed test
(a **separate** closed track, not internal — see Task 10 Step 3): recruit ≥14 testers (buffer over
the 12 minimum) who must opt in and stay enrolled 14 consecutive days before production access can
be requested. Start that clock as early as possible — it's the actual critical path to launch, not
engineering time.

## 7. API access — service account for CI

Play Console → **Setup → API access**:

1. If prompted, link a Google Cloud project (Play Console can create one for you, or link an
   existing one — for a solo/small team either is fine).
2. Under **Service accounts**, click **Create new service account** — this opens the Google Cloud
   Console's IAM page in a new tab, pre-scoped to the right project.
3. In Google Cloud Console: **IAM & Admin → Service Accounts → Create service account**. Name it
   something like `trmission-play-ci`. No roles need to be granted _in GCP_ — permissions are
   granted back in Play Console (next step).
4. On the new service account, **Keys → Add key → Create new key → JSON**. This downloads the
   JSON key file once — it cannot be re-downloaded, only re-created. Treat it like a password.
5. Back in Play Console → **Setup → API access**, the service account now appears under **Service
   accounts** (may need a refresh) — click **Manage Play Console permissions** next to it.
6. Grant it, at minimum: **View app information**, **Manage testing track releases**, and account
   permission for the TRMission app specifically (not "Admin (all permissions)" — scope it to this
   one app). Do **not** grant **Manage production releases** unless you actually want CI-adjacent
   tooling capable of publishing to production — the `internal` fastlane lane doesn't need it, and
   the `promote` lane is meant to be run locally by a human, not automated.
7. Invite and confirm the service account (it behaves like a user invite — accept/confirm if
   prompted).

## 8. Add the key to GitHub

```bash
base64 -w0 play-key.json   # macOS: base64 play-key.json | tr -d '\n'
```

Add the output as the repo secret **`PLAY_JSON_KEY_BASE64`** (Settings → Secrets and variables →
Actions). Delete the local `play-key.json` once it's in the secret store and the team password
manager backup.

`mobile-android.yml` now decodes it and runs `fastlane android internal` — but **only when the
triggering ref is a real release tag** (`v<semver>+<build>`, e.g. `v1.0.0+1`); plain pushes to a
`release/**` branch still build and upload the `.aab` as a CI artifact but skip the Play step
entirely, so they can't collide on a reused `versionCode`. Push a tag to actually publish:

```bash
git tag v1.0.0+1
git push origin v1.0.0+1
```

Bump the `+<build>` suffix on every subsequent tag — Play rejects a re-upload at a `versionCode`
it's already seen (`docs/release/mobile-versioning.md` is the full contract, shared with iOS's
`CFBundleVersion`).

## 9. Verify the pipeline

1. Push a tag as above and watch the Action run — expect `Upload to Play's internal testing track`
   to succeed and a new release to appear under **Testing → Internal testing** in the Console
   within a few minutes.
2. Install it: Play Console → Internal testing → **Testers** tab has an opt-in link; the tester
   account joins and can install from the Play Store app.

## 10. Production access (when ready to launch, not before)

Only after the closed-test window (Step 6, if on a personal account) is satisfied:

1. Play Console prompts **"Apply for production access"** (or find it under Publishing overview) —
   answer the production-readiness questionnaire (testing summary, target audience) honestly.
2. Once granted, promote a verified internal build locally — do not wire this into CI:
   ```bash
   cd apps/mobile
   PLAY_JSON_KEY_FILE=/path/to/play-key.json bundle exec fastlane android promote
   ```
3. Use a **staged rollout** (10% → 25% → 50% → 100%), advancing only after ≥48h with crash-free
   sessions ≥99.5% (Play Vitals) and no new ANR regressions — full detail in
   `docs/superpowers/plans/2026-07-06-mobile-p6-release-compliance.md` Task 10 Step 4.

The full pre-submission checklist (device verification, `.well-known` files, the IP-risk
sign-off) lives in that same plan's Task 11 — work through it before the first "Submit for
review," not after.
