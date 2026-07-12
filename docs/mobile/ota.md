# Mobile OTA updates — self-hosted expo-open-ota

Self-hosted `expo-updates` delivery per spec §10. **No EAS anywhere**: the update server is an
[expo-open-ota](https://github.com/axelmarciano/expo-open-ota) container in our own compose stack,
updates are code-signed with our own certificate, and `runtimeVersion: { policy: 'fingerprint' }`
fences every update to binaries with an identical native surface. JS/assets only — Apple
3.3.2-compliant.

## Pinned upstream contract (recorded 2026-07-12, Task 9 Step 1)

Upstream moves faster than our plans; everything below was read from the release/README current at
pin time. Re-verify this table before bumping the image.

| Item              | Pinned value                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Release           | `v2.3.21`                                                                                  |
| Docker image      | `ghcr.io/axelmarciano/expo-open-ota:latest` (no version-tagged images published)           |
| Container port    | `3000` (host-mapped to `3005` in compose)                                                  |
| Manifest endpoint | `GET /manifest` — this is what `updates.url` points at                                     |
| Health check      | `GET /hc`                                                                                  |
| Assets            | `GET /assets`                                                                              |
| Upload            | `POST /requestUploadUrl/{BRANCH}` + friends — driven by the `eoas` CLI, not called by hand |

### Env contract (compose `ota` service)

| Var                                | Required           | Purpose                                                                                                                                                         |
| ---------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_URL`                         | yes                | Public origin clients reach the server at; manifest/asset URLs are built from it.                                                                               |
| `JWT_SECRET`                       | yes                | Signs the server's own upload/dashboard tokens. Independent of the app server's `JWT_SECRET`.                                                                   |
| `EXPO_APP_ID`                      | yes                | Expo project id — used with `EXPO_ACCESS_TOKEN` to authenticate `eoas publish` and map channels→branches via the Expo API. Serving itself is fully self-hosted. |
| `EXPO_ACCESS_TOKEN`                | yes                | Expo access token (robot token) for the above.                                                                                                                  |
| `CACHE_MODE`                       | —                  | `local` (in-process cache; no Redis needed at our scale).                                                                                                       |
| `STORAGE_MODE`                     | —                  | `local` — filesystem backend on the `trm-ota-data` named volume.                                                                                                |
| `LOCAL_BUCKET_BASE_PATH`           | with local storage | `/updates` (the named-volume mount point).                                                                                                                      |
| `KEYS_STORAGE_TYPE`                | —                  | `local` — code-signing keys read from mounted files.                                                                                                            |
| `PUBLIC_LOCAL_EXPO_KEY_PATH`       | with local keys    | `/keys/public-key.pem`.                                                                                                                                         |
| `PRIVATE_LOCAL_EXPO_KEY_PATH`      | with local keys    | `/keys/private-key.pem`.                                                                                                                                        |
| `USE_DASHBOARD` + `ADMIN_PASSWORD` | optional           | Enables the bundled dashboard UI. Off for us.                                                                                                                   |

### Publish mechanism

`npx eoas publish --branch <branch> --nonInteractive [--platform ios|android|all] [--message …]`,
authenticated by an `EXPO_TOKEN` env var. **eoas runs its own `expo export`** — CI needs no
separate export step. Channels (what the app requests via the `expo-channel-name` header) map to
branches in the Expo dashboard; we use `production` and `preview` as both channel and branch names.

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

## Local smoke (verified 2026-07-12 against v2.3.21)

```bash
EXPO_APP_ID=<expo-project-id> EXPO_ACCESS_TOKEN=<robot-token> \
  docker compose --profile full up -d ota
curl -si http://localhost:3005/hc            # → 200 (empty body)
curl -si http://localhost:3005/manifest \
  -H "expo-protocol-version: 1" -H "expo-channel-name: production" \
  -H "expo-runtime-version: <fingerprint>" -H "expo-platform: android"
# Expect an expo-updates-protocol response; connection refused or an HTML error page is not OK.
```

What this proves without real Expo credentials is recorded in the appendix at the bottom.

## CI publish lane (.github/workflows/mobile-ota.yml)

Triggers: manual dispatch (channel choice `production`/`preview`) or a `mobile-ota-v*` tag
(always `production`). The pinned publish command as it runs in CI:

```bash
npx --yes eoas publish --branch <channel> --nonInteractive --outputDir dist --message "<ref>"
```

- `EXPO_TOKEN` (repo **secret**): Expo robot token — eoas auth + channel→branch mapping.
- `TRM_OTA_URL` (repo **variable**): the deployment's full manifest URL; eoas derives the OTA
  server origin from the app config's `updates.url`, so this must be set for the publish step.
- There is **no code-signing secret in CI** — signing happens at serve time on the OTA server.
- eoas runs its own `expo export`; the workflow keeps the exported `dist/` plus the recorded
  `fingerprint.json` (the runtime version the update targets) as a 30-day artifact.

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
