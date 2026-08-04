# Server OTA — hot updates without an image pull

CI lands on the running deployment in seconds, and loaded browser tabs move themselves onto the new
bundle with no "a new version is available, reload?" prompt.

Two paths, one artifact, and the fence below decides which one a given commit takes:

```
CI (push to main) ──> build + push images (GHCR)
                 └──> publish a signed OTA bundle to the rolling `server-ota` prerelease
                      │
                      ├── fence UNCHANGED → the deployment hot-applies it (~1s with the nudge,
                      │                     ≤30s from the poll). No image pull at all.
                      └── fence CHANGED   → an OTA physically cannot carry it, so CI fires the
                                            Portainer stack webhook and the stack redeploys.
```

## Why a source bundle is enough

The server runs **TypeScript source** at runtime (`node --import ./instrument.mjs src/main.ts` +
`@swc-node/register`) — there is no compile step. So a code-only update is "replace the files under
`apps/server/src` and `packages/*/src`, restart the process". The web tier is nginx over static
files, so swapping its `dist` needs no restart at all. And a restart mid-game is already a designed-for
event: write-ahead persistence, replay, and a reconnect that re-mints its ws ticket.

## The fence (the load-bearing decision)

A bundle carries the source the server loads plus the built web bundles. **Nothing else.** So every
bundle and every image carry a **deps fingerprint** over exactly the inputs a bundle cannot express:

- `yarn.lock`, every workspace `package.json`, `.yarnrc.yml`, `.nvmrc` — i.e. `node_modules`
- both Dockerfiles
- `apps/server/assets/**` — the OG renderer's bundled fonts, ~20MB read from disk at runtime and
  changing approximately never, which is the wrong shape for a payload shipped on every commit

`tooling/ota/depsFingerprint.mjs` computes it; `apps/server/Dockerfile` bakes it into the image as
`/app/.trm-deps-fingerprint`; the server refuses any bundle whose fingerprint differs and reports
`needsImagePull`. Same shape, and the same reason, as mobile's `runtimeVersion: fingerprint` fencing
native changes (`docs/mobile/ota.md`).

CI decides which path to take by reading the **live deployment's** fingerprint from
`GET /api/v1/selfupdate/status` — not by diffing git, which would be wrong across a multi-commit
push, a revert, or a deployment that sat out a few releases.

A CI step also asserts that the image's baked fingerprint equals the one computed from the checkout.
If those ever drift, every bundle would be refused and the OTA path would silently cease to exist.

## Trust

Hot-loading code into the server process is the most privileged operation in the system. It is gated
on **both**:

1. an **ed25519 signature** over the manifest payload's exact bytes, and
2. the manifest's **sha256** of the bundle, checked after download.

The published `manifest.json` is an envelope — `{ payload: base64, signature: base64 }` — for two
reasons: the signature covers bytes rather than a re-serialised object (so signer and verifier cannot
drift on key order), and payload and signature ship as **one asset**, so no publish leaves a window
where a new payload is paired with an old signature.

Self-update is **off unless both `TRM_SELFUPDATE_MANIFEST_URL` and `TRM_SELFUPDATE_PUBLIC_KEY` are
set**. An unconfigured deployment behaves exactly as it did before this existed.

`trm_selfupdate_rejected_total` should stay at **0** — like `trm_security_leak_blocked_total`, alert on
any increase. It means something is serving manifests this deployment's key did not sign.

## Apply, and how it recovers

1. download → digest check → extract → validate. Nothing outside `.trm-ota/` has changed yet.
2. write the web release into the shared volume and flip `current`. nginx follows the symlink at
   `open(2)` per request, so this needs no reload; `previous` keeps serving the old `/assets/` hashes
   for tabs that have not reloaded.
3. write the **journal**, then swap each owned source tree with two `rename()`s (atomic per path,
   same filesystem). `node_modules` is never touched.
4. `app.close()` → `exit(0)`. The container's restart policy brings the new code up.

Web goes before the server so that when the restart drops every socket — which is what makes clients
check their build id — the new bundle is already what nginx serves.

**Where the web bundles live.** The image ships them at **`/usr/share/trm-web`**; `/srv/web` holds
only `releases/<buildId>/`, the `current`/`previous` symlinks, and the `.web-tier` sentinel, and is
the shared volume. Keeping the baked copy _outside_ the mount point is load-bearing, not tidiness:
Docker seeds a named volume from the image only while that volume is still **empty**, so a baked dir
under `/srv/web` would be frozen at the first deploy's bundles for the life of the volume —
`docker-seed-releases.sh` would keep reading that build's `build.json`, and no image pull could ever
move the web tier again.

**Interrupted apply.** `selfupdate/recover.ts` runs from `instrument.mjs`, i.e. before anything
imports the app graph — under ESM the whole graph is evaluated before `bootstrap()`, so a half-swapped
tree would throw on import and the container would loop. Recovery re-runs the swap loop, which is
idempotent because "has this path been swapped?" is answered by whether its staged copy still exists.

**A bundle that cannot boot.** The journal and a `pendingVerify` marker survive until the new build
has stayed up for 60s. Each boot that still sees the marker counts an attempt; the third rolls the
previous trees back and logs loudly. So a bad OTA costs two restarts, not a dead deployment.

## Web clients reload themselves

The web tier serves `/build.json` (`{"buildId": "<commit>"}`, `no-store`), emitted by the Vite build.
A tab compares it against its own baked `VITE_COMMIT_HASH`.

**Compared against the web tier, never against the server's `/version` commitHash.** The two
containers update independently, so there are seconds where the server is on a new commit and nginx
still serves the old bundle — comparing against the server would make every client reload straight
back into the build it was trying to leave, forever.

