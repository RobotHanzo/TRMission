# Mobile OTA updates — self-hosted expo-open-ota

Self-hosted `expo-updates` delivery per spec §10. **No EAS anywhere**: the update server is an
[expo-open-ota](https://github.com/axelmarciano/expo-open-ota) container in our own compose stack,
updates are code-signed with our own certificate, and `runtimeVersion: { policy: 'fingerprint' }`
fences every update to binaries with an identical native surface. JS/assets only — Apple
3.3.2-compliant.

This file is the **mechanism**: the pinned upstream contract, the app config, the forced-update
interplay, rollback, fallbacks. For standing the server up on a real host (keys, TLS origin, Expo
credentials, Portainer/Swarm service, repo variables, verification), follow
[docs/release/ota-server-setup.md](../release/ota-server-setup.md).

## Pinned upstream contract (v3 line — re-pinned 2026-07-25, verified against the deployment)

Upstream moves faster than our plans. The original pin (2026-07-12) was the v2 single-app line;
the deployed server is v3, so the whole contract was re-verified against the live host and the
published CLI tarballs. **Server and CLI ship from one repo and only work in matched pairs** — bump
them together, never one alone.

| Item              | Pinned value                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release           | `v3.0.5`                                                                                                                                                                                         |
| Publish CLI       | `eoas@3.0.5` — pinned in `mobile-ota.yml`, in lockstep with the image                                                                                                                            |
| Docker image      | `ghcr.io/axelmarciano/expo-open-ota:v3.0.5` (version tags DO exist — the old "none published" note was wrong)                                                                                    |
| Container port    | `3000` (host-mapped to `3005` in compose)                                                                                                                                                        |
| Manifest endpoint | `GET /manifest` — what `updates.url` points at                                                                                                                                                   |
| App selection     | `expo-app-id` request header = the **Expo project id** (the server's own `EXPO_APP_ID`). Omit it and the server falls back to `EXPO_APP_ID` — that "v1 client" path is what local dev builds use |
| Health check      | `GET /hc`                                                                                                                                                                                        |
| Assets            | `GET /assets`                                                                                                                                                                                    |
| Upload            | `POST /{APP_ID}/requestUploadUrl/{BRANCH}` → `…/uploadLocalFile` → `…/markUpdateAsUploaded/{BRANCH}` — **app-scoped in v3** (v2 had no `/{APP_ID}` segment), driven by the CLI, never by hand    |
| Publish auth      | `EOO_TOKEN` (server-dashboard token) switches the CLI to "eoo" mode; otherwise it reads `EXPO_TOKEN`. We use the Expo robot token                                                                |
| Dashboard         | `GET /dashboard/` — present on v3; not used by us                                                                                                                                                |

### How this was verified (2026-07-25)

Live host, not documentation: `/manifest` with `expo-channel-name` + `expo-platform` +
`expo-runtime-version` returns `200 multipart/mixed` `{"type":"noUpdateAvailable"}` **without** any
app-id header (so the `EXPO_APP_ID` fallback works), `POST /api/apps` → `401`, and
`POST /api/requestUploadUrl/production` → `{"detail":"invalid app id"}` (it read `requestUploadUrl`
as an app id — that is the `/{APP_ID}/…` route shape). The v2 path `POST /requestUploadUrl/production`
→ `404 page not found`, which is the failure the v2-pinned CLI hit. Auth/appId/route behaviour was
read from the published `eoas` tarballs (`dist/lib/auth.js`, `dist/commands/publish.js`).

### Env contract (compose `ota` service)

| Var                                | Required           | Purpose                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_URL`                         | yes                | Public origin clients reach the server at; manifest/asset URLs are built from it.                                                                                                                                                                                                        |
| `JWT_SECRET`                       | yes                | Signs the server's own upload/dashboard tokens. Independent of the app server's `JWT_SECRET`. Set via the compose `TRM_OTA_JWT_SECRET` var — there is no insecure default; the container's entrypoint refuses to start `expo-open-ota` if it's unset or still the old placeholder value. |
| `EXPO_APP_ID`                      | yes                | Expo project id — used with `EXPO_ACCESS_TOKEN` to authenticate `eoas publish` and map channels→branches via the Expo API. Serving itself is fully self-hosted.                                                                                                                          |
| `EXPO_ACCESS_TOKEN`                | yes                | Expo access token (robot token) for the above.                                                                                                                                                                                                                                           |
| `CACHE_MODE`                       | —                  | `local` (in-process cache; no Redis needed at our scale).                                                                                                                                                                                                                                |
| `STORAGE_MODE`                     | —                  | `local` — filesystem backend on the `trm-ota-data` named volume.                                                                                                                                                                                                                         |
| `LOCAL_BUCKET_BASE_PATH`           | with local storage | `/updates` (the named-volume mount point).                                                                                                                                                                                                                                               |
| `KEYS_STORAGE_TYPE`                | —                  | `local` — code-signing keys read from mounted files.                                                                                                                                                                                                                                     |
| `PUBLIC_LOCAL_EXPO_KEY_PATH`       | with local keys    | `/keys/public-key.pem`.                                                                                                                                                                                                                                                                  |
| `PRIVATE_LOCAL_EXPO_KEY_PATH`      | with local keys    | `/keys/private-key.pem`.                                                                                                                                                                                                                                                                 |
| `USE_DASHBOARD` + `ADMIN_PASSWORD` | optional           | Enables the bundled dashboard UI. Off for us.                                                                                                                                                                                                                                            |

### Publish mechanism

`npx eoas@3.0.5 publish --branch <branch> --nonInteractive [--platform ios|android|all] [--message …]`,
authenticated by an `EXPO_TOKEN` env var. **eoas runs its own `expo export`** — CI needs no
separate export step. Channels (what the app requests via the `expo-channel-name` header) map to
branches in the Expo dashboard; we use `production` and `preview` as both channel and branch names.

**The version pin is load-bearing, not tidiness.** Unpinned `npx eoas` floats across generations and
breaks in both directions:

- a **v2 CLI against the v3 server** posts to `/requestUploadUrl/<branch>` and gets
  `Failed to request upload URL: 404 page not found`;
- a **v3 CLI against a v2-shaped config** (no `expo-app-id`) aborts with
  `Your Expo config is missing the 'expo-app-id' entry in updates.requestHeaders`.

New v3 flags worth knowing: `--rollout-percentage` (progressive rollout, progressed from the
dashboard), `--dumpSourcemap`, and `--disableRepositoryCheck`. We deliberately do **not** pass the
last one — the clean-tree check is what keeps a published bundle equal to a commit; generated files
are gitignored instead.

### `updates.requestHeaders` is a fingerprint input (this fences updates)

Both header values feed the runtimeVersion, so they must match between the store build and the
publish. Measured on this project 2026-07-25 (`npx @expo/fingerprint .`):

| Config                                      | Hash        |
| ------------------------------------------- | ----------- |
| no `expo-app-id`                            | `643948f6…` |
| with `expo-app-id`                          | `dbfc9bbb…` |
| with `expo-app-id`, different `TRM_OTA_URL` | `bd1e4857…` |

`@expo/fingerprint` only drops `updates.url` under the `ExpoConfigEASProject` source-skip, which is
**not** enabled by default — so even the URL moves the hash. Consequences, all enforced in CI:

- `TRM_OTA_APP_ID` must be set for the store lanes **and** the OTA lane (mobile-android/ios/ota.yml).
- `TRM_OTA_CHANNEL` must be the channel being published to, or a `preview` publish stamps a
  production-flavoured runtime version that no preview binary can match.
- Locally, `TRM_OTA_APP_ID` unset means the header is **omitted** (not blank) — the v1-client shape
  the server still serves via its `EXPO_APP_ID` fallback.

### Sentry changed the fingerprint (2026-07-25, issue #44)

`@sentry/react-native` is a native dependency, so adding it moved the runtimeVersion for both
platforms. **The first OTA published after that change needs a fresh native build on both stores
first** — until a binary carrying the new fingerprint is out there, nothing matches the update.

The `'@sentry/react-native/expo'` config plugin is deliberately passed **no props**: organization,
project and auth token come from `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` at build time, so
the plugin entry — and therefore the fingerprint — is identical whether or not an operator has a
Sentry account. Do not move those into `app.config.ts`; it would make the runtime version depend on
the builder's environment.

`TRM_SENTRY_DSN`/`_ENVIRONMENT`/`_TRACES_SAMPLE_RATE` ride in `extra` (not a fingerprint input), but
follow the same lockstep rule as the Google client ids for the reason in the section above: the
publish lane must set them or an applied update wipes them from the device.

### The recorded runtime version is per-platform

`npx @expo/fingerprint .` hashes the whole project across all platforms and yields a value that never
appears in a manifest. The real runtime version is what `expo-updates` computes per platform, which is
also exactly what eoas calls (`dist/lib/runtimeVersion.js` → the project's own CLI):

```bash
cd apps/mobile
npx expo-updates runtimeversion:resolve --platform android --workflow managed   # → {"runtimeVersion":…}
```

`--workflow managed` because `android/`/`ios/` are CNG (that mode ignores the native dirs, so a
prebuilt tree and a clean one agree). Same tree, 2026-07-25: android `63e96d17…`, ios `7e888eb0…` —
different per platform, and both different from the whole-project hash above. `mobile-ota.yml` records
these two values as `runtime-versions.json`; use them when probing `/manifest` by hand.

### Code-signing decision: serve-time signing

expo-open-ota signs manifests **at serve time** with the private key mounted into the container
(`PRIVATE_LOCAL_EXPO_KEY_PATH`). Consequences:

- The private key lives ONLY on the OTA host at `apps/mobile/certs/keys/private-key.pem`
  (gitignored — `apps/mobile/certs/keys/` must never be committed).
- CI does **not** need the private key: no `OTA_CODE_SIGNING_PRIVATE_KEY` secret exists.
- The committed half is `apps/mobile/certs/certificate.pem`, referenced from
  `app.config.ts` → `updates.codeSigningCertificate`. Installed apps reject any manifest not
  signed by its key (`keyid: main`, `alg: rsa-v1_5-sha256`).
- Regeneration (only if the key is lost/compromised — this orphans all installed binaries until
  a store release ships the new cert):

  ```bash
  cd apps/mobile
  npx expo-updates codesigning:generate \
    --key-output-directory certs-keys-tmp \
    --certificate-output-directory certs \
    --certificate-validity-duration-years 10 \
    --certificate-common-name "TRMission OTA"
  mv certs-keys-tmp certs/keys
  ```

  (`eoas generate-certs` is interactive-only; the flag-driven `expo-updates` generator is
  equivalent. It refuses a non-empty output dir, hence the tmp-dir + `mv`.)

## App config (apps/mobile/app.config.ts)

- `updates.url` = `TRM_OTA_URL` (repo/deploy variable) or `http://localhost:3005/manifest` for the
  local compose container. `TRM_OTA_URL` must be the **full manifest URL** including `/manifest`.
- `updates.requestHeaders['expo-channel-name']` = `TRM_OTA_CHANNEL` (default `production`) — this
  is baked into the binary at build time; store builds are `production`, internal builds may be
  built with `TRM_OTA_CHANNEL=preview`.
- `fallbackToCacheTimeout: 0` — launch never blocks on the update check; a downloaded update
  applies on the next cold start. The forced-update gate (`GET /version/mobile`) still runs every
  boot and is independent of OTA (see the interplay section below, completed in Task 10).
- `runtimeVersion: { policy: 'fingerprint' }` — any native change (module/SDK/config-plugin)
  changes the fingerprint, so old binaries simply never see the new bundle.

## Local smoke

```bash
EXPO_APP_ID=<expo-project-id> EXPO_ACCESS_TOKEN=<robot-token> TRM_OTA_JWT_SECRET=<a-real-secret> \
  docker compose --profile full up -d ota
curl -si http://localhost:3005/hc            # → 200 (empty body)
curl -si http://localhost:3005/manifest \
  -H "expo-protocol-version: 1" -H "expo-channel-name: production" \
  -H "expo-runtime-version: <per-platform runtime version>" -H "expo-platform: android"
# Expect an expo-updates-protocol response; connection refused or an HTML error page is not OK.
# `{"type":"noUpdateAvailable"}` is a PASS — it means the protocol, channel and app resolved.
```

Get `<per-platform runtime version>` from `npx expo-updates runtimeversion:resolve` (above), not from
`@expo/fingerprint`, or the probe will report no update for a runtime version nothing was published
under. On v3 you can also let the CLI do it: `npx eoas@3.0.5 doctor --channel production` probes the
server both as a v1 client (no app id) and a v2 client (with it) and reports which shapes are served.

What this proves without real Expo credentials is recorded in the appendix at the bottom.

## CI publish lane (.github/workflows/mobile-ota.yml)

Triggers: manual dispatch (channel choice `production`/`preview`) or a `mobile-ota-v*` tag
(always `production`). The pinned publish command as it runs in CI:

```bash
npx --yes eoas@3.0.5 publish --branch <channel> --nonInteractive --outputDir dist --message "<ref>"
```

- `EXPO_TOKEN` (repo **secret**): Expo robot token — eoas auth + channel→branch mapping.
- `TRM_OTA_URL` (repo **variable**): the deployment's full manifest URL; eoas derives the OTA
  server origin from the app config's `updates.url`, so this must be set for the publish step.
- `TRM_OTA_APP_ID` (repo **variable**): the Expo project id, baked as `expo-app-id`. v3 resolves both
  the upload route and the app from it; also a fingerprint input, hence set in all three mobile lanes.
- `TRM_OTA_CHANNEL`: set to the channel being published to, for the fingerprint reason above.
- There is **no code-signing secret in CI** — signing happens at serve time on the OTA server.
- eoas runs its own `expo export`; the workflow keeps the exported `dist/` plus
  `runtime-versions.json` (the per-platform runtime versions the update targets) as a 30-day artifact.
- The lane does **not** pass `--disableRepositoryCheck`, so every generated file must be gitignored —
  `eoas publish` aborts on a dirty tree with `Commit all changes. Aborting...`.

## Forced-update gate vs OTA (who wins, and why both exist)

Two independent mechanisms, deliberately non-overlapping:

1. `GET /version/mobile` → `{minBuild, commitHash}` — checked at EVERY boot before anything
   else. `nativeBuildVersion < minBuild` ⇒ the forced-update screen (store link). OTA can
   NEVER satisfy this gate: an OTA update changes the JS bundle, never the native
   buildNumber/versionCode. Raise `MOBILE_MIN_BUILD` only when old binaries must die
   (breaking wire/native change).
2. expo-updates + fingerprint runtimeVersion — delivers JS fixes to COMPATIBLE binaries
   only. A bundle exported from a tree with a different native fingerprint is invisible to
   the installed app; there is no override. OTA is an optimization, never a compatibility
   escape hatch.

Decision table:

- JS-only bugfix → OTA (this workflow), optionally also a store release later.
- Native change (new module / SDK / config plugin) → store lanes; OTA lane will no-op for
  old binaries by construction.
- Old binaries must be forced off (server contract break) → store release + raise
  MOBILE_MIN_BUILD after propagation.

## Rollback

Publish the previous known-good export to the same channel (updates are immutable;
"rollback" = publish an older bundle as the newest update). The signed manifest prevents
anyone else from doing this to our users.

## Fallbacks (spec §10)

- **custom-expo-updates-server** (Expo's reference implementation): same protocol, static
  directory storage, publish = copy `dist/` into `updates/<runtimeVersion>/<timestamp>/`.
  Swap the compose image + the workflow publish step (an `rsync` of `dist/` replaces
  `eoas publish`); app config unchanged.
- **Store-only**: set `updates.enabled: false` in app.config.ts and ship through the store
  lanes exclusively. The forced-update gate works regardless — OTA was never load-bearing.

## Appendix: probe results without real Expo credentials (2026-07-12)

- `EXPO_ACCESS_TOKEN` unset ⇒ the container **exits at boot** (crash-loop) — it is genuinely
  required, not optional.
- With a dummy token the server boots (runs its storage migrations, binds port 3000), `/hc`
  returns 200, `/manifest` without the channel header returns `400 No channel name provided`
  (the channel travels in the `expo-channel-name` HEADER — which is exactly what
  `updates.requestHeaders` in app.config.ts sends), and a fully-headed `/manifest` returns
  `500 … GraphQL … 401 Unauthorized` from the Expo channel→branch lookup — i.e. everything
  self-hosted works; only the real Expo API credentials are missing. Provision `EXPO_APP_ID` +
  `EXPO_ACCESS_TOKEN` on the deploy host to complete the chain.
