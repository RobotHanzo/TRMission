# Apple Developer + App Store Connect setup

One-time human setup that `mobile-ios.yml` depends on. Mirrors
`docs/release/play-console-setup.md` for the Android side — read that one too if you haven't; a
few values (the Team ID, the bundle id) are shared across both.

Bundle id throughout: `dev.robothanzo.trmission` (`apps/mobile/app.config.ts`,
`apps/mobile/fastlane/Appfile`).

## 1. Apple Developer Program

1. Enroll at [developer.apple.com/programs](https://developer.apple.com/programs/) with the
   Apple ID that should own the account long-term. $99/year. Individual or Organization —
   Organization needs a D-U-N-S number but is the one that survives a person leaving later; pick
   based on the same reasoning as the Play account type
   (`docs/release/play-console-setup.md` Step 1).
2. Once enrolled, note your **Team ID** (Developer Portal → Membership, or top-right account
   menu) — a 10-character string like `A1B2C3D4E5`. It's reused verbatim in five different places
   below, so grab it once now: `team_id` in the Appfile, `APPLE_TEAM_ID` (server), `APNS_TEAM_ID`
   (server), and as the prefix of `APPLE_APP_ID` (`TEAMID.dev.robothanzo.trmission`).

## 2. Register the App ID + capabilities

Developer Portal → **Certificates, IDs & Profiles → Identifiers → +** → App IDs → App:

- Bundle ID: **Explicit**, `dev.robothanzo.trmission`
- Description: `TRMission`
- Capabilities — enable all three (the app actually uses them; a provisioning profile generated
  before you enable one of these won't include it, and `fastlane match` will need re-running):
  - **Sign In with Apple** (Enable as a primary App ID)
  - **Associated Domains** (Universal Links for `/m/callback`, same posture as Android App Links)
  - **Push Notifications**

Do this **before** Step 4 (`fastlane match`) — the distribution provisioning profile match
generates is a snapshot of whatever capabilities are enabled at that moment.

## 3. Register the app in App Store Connect

[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **My Apps → + → New App**:

- Platform: iOS
- Name: `TRMission 台鐵任務` (matches `fastlane/metadata/ios/*/name.txt`)
- Primary language: Chinese (Traditional)
- Bundle ID: select `dev.robothanzo.trmission` (from Step 2)
- SKU: any unique string, e.g. `trmission-ios`

This is the App Store Connect equivalent of Play's "create app" shell — it unlocks TestFlight and
the metadata/pricing/App Privacy sections referenced below.

## 4. fastlane match — seed the certs/profiles repo (one-time, local)

CI never generates certificates itself; it pulls previously-issued ones from a private git repo
that only you seed, read-only. Do this from a machine with Xcode/fastlane installed, not CI:

1. Create an **empty private git repo** to hold the encrypted certs (e.g.
   `github.com/<org>/trmission-certificates`). This is a different repo from the app's source.
2. `apps/mobile/fastlane/Matchfile` already points at `ENV["MATCH_GIT_URL"]` — export it:
   ```bash
   export MATCH_GIT_URL="https://github.com/<org>/trmission-certificates.git"
   export MATCH_PASSWORD="<pick a strong passphrase — encrypts everything in that repo>"
   export FASTLANE_APPLE_ID="you@example.com"   # local-only, Appfile reads this
   export APPLE_TEAM_ID="<your Team ID from Step 1>"
   ```
3. From `apps/mobile`:
   ```bash
   bundle install
   bundle exec fastlane match appstore
   ```
   This prompts for your Apple ID (2FA required), creates a Distribution certificate + an
   App Store provisioning profile for `dev.robothanzo.trmission`, and pushes both (encrypted with
   `MATCH_PASSWORD`) into the certs repo. CI (`mobile-ios.yml`) later runs `match(..., readonly:
true)` — it can read these but never creates or rotates them.
4. Save `MATCH_PASSWORD` in the team password manager — it's the only way to decrypt the repo
   later (rotating certs, onboarding a second machine).

Re-run this **read-write** (drop nothing — just re-run the same command) whenever a cert expires
(~1 year) or a capability changes (Step 2). Task 10 Step 2 of the release plan flags checking
match certs have >60 days left before each release as a launch-gate item.

## 5. GitHub secrets for match

Add three repo secrets (Settings → Secrets and variables → Actions), consumed by
`mobile-ios.yml`:

- `MATCH_GIT_URL` — same value as Step 4
- `MATCH_PASSWORD` — same value as Step 4
- `MATCH_GIT_BASIC_AUTHORIZATION` — base64 of `username:personal_access_token` for the certs
  repo, so CI can clone it over HTTPS non-interactively:
  ```bash
  echo -n "your-github-username:ghp_xxx" | base64
  ```
  The token needs `repo` scope on that one certs repo (a fine-grained PAT scoped to just that
  repo is preferable to a classic token with broad `repo` access).

## 6. App Store Connect API key (CI auth for build + TestFlight upload)

This is a **different** credential from Step 4 — it authenticates `gym`/`pilot` (build + TestFlight
upload), not code signing.

App Store Connect → **Users and Access → Integrations → App Store Connect API → +**:

- Name: `trmission-ci`
- Access: **App Manager** (Task 10 Step 2 explicitly calls for scoping to this, not Admin —
  App Manager can manage builds/TestFlight/metadata but not users/agreements)
- Download the `.p8` **once** (like Play's JSON key, it can't be re-downloaded — only revoked and
  reissued). Note the **Key ID** and **Issuer ID** shown on the same page.

Add as repo secrets:

- `ASC_KEY_ID` — the Key ID
- `ASC_ISSUER_ID` — the Issuer ID (same for every key on the account)
- `ASC_KEY_P8` — base64 of the `.p8` file: `base64 -w0 AuthKey_XXXXX.p8`

## 7. Sign In with Apple server key (account deletion / token revocation)

Separate again from Steps 4 and 6 — this lets the **server** (not CI) revoke a user's Sign In
with Apple grant during `DELETE /auth/me`. Developer Portal → **Keys → +**:

- Check **Sign In with Apple**, configure it against the `dev.robothanzo.trmission` primary App
  ID, register, download the `.p8` once.

Feeds three server env vars (`apps/server/CLAUDE.md`): `APPLE_TEAM_ID` (Step 1), `APPLE_KEY_ID`
(this key's Key ID), `APPLE_PRIVATE_KEY` (this key's `.p8` contents). Also set `APPLE_CLIENT_IDS`
(comma list including `dev.robothanzo.trmission`) so the server accepts the app's Sign In with
Apple identity tokens at all.

You can reuse **one** Key for both this and Step 8 (check both capability boxes when registering)
or keep them separate — either is fine, Apple allows multiple capabilities per key.

## 8. APNs push key (server → device push notifications)

Developer Portal → **Keys → +** (or reuse the Step 7 key with this capability also checked):

- Check **Apple Push Notifications service (APNs)**, register, download the `.p8` once.

Feeds `APNS_TEAM_ID` (Step 1) + `APNS_KEY_ID` + `APNS_PRIVATE_KEY` (this key) +
`APNS_BUNDLE_ID=dev.robothanzo.trmission` on the server. All four must be set together — push is
enabled only when the whole set is present (`apps/server/CLAUDE.md`). Add `APNS_SANDBOX=1` only
against a TestFlight/dev build talking to a non-production server; production installs need it
unset.

## 9. Universal Links (`/m/callback`)

The Android equivalent of `assetlinks.json`. Two things have to agree:

1. **Server**: set `APPLE_APP_ID=<TeamID>.dev.robothanzo.trmission` so
   `GET /.well-known/apple-app-site-association` serves the real value (unset ⇒ 404).
2. **App**: `apps/mobile/app.config.ts` still has the placeholder
   `associatedDomains: ['applinks:trmission.robothanzo.dev']` — replace `trmission.robothanzo.dev` with the
   real production origin (same value as `TRM_SERVER_ORIGIN`/`OAUTH_REDIRECT_BASE`) before the
   first store build. This is a source change, not a Console step — commit it once the production
   origin is final.

Verify after a TestFlight build lands on a device: Settings → Developer → Universal Links, and a
real Google/Discord OAuth round trip should return to the app instead of Safari
(`docs/superpowers/plans/2026-07-06-mobile-p6-release-compliance.md` Task 11 has the exact `curl`
checks for the server side).

## 10. Verify the Xcode scheme/workspace names

`apps/mobile/fastlane/Fastfile`'s `gym` call has a standing `# NOTE (reground)` comment: it
assumes `expo prebuild` emits `ios/TRMission.xcworkspace` / scheme `TRMission`. Confirm this once
against a real prebuild before the first CI run:

```bash
cd apps/mobile && npx expo prebuild --platform ios --no-install
ls ios/*.xcworkspace
```

If the names differ, update the `workspace:`/`scheme:` args in the `gym(...)` call.

## 11. Store listing, ratings, privacy

Content is already spec'd in
`docs/superpowers/plans/2026-07-06-mobile-p6-release-compliance.md` Task 9 — use it rather than
improvising in App Store Connect:

- **Listing text**: `apps/mobile/fastlane/metadata/ios/{zh-Hant,en-US}/{name,subtitle,description,
keywords,privacy_url,support_url}.txt` are already committed. Enter them once by hand in App
  Store Connect, or push via a local `fastlane deliver` run once a `Deliverfile`/lane exists (not
  set up yet — App Store Connect's own UI is the fastest path for a first submission).
- **Screenshots**: `docs/mobile/store-screenshots.md` — iPhone 6.9" portrait + iPad 13"
  landscape/portrait, zh-Hant captured first.
- **Age rating questionnaire**: no violence/gambling; the UGC question ("unrestricted
  user-generated content?") is **No** — declare "Infrequent/Mild User Generated Content" given the
  report/block moderation surface already shipped; enable the Communication Safety disclosure if
  prompted.
- **App Privacy (the "nutrition label")**: same data table as Play's Data Safety form (Task 9
  Step 4) — email, display name, avatar URL, user id, push token, game history, chat/UGC; nothing
  else, no tracking. Declare data **not** used for tracking and no third-party ad/analytics SDKs.
- **Export compliance**: the app only uses standard TLS (no custom crypto), so it qualifies as
  exempt. Optionally set `ios: { config: { usesNonExemptEncryption: false } }` in
  `apps/mobile/app.config.ts` to skip the export-compliance prompt on every TestFlight build
  instead of answering it manually each time.
- **EU DSA**: submit the **non-trader** declaration (same as Play).
- Support/moderation contact: same real monitored mailbox as the Play listing and
  `apps/web/src/screens/PrivacyScreen.tsx`.

## 12. TestFlight

- **Internal testing** (App Store Connect → TestFlight → Internal Group): add team members by
  Apple ID email — no review, builds appear within minutes of a successful `mobile-ios.yml` run.
  This is what CI publishes to already (`fastlane ios beta` → `pilot`).
- **External testing**: needs **Beta App Review** (submit the same compliance metadata as Step 11) — budget ≥1 week per Task 10 Step 3. Only move to this once internal builds are stable.
- Sign In with Apple must work end-to-end on a real TestFlight build before submission, including
  **Hide My Email** (Apple guideline 4.8) — test this explicitly, it's a common review rejection.

## 13. Verify the pipeline end to end

Push the same release tag used for Android (`docs/release/mobile-versioning.md` — one
`BUILD_NUMBER` axis, both platforms):

```bash
git tag v1.0.0+1
git push origin v1.0.0+1
```

Both `mobile-android.yml` and `mobile-ios.yml` trigger off `tags: ['v*']`. Watch the iOS Action —
expect `Build + upload to TestFlight` to succeed and a new build to appear under TestFlight within
~15–30 minutes (Apple's processing time, independent of the Action finishing). `pilot` is called
with `skip_waiting_for_build_processing: true`, so the Action itself won't sit and wait for that.

## 14. Submission + Phased Release

Once ready (compliance metadata complete, internal/external testing satisfied):

1. App Store Connect → select the TestFlight-processed build → **Submit for Review**.
2. Turn on **Phased Release** (7-day automatic rollout curve) so a bad build can be halted before
   100% of users get it — same halt criteria as Play's staged rollout (Task 10 Step 4): watch
   crash metrics in Xcode Organizer / App Store Connect for the first 48h at each step.
3. The full pre-submission checklist (device verification on both platforms, `.well-known` files,
   the IP-risk sign-off) is `docs/superpowers/plans/2026-07-06-mobile-p6-release-compliance.md`
   Task 11 — work through it once for both stores before the first submission, not per-platform.
