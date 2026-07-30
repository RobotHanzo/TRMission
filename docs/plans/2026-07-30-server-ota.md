# Server OTA — hot code updates without an image pull

Land CI on a running deployment in seconds, without re-downloading a ~1 GB image, and have web
clients pick up the new bundle by themselves (no "a new version is available, reload?" prompt).

## Why this works here

Three existing properties make it cheap:

- **The server runs TS _source_** at runtime (`node --import ./instrument.mjs src/main.ts`, swc
  register — no compile step). A code-only update is "replace files under `apps/`+`packages/`,
  restart the process".
- **The web tier is nginx over static files.** A `dist/` swap needs no restart at all.
- **A restart mid-game is already a supported event** — write-ahead persist, replay, reconnect with
  a re-minted ws ticket (`GameSocket`'s ticket-refresh comment names a server restart as the
  canonical case).

## The fence (the load-bearing decision)

An OTA replaces **source only**. It may never change `node_modules`. So every bundle carries a
**deps fingerprint** — sha256 over `yarn.lock`, every workspace `package.json`, both Dockerfiles,
`.yarnrc.yml`, `.nvmrc` — and the image bakes its own at build time (`/app/.trm-deps-fingerprint`).

- fingerprint **equal** ⇒ hot-apply, no pull.
- fingerprint **differs** ⇒ refuse, report `needsImagePull`, and let the image path run.

This is the same shape as mobile's `runtimeVersion: fingerprint` fencing native changes
(`docs/mobile/ota.md`), and for the same reason: the payload cannot express that kind of change.

## Two paths, one artifact

```
CI (main) ──> build+push images (GHCR)
         └──> publish signed OTA bundle to the rolling `server-ota` prerelease
              │
              ├── fingerprint UNCHANGED → nothing else to do; deployments poll and hot-apply (~30s)
              └── fingerprint CHANGED    → POST the Portainer stack webhook → normal redeploy
```

The deployment runs **Portainer**, so the image path needs no agent and no mounted docker socket:
Portainer's per-stack webhook re-pulls and redeploys on a plain authenticated POST. CI decides which
path applies by reading the live deployment's own fingerprint from
`GET /api/v1/selfupdate/status`, not by diffing git — that stays correct across multi-commit pushes,
reverts, and a deployment that sat out a few releases.

**The server Dockerfile is also re-layered** so the image path is fast too: today the run stage is
one `COPY --from=deps /app /app`, a single layer holding `node_modules` (the root install pulls
React Native in — ~1 GB) _plus_ source, so every commit invalidates all of it. Split into
`node_modules` (stable) + source (a few MB) and a code-only pull moves ~5 MB.

## Distribution & trust

The bundle and `manifest.json` are release assets on a rolling prerelease tag. The repo is public, so
deployments fetch them anonymously over HTTPS — no token on the box.

Hot-loading code into the server process is the most privileged thing in this system, so it is
gated on **both**:

1. an **ed25519 signature** over the canonical manifest bytes (private key = CI secret
   `TRM_OTA_SIGNING_KEY`; public key = `TRM_SELFUPDATE_PUBLIC_KEY` on the deployment), and
2. the manifest's **sha256** of the bundle, checked after download.

**Landed as an envelope, not two files.** `manifest.json` is
`{ payload: base64(canonical), signature: base64 }`. Published as separate assets the pair could not
be swapped atomically, so every release would leave a window where a deployment read a new payload
with an old signature — indistinguishable from tampering, and enough to trip the
alert-on-any-increase rejection metric on every deploy.

**The fence also covers the server's runtime asset tree** (`apps/server/assets`, the OG renderer's
fonts). They are 20MB, read from disk at runtime, and change ~never — the wrong shape for a payload
shipped on every commit. Fencing them keeps the bundle at ~3MB and routes a font change to the image
path automatically, rather than letting an OTA silently leave it behind.

Self-update is **off unless both the manifest URL and the public key are set** — an unconfigured
deployment behaves exactly as it does today.

## Apply (server)

No root-swapping, no launcher shim: extract the verified bundle to `staging/<commit>`, then swap
each owned top-level path with a `rename()` (atomic per path, same filesystem), keeping the outgoing
tree as `prev/<commit>` for rollback. `node_modules` is never touched.

A **journal** written before the first rename makes an interrupted apply recoverable: on boot the
module finishes or reverts the recorded swaps before Nest starts. An applied-but-unverified marker
plus a boot-attempt counter auto-reverts a bundle that cannot boot twice in a row.

Order of operations, so no client ever reloads into a stale bundle:

1. write + flip the **web** release (nginx picks up the symlink per request — no reload needed)
2. swap the **server** source tree
3. `app.close()`, `exit(0)` → the container's restart policy brings the new code up

Web `dist` reaches the nginx container through a shared named volume (`trm-web-releases`); the web
entrypoint seeds it from the baked image when empty, so the image path still works standalone and an
unmounted volume degrades to "web OTA unavailable" rather than silently doing nothing.

## Web clients reload themselves

The web tier serves `/build.json` (`{ "buildId": "<commit>" }`, `no-store`), emitted by the Vite
build. The client compares it against its own baked `VITE_COMMIT_HASH`.

**Compared against the web tier, never against the server's `commitHash`** — the two containers can
be at different revisions for a moment, and comparing against the server would make a client reload
into the same old bundle, forever.

No new proto frame is needed: **an OTA always closes every socket**, so the socket-status change is
itself the nudge. Checks fire on app start, on tab focus, on socket `reconnecting`/`closed`, and on a
60 s floor — sub-second detection in game, no protocol risk.

Reload policy — **landed in `apps/web`, not `@trm/client-core`**: it has no mobile counterpart to
share with (the app updates through expo-updates, which restarts itself; there is no page to reload
and no `/build.json` to compare against), so putting it in the shared core would have been sharing
with nobody. The hold points are `apps/web`'s own payment/tunnel state:

| where                                   | action                 |
| --------------------------------------- | ---------------------- |
| home / lobby / replay / not in a game   | reload now             |
| in a game, nothing half-entered         | reload now             |
| mid payment / tunnel / ticket selection | wait for it to resolve |
| hidden tab                              | reload on next focus   |

Never a prompt. Nothing is lost either way — reconnect + snapshot restores the seat.

## Deliverables

1. `tooling/ota/{depsFingerprint,buildBundle,keygen}.mjs` — dependency-free node scripts.
2. Server Dockerfile re-layered and baking `.trm-deps-fingerprint`.
3. `apps/web`: `build.json` emitted by the Vite build; nginx roots at a swappable release dir with a
   previous-assets fallback; entrypoint seeds the volume.
4. `apps/server/src/selfupdate/` — manifest verify, applier + journal recovery, poll loop, REST
   (`GET status`, `POST check` with an HMAC-authenticated webhook), metrics.
5. OTA-aware build info: `/version` and the Sentry release report the **applied** commit, not the
   image's `GIT_COMMIT`.
6. `apps/web` build-version store + poller + safe-boundary holds (not client-core — see above).
7. CI: publish the signed bundle (dists lifted out of the pushed web image, so bundle and image are
   byte-identical); POST the Portainer webhook only when the fingerprint moved.
8. compose/stack wiring, `docs/release/server-ota.md`, `CLAUDE.md` updates.
