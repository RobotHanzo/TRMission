# Play Data safety — why each answer is what it is

`play-data-safety.csv` is upload-ready but unreadable: Play's import format is one row per
(question, response) pair keyed by machine ids, with nowhere to record reasoning. This file is that
reasoning. `play-data-safety.mjs` is what generates the CSV — edit the decision table there, not the
CSV, and re-run:

```bash
node docs/release/play-data-safety.mjs [path-to-input.csv]              # → play-data-safety.csv
node docs/release/play-data-safety.mjs [path-to-input.csv] --minimal    # → play-data-safety-minimal.csv
```

The input is **`data_safety_sample.csv` — Google's own sample, committed next to the script**, so a
regeneration needs nothing outside the repo. An export of our real answers (Play Console → App
content → Data safety → Export to CSV) has an identical row set and works just as well; pass it when
Play adds a question, and commit it as the new input.

Three properties are asserted before anything is written, because a file the importer rejects is
worse than no file at all:

- the input round-trips through the script's own CSV reader/writer;
- the table names no question the input lacks (a rename or removal fails loud);
- **the output introduces no quoted cell the input did not already have.** Google's file never
  quotes a `Response value`, so that is the one shape we cannot prove their importer accepts. Every
  free-text answer here is therefore written without commas or quotes, and the generated file is
  byte-identical to the sample on all 783 lines except an unquoted third cell.

## If Play says "Couldn't upload. Try again."

That is a generic client-side error — it names no row, so it cannot be diagnosed from the file, and
the file is provably well-formed by the three checks above. Work through these in order:

1. **Upload `play-data-safety-minimal.csv` instead.** It is the same file minus the ten rows
   covering account creation, data deletion and outside-app sign-in — the only questions Google's
   sample leaves blank, and therefore the only ones not demonstrated to be importable. If this one
   succeeds, those five questions are UI-only: answer them by hand (two URLs, three radio groups)
   and the 782-row bulk is still done for you.
2. **Retry in a private window with extensions disabled.** The wording is Play Console's generic
   upload failure rather than a validation message, so an interrupted request or a blocked XHR
   produces it too.
3. **Check the file was not opened and re-saved by Excel.** Excel rewrites line endings and can add
   a BOM; both files are UTF-8, CRLF, no BOM, no trailing newline. Re-run the script to restore.

If none of that works, the next step is bisection — halve the declared data types, regenerate, and
find the row Play objects to.

Keep this in lockstep with `app-store-connect-setup.md` §11 (Apple's table) and
`apps/web/src/screens/PrivacyScreen.tsx` (the published policy). A store-to-store mismatch is a
review flag.

## Declared data types

| Play data type | Shared | Req/Opt | What it actually is |
| --- | --- | --- | --- |
| Personal info → Email address | No | Optional | `UserDoc.email` — password sign-up, Google/Discord OAuth, Apple relay address. Guest accounts have none, which is what makes it optional. |
| Personal info → User IDs | No | Required | `UserDoc._id`, `displayName`, OAuth subject ids (`oauth.google`/`discord`/`apple`), `userDevices` keyed to `userId`. |
| Personal info → Other info | No | Required | `UserDoc.lastLoginIp` — sign-in IP kept for abuse and security. Play has no IP data type; this is the honest home and matches Apple's Other Data row. |
| Location → Approximate location | Yes | Required | Only because Google states the Mobile Ads SDK estimates general location from the IP address. The app requests no location permission and holds no location data. |
| Messages → Other in-app messages | No | Optional | In-game chat (free text + preset ids) persisted on the game record; lobby chat is capped and never outlives the room. Optional because a player need never send one. |
| App activity → App interactions | Yes | Required | AdMob impressions/clicks plus Sentry's react-navigation screen transitions. Play defines this type as page visits and taps — hence only these, and hence shared. |
| App activity → Other user-generated content | No | Optional | Display names, authored custom maps, abuse-report free text (`moderation.schemas.ts`, max 1000 chars). |
| App activity → Other actions | No | Required | Gameplay: finished-game records (seats, scores, deterministic action logs), leaderboard and rating rows, tutorial completion, seen feature intros. Play names gameplay under *Other actions*, not *App interactions*. |
| App info and performance → Crash logs | Yes | Required | Sentry (DSN-gated — a build with no DSN never initialises the SDK) plus the Mobile Ads SDK's own crash logs. Scrubbed through `@trm/shared`'s `telemetry.ts` before egress. |
| App info and performance → Diagnostics | Yes | Required | Sentry tracing spans, breadcrumbs and tags; the local `crashCapture` record a user can share from Settings → About. Same scrubber. |
| Device or other IDs | Yes | Required | The Android advertising ID read by the Google Mobile Ads SDK (`AD_ID` is deliberately not blocked — `app.config.ts`), and the FCM device push token stored as `userDevices._id` against the account. |

Nothing is processed ephemerally: every declared type is persisted, so `PSL_DATA_USAGE_EPHEMERAL`
is uniformly `false`.

## Not collected, and why it stays that way

Financial info — no in-app purchases anywhere in the dependency tree. Photos and videos — no image
picker; avatars are a URL carried over from the OAuth provider, never an uploaded file. Audio — no
microphone permission. Precise location, contacts, calendar, files and docs, health and fitness,
web browsing, in-app search history, installed apps, name, address, phone number, race/ethnicity,
beliefs, sexual orientation — never collected. *Other app performance data* is left off because
Play Vitals is Google's own collection and needs no declaration from us.

## Four answers that are decisions, not facts

Each is one cell in `play-data-safety.mjs` if the call goes the other way.

- **Sentry counts as "shared".** `app-store-connect-setup.md` §11 declares it, so the CSV does too.
  Play's definition of sharing carves out transfers to a service provider processing on the
  developer's behalf, which would permit "collected, not shared". Over-declaring costs nothing at
  review; whichever you pick must hold on both stores.
- **`PSL_HAS_OUTSIDE_APP_ACCOUNTS` is true.** Users sign in with Google/Apple/Discord accounts they
  already hold, and with TRMission accounts created on the browser version of the same game — both
  created outside this app. Play's listed sub-options (SIM binding, enterprise accounts) hint at a
  narrower intent, so this is the generous reading of an OPTIONAL question.
- **Guest sign-in is an "Other" account creation method.** A guest is a real server-side account
  holding real data, created with no credentials — it fits none of Play's named methods.
- **Device or other IDs is "Required".** Ads ship on for everyone; the `adFree` opt-out is a
  per-account grant rather than a user choice, and the UMP consent form gates personalization, not
  whether the ID is read. The push token on its own would be optional.

## Deliberately left blank

All three are OPTIONAL questions we do not opt into: `PSL_DATA_COLLECTION_COMPLIES_FAMILY_POLICY`
(the app is not designed for children, and declaring otherwise pulls AdMob into the Families
certified-SDK list), `PSL_INDEPENDENTLY_VALIDATED` (no MASA review), `PSL_UPI_BADGE_OPT_IN` (no UPI
payments).

## Before you upload

Re-check Google's own disclosure table at
developers.google.com/admob/android/privacy/play-data-disclosure. The Approximate location row and
the shared flags on Device or other IDs and App interactions come from Google's published account of
what its SDK collects, and that page changes independently of our code.
