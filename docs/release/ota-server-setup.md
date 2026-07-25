# Self-hosted OTA server setup (expo-open-ota)

One-time deployment setup for the mobile app's over-the-air update channel: the
[expo-open-ota](https://github.com/axelmarciano/expo-open-ota) container, its code-signing key, the
public origin in front of it, and the two GitHub settings the publish lane reads.

**This doc is the "how do I stand it up" side.** The mechanism (why `runtimeVersion: fingerprint`
fences updates, how OTA relates to the forced-update gate, rollback, fallbacks) lives in
[docs/mobile/ota.md](../mobile/ota.md) — read that first if you want the model, this one if you want
the host running.

Serving is **fully self-hosted**: bundles never touch EAS. An Expo account is still required, but
only so the OTA server can authenticate a publish and map channel→branch through the Expo API.

## 0. Order of operations (this one bites)

`updates.url` is **baked into the binary at `expo prebuild` time** from the `TRM_OTA_URL` repo
variable ([mobile-android.yml:143](../../.github/workflows/mobile-android.yml#L143),
[mobile-ios.yml:144](../../.github/workflows/mobile-ios.yml#L144)). A store build produced while
that variable is unset ships `http://localhost:3005/manifest` and **can never receive an update** —
no OTA can fix an OTA URL. The only repair is another store release.

So, in order:

1. Private key on the host (§2) — it must match the committed certificate.
2. Container + TLS origin live and answering (§3–§6).
3. `TRM_OTA_URL` + `EXPO_TOKEN` set on the repo (§7).
4. **Then** cut the store release. Binaries from that build onward are OTA-capable.
5. Publish updates (§9).

## 1. Choose the public origin

A dedicated subdomain. The current deployment uses `https://trmota.robothanzo.dev`:

| Setting                       | Value                                      |
| ----------------------------- | ------------------------------------------ |
| `BASE_URL` (container)        | `https://ota.<domain>` — no trailing slash |
| `TRM_OTA_URL` (repo variable) | `https://ota.<domain>/manifest`            |

- **HTTPS is mandatory**, not a nicety: iOS ATS blocks cleartext, so an `http://` manifest URL fails
  on device even though the manifest itself is signed.
- `BASE_URL` is what the server builds manifest **and asset** URLs from, so it must be the origin
  the phone actually reaches — not the container's internal address.
- The origin must be reachable **from GitHub Actions**, not just your LAN: `eoas` derives the OTA
  server from the app config's `updates.url` and uploads to it from the runner.
- Hosting under a path prefix (`https://<domain>/ota/…`) is untested here — asset URLs derive from
  `BASE_URL`, so a prefix has to survive both the manifest and every asset fetch. Use a subdomain.

## 2. Code-signing key on the host

Installed apps accept **only** manifests signed by the key behind
[apps/mobile/certs/certificate.pem](../../apps/mobile/certs/certificate.pem), which is committed and
compiled into every binary. Signing happens at **serve time**, inside the container — the private
key exists on the OTA host and nowhere else (not in git, not in CI).

Read the identity out of the tree rather than trusting a hash pasted into a doc — it changes on every
rotation (the original 2026-07-12 certificate was rotated on 2026-07-25):

```bash
openssl x509 -in apps/mobile/certs/certificate.pem -noout -subject -dates \
  -ext keyUsage,extendedKeyUsage
# expect CN=TRMission OTA, a ten-year window, critical Digital Signature + Code Signing
```

The host needs both halves as PEM files (`private-key.pem`, `public-key.pem` — the pair produced by
`expo-updates codesigning:generate`). **Verify they match the shipped certificate before deploying**
— a mismatch is invisible server-side and simply makes every device silently reject every update:

```bash
# both lines must print the SAME SPKI hash
openssl x509 -in apps/mobile/certs/certificate.pem -noout -pubkey \
  | openssl pkey -pubin -outform DER | openssl dgst -sha256
openssl pkey -in /srv/trmission/ota-keys/private-key.pem -pubout -outform DER \
  | openssl dgst -sha256
```

The certificate a device trusts is the one compiled into **its own binary**, so the pair that matters
is (key on the host) ↔ (certificate committed when that store build was cut). Rotating the
certificate after a release is what strands installed apps — see below.

Store the key root-owned and read-only (`chmod 0400`), mounted `:ro` (compose) or as a Swarm secret
(§5). It never belongs in an image layer, a repo, or a CI secret.

**If the private key is lost or compromised**, regenerate and commit the new certificate:

```bash
cd apps/mobile
npx expo-updates codesigning:generate \
  --key-output-directory certs-keys-tmp \
  --certificate-output-directory certs \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "TRMission OTA"
mv certs-keys-tmp certs/keys     # gitignored; copy the key to the host, then delete it locally
```

The cost is real: **every binary already installed keeps trusting the old certificate** and will
reject all future updates until a store release ships the new one. Free to do before the first store
release; a multi-week problem after.

## 3. Expo credentials

The container **crash-loops at boot without a valid Expo access token** (recorded in
docs/mobile/ota.md's appendix) — it is genuinely required, not optional.

1. Create/sign in to an [expo.dev](https://expo.dev) account and create a project for the app
   (free plan is sufficient — nothing is served from Expo).
2. Copy the **project ID** → `EXPO_APP_ID`.
3. Create a **robot access token** with owner/admin access to that project →
   `EXPO_ACCESS_TOKEN` on the host, and the **same token** as the `EXPO_TOKEN` repo secret (§7).
4. Create branches + channels named `production` and `preview`, each channel pointing at the
   branch of the same name. The app sends the channel in the `expo-channel-name` header; the OTA
   server resolves it to a branch through the Expo API.

## 4. Secrets and env values to prepare

| Value                | Where    | Notes                                                                                                                                                                                                                                                           |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRM_OTA_JWT_SECRET` | host env | Signs the OTA server's own short-lived upload tokens. **Independent of the app server's `JWT_SECRET`** — do not reuse. `openssl rand -base64 48`. The service entrypoint refuses to start if it is unset or still the old `dev-insecure-change-me` placeholder. |
| `TRM_OTA_BASE_URL`   | host env | The §1 origin (compose maps it to `BASE_URL`).                                                                                                                                                                                                                  |
| `EXPO_APP_ID`        | host env | §3.                                                                                                                                                                                                                                                             |
| `EXPO_ACCESS_TOKEN`  | host env | §3. Treat as a secret.                                                                                                                                                                                                                                          |

The dashboard UI (`USE_DASHBOARD` + `ADMIN_PASSWORD`) stays **off** — it is another authenticated
surface to defend for no operational gain here.

## 5. Pin the image, then deploy the service

`docker-compose.yml` references `ghcr.io/axelmarciano/expo-open-ota:latest`, but the env contract in
this repo was pinned and verified against **v2.3.21**. Checked against GHCR on 2026-07-25:

| Tag       | Digest                                                                                 |
| --------- | -------------------------------------------------------------------------------------- |
| `v2.3.21` | `sha256:de09a283642323ebcd677f236b5a6145b83749ae7b6b5864a9976d1e33960905`              |
| `latest`  | `sha256:c6f37d3e1edc5e8f8372e4353bf09ef0524248688a362a6c0bada113001019d7` (= `v3.0.5`) |

Upstream has since shipped a 3.x line whose README describes a different architecture (a control
plane with PostgreSQL, per-app API tokens). **Deploy the digest-pinned v2.3.21 image**; adopting 3.x
is a deliberate re-pin exercise — re-verify the env table in docs/mobile/ota.md first.

```
image: ghcr.io/axelmarciano/expo-open-ota@sha256:de09a283642323ebcd677f236b5a6145b83749ae7b6b5864a9976d1e33960905
```

### Production (Portainer / Docker Swarm)

`docker-stack.yml` intentionally ships without an `ota` service — the update server is optional
infrastructure and carries a secret the app stack doesn't. Paste this alongside the existing
services (Swarm secrets instead of a bind mount, so the key never sits on disk in a repo checkout):

```yaml
services:
  ota:
    image: ghcr.io/axelmarciano/expo-open-ota@sha256:de09a283642323ebcd677f236b5a6145b83749ae7b6b5864a9976d1e33960905
    environment:
      BASE_URL: ${TRM_OTA_BASE_URL}
      JWT_SECRET: ${TRM_OTA_JWT_SECRET}
      EXPO_APP_ID: ${EXPO_APP_ID}
      EXPO_ACCESS_TOKEN: ${EXPO_ACCESS_TOKEN}
      CACHE_MODE: local
      STORAGE_MODE: local
      LOCAL_BUCKET_BASE_PATH: /updates
      KEYS_STORAGE_TYPE: local
      PUBLIC_LOCAL_EXPO_KEY_PATH: /run/secrets/ota_public_key
      PRIVATE_LOCAL_EXPO_KEY_PATH: /run/secrets/ota_private_key
    # Same pre-flight guard as docker-compose.yml: the upstream image validates nothing at boot,
    # so an unconfigured JWT_SECRET would silently accept forged upload tokens.
    entrypoint: ['/bin/sh', '-c']
    command:
      - |
        if [ -z "$$JWT_SECRET" ] || [ "$$JWT_SECRET" = "dev-insecure-change-me" ]; then
          echo 'FATAL: TRM_OTA_JWT_SECRET is unset (or still the insecure placeholder).' >&2
          exit 1
        fi
        exec /app/main
    secrets:
      - ota_public_key
      - ota_private_key
    volumes:
      - trm-ota-data:/updates
    ports:
      - '3005:3000'
    deploy:
      restart_policy:
        condition: any
      # The update store is a local volume — pin the service to the node that holds it.
      placement:
        constraints: [node.hostname == <your-node>]

secrets:
  ota_public_key:
    external: true
  ota_private_key:
    external: true

volumes:
  trm-ota-data:
```

Create the secrets once on the manager node:

```bash
docker secret create ota_public_key  /srv/trmission/ota-keys/public-key.pem
docker secret create ota_private_key /srv/trmission/ota-keys/private-key.pem
```

Set `TRM_OTA_BASE_URL`, `TRM_OTA_JWT_SECRET`, `EXPO_APP_ID`, `EXPO_ACCESS_TOKEN` in Portainer →
Stacks → Environment variables, then deploy.

### Local / single-host compose

The `ota` service already exists in [docker-compose.yml](../../docker-compose.yml) under the `full`
profile (bind-mounting `apps/mobile/certs/keys`, publishing `3005:3000`):

```bash
mkdir -p apps/mobile/certs/keys      # drop private-key.pem + public-key.pem here (gitignored)
EXPO_APP_ID=<project-id> EXPO_ACCESS_TOKEN=<robot-token> TRM_OTA_JWT_SECRET=<real-secret> \
TRM_OTA_BASE_URL=http://localhost:3005 \
  docker compose --profile full up -d ota
```

## 6. TLS reverse proxy

Terminate TLS on the host and forward to the container. nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name ota.<domain>;

  ssl_certificate     /etc/letsencrypt/live/ota.<domain>/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/ota.<domain>/privkey.pem;

  # eoas uploads the exported bundle + assets through this origin.
  client_max_body_size 200m;
  proxy_read_timeout   300s;
  proxy_send_timeout   300s;

  location / {
    proxy_pass http://127.0.0.1:3005;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Manifests are per-runtime-version/channel and signed — never let a cache answer them.
    proxy_no_cache     1;
    proxy_cache_bypass 1;
  }
}
```

The protocol headers (`expo-channel-name`, `expo-runtime-version`, `expo-platform`,
`expo-protocol-version`, `expo-expect-signature`) are all hyphenated, so nginx forwards them
untouched — no `underscores_in_headers` needed. Don't strip or rewrite them; the channel travels in
a header, not the path.

## 7. GitHub settings

| Kind         | Name          | Value                                                     |
| ------------ | ------------- | --------------------------------------------------------- |
| **Variable** | `TRM_OTA_URL` | `https://ota.<domain>/manifest` (full manifest URL, §1)   |
| **Secret**   | `EXPO_TOKEN`  | The §3 robot token — `eoas` auth + channel→branch mapping |

There is deliberately **no code-signing secret in CI**: manifests are signed serve-side by the key
from §2.

Two consequences worth knowing:

- `TRM_OTA_URL` is consumed by the **store build lanes too** (§0), not just `mobile-ota.yml`.
- Neither store lane sets `TRM_OTA_CHANNEL`, so every store binary requests the **`production`**
  channel. A `preview` publish only reaches binaries built locally with
  `TRM_OTA_CHANNEL=preview`; it is not a staging ring for TestFlight/internal-track builds.

## 8. Verify the deployment

```bash
curl -si https://ota.<domain>/hc                     # → 200, empty body

# Runtime version the current tree targets (any mismatch = "no update available" by design):
npx @expo/fingerprint apps/mobile

curl -si https://ota.<domain>/manifest \
  -H 'expo-protocol-version: 1' \
  -H 'expo-channel-name: production' \
  -H 'expo-runtime-version: <fingerprint>' \
  -H 'expo-platform: android'
```

Expected before the first publish: a valid expo-updates protocol response (a "no update available"
directive is a **pass**). Failures that mean something specific:

| Symptom                               | Cause                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Connection refused / nginx HTML error | Proxy or container not up                                               |
| Container exits at boot (crash loop)  | Missing `EXPO_ACCESS_TOKEN`, or the `JWT_SECRET` pre-flight guard fired |
| `400 No channel name provided`        | The `expo-channel-name` header was dropped by the proxy                 |
| `500 … GraphQL … 401 Unauthorized`    | Bad/expired Expo token, or `EXPO_APP_ID` isn't that token's project     |

End-to-end on a device is the real acceptance bar: publish (§9), cold-start the app once (it
downloads in the background — `fallbackToCacheTimeout: 0` never blocks launch), then cold-start
again — the update applies on the **second** start.

## 9. First publish

Run **mobile-ota** (Actions → Run workflow → channel `production`), or push a `mobile-ota-v*` tag.
It typechecks, records the fingerprint, and runs `npx eoas publish` — which does its own
`expo export`, so there is no separate export step. Manual equivalent from a workstation:

```bash
cd apps/mobile
TRM_OTA_URL=https://ota.<domain>/manifest \
TRM_SERVER_ORIGIN=<production origin> \
TRM_GOOGLE_WEB_CLIENT_ID=… TRM_GOOGLE_IOS_CLIENT_ID=… TRM_GOOGLE_IOS_URL_SCHEME=… \
EXPO_TOKEN=<robot-token> \
  npx --yes eoas publish --branch production --nonInteractive --outputDir dist --message "manual"
```

The `TRM_*` build vars are not optional decoration: an applied update's manifest **replaces**
`Constants.expoConfig.extra` on device, so publishing without them wipes the baked Google client ids
and server origin from every phone that applies it.

`eoas publish` **refuses to run on a dirty working tree** (`Commit all changes. Aborting...`) — it
lists the offending paths, and anything generated into the tree before it counts. That is why
`apps/mobile/fingerprint.json` is gitignored; keep it that way, and commit or stash local work before
publishing by hand.

Rollback = republish the previous known-good bundle to the same channel (updates are immutable;
newest wins). See docs/mobile/ota.md.

## 10. Ongoing upkeep

- **Certificate expiry** (`openssl x509 … -noout -dates`; ten years from whenever it was last
  rotated). Rotating it requires a store release (§2) — calendar it well
  ahead, not the week of.
- **Expo robot token** — rotate on the same schedule as other credentials; update both the host env
  and the `EXPO_TOKEN` repo secret, then restart the container.
- **`trm-ota-data` volume** holds every published bundle. Losing it doesn't brick installed apps
  (they keep the bundle they already applied), but pending updates vanish until you republish.
  Back it up or accept republish as the recovery path.
- **Image bumps** — re-verify the env table in docs/mobile/ota.md against the release you're moving
  to (especially anything on the 3.x line) and re-run §8 before pointing the tag at it.
- **Never** raise `MOBILE_MIN_BUILD` expecting OTA to satisfy it: an update changes the JS bundle,
  never the native build number. The two mechanisms are independent by design — docs/mobile/ota.md,
  "Forced-update gate vs OTA".

## Done checklist

- [ ] Private key on the host, SPKI hash matches the committed certificate (§2)
- [ ] Container running the digest-pinned image, `/hc` → 200 (§5, §8)
- [ ] `https://ota.<domain>/manifest` answers a protocol response through TLS (§6, §8)
- [ ] `TRM_OTA_URL` variable + `EXPO_TOKEN` secret set on the repo (§7)
- [ ] Store release cut **after** those were set (§0)
- [ ] One update published and verified applying on a real device across two cold starts (§8, §9)