No new protobuf frame was needed: **an OTA always closes every socket**, so the socket dropping is
itself the notification. Checks fire on app start, on tab focus, on socket `reconnecting`/`closed`,
and on a 60s floor.

| where                                 | action                 |
| ------------------------------------- | ---------------------- |
| home / lobby / replay / not in a game | reload now             |
| in a game, nothing half-entered       | reload now             |
| mid payment or tunnel selection       | wait for it to resolve |
| hidden tab                            | reload on next focus   |

Never a prompt. A reload never loses game state — the server is authoritative and reconnect restores
the seat — so the holds exist only to protect input the server has not seen yet (`useReloadHold`).
A tab reloads at most once per served build id, so a bad `build.json` cannot spin it.

The maintainer dashboard (`/admin/`) is served from the same release but does **not** auto-reload;
it has no `build.json` of its own. Add one the same way if that becomes annoying.

## The image path is fast now too

`apps/server/Dockerfile`'s run stage used to be a single `COPY --from=deps /app /app` — one ~2GB layer
(the root install pulls React Native in) holding `node_modules` **and** source, which every commit
invalidated. So every redeploy re-pulled the whole image. It is now split: a stable layer for
dependencies, `.yarn`, and the font assets, then a ~2MB source layer on top. `ARG GIT_COMMIT` is
declared **after** the COPYs on purpose — above them it would invalidate the stable layer on every
build.

## Setup

**1. Generate the keypair.**

```bash
node tooling/ota/keygen.mjs
```

- `TRM_OTA_SIGNING_KEY` → repo **secret**. Never commit it.
- `TRM_SELFUPDATE_PUBLIC_KEY` → the deployment's env. Public.

**2. Portainer (stack env vars).**

| var                             | value                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `TRM_SELFUPDATE_MANIFEST_URL`   | `https://github.com/<owner>/<repo>/releases/download/server-ota/manifest.json` |
| `TRM_SELFUPDATE_PUBLIC_KEY`     | the public half from step 1                                                    |
| `TRM_SELFUPDATE_WEBHOOK_SECRET` | optional; any random string, lets CI say "check now"                           |
| `TRM_SELFUPDATE_POLL_MS`        | optional; default 30000, `0` disables polling                                  |

The stack must also give **both** the `server` and `web` services the `trm-web-releases` volume at
`/srv/web` (already in `docker-stack.yml`). Without it the server still updates itself and reports
`webOta: "unavailable"`; browser bundles then only change on an image pull.

**3. Portainer stack webhook.** Stack → _Webhooks_ → enable, copy the URL into the repo secret
`PORTAINER_WEBHOOK_URL`. This is the fence-changed path.

**4. Repo config.**

| kind     | name                            | purpose                                            |
| -------- | ------------------------------- | -------------------------------------------------- |
| variable | `TRM_DEPLOY_ORIGIN`             | e.g. `https://trmission.example` — enables routing |
| secret   | `TRM_OTA_SIGNING_KEY`           | signs the manifest                                 |
| secret   | `TRM_SELFUPDATE_WEBHOOK_SECRET` | the "check now" nudge                              |
| secret   | `PORTAINER_WEBHOOK_URL`         | the image-pull path                                |

Every one is optional and degrades safely: no signing key ⇒ the bundle is published unsigned and no
deployment accepts it; no `TRM_DEPLOY_ORIGIN` ⇒ nothing is nudged and deployments rely on their poll;
no Portainer webhook ⇒ CI warns that a fence-changing commit needs a manual redeploy.

## Operating it

```bash
# What is running, and can the next update be an OTA?
curl -s https://<origin>/api/v1/selfupdate/status | jq

# Force a check now (same call CI makes)
curl -sX POST https://<origin>/api/v1/selfupdate/check -H "x-trm-selfupdate-token: <secret>" | jq
```

`status` fields worth knowing: `runningCommit` (the applied bundle, or the image), `imageCommit`,
`depsFingerprint` (this image's fence), `webOta`, `lastResult`, `latest.needsImagePull`,
`pendingVerify` (non-null while an applied bundle is still unproven).

**Roll back one release.** Redeploy the stack from Portainer: a container recreate discards the
container filesystem, so the image's own code is what boots. Then the deployment will re-apply the
newest bundle on its next poll — so to _stay_ off it, publish a fix forward, or unset
`TRM_SELFUPDATE_MANIFEST_URL` first.

**A bundle that crashes on boot** rolls itself back after two failed boots; look for
`[ota] ROLLED BACK` in the logs.

**`needs_image_pull` and nothing happens.** The commit changed dependencies, the Dockerfiles, or the
font assets. That is the fence working. Redeploy the stack (or set `PORTAINER_WEBHOOK_URL` so CI does).

**`webOta: "unavailable"` — the server updates but browsers stay on the old bundle.** The server
cannot see `/srv/web/.web-tier`, the sentinel the nginx container writes at boot, so it refuses to
write releases nobody would serve. The stack is missing the `trm-web-releases:/srv/web` mount on the
**server** service (the web service alone is not enough — both need it, and on Swarm both must land
on the same node, since it is a local volume). The boot log says so explicitly. Add the mount and
redeploy; `status` should then read `"webOta": "ready"`.

**Local dry run.**

```bash
yarn workspace @trm/web build
node tooling/ota/buildBundle.mjs --out dist-ota --commit "$(git rev-parse HEAD)" \
  --web-dist apps/web/dist --admin-dist apps/admin/dist --bundle-url https://example/bundle.tar.gz
```

Prints the bundle size, the fingerprint, and the owned paths. Unsigned without a key, so it cannot be
applied anywhere.
