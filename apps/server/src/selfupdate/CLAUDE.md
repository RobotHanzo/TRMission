# `src/selfupdate` — hot code updates (server OTA)

Applies a signed source+web bundle to a running deployment instead of re-pulling a ~2GB image. Full
mechanism, setup and runbook: `docs/release/server-ota.md`. Off unless
`TRM_SELFUPDATE_MANIFEST_URL` **and** `TRM_SELFUPDATE_PUBLIC_KEY` are both set.

| file                    | role                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `layout.ts`             | on-disk paths, state/journal io, the `rename()` swap + revert primitives |
| `manifest.ts`           | fetch + ed25519 verify + zod-validate the manifest envelope              |
| `applier.ts`            | download → digest → extract → web flip → journal → source swap           |
| `recover.ts`            | boot-time repair / rollback, called from `instrument.mjs`                |
| `selfupdate.service.ts` | the poll loop and the OTA-vs-image-pull decision                         |
| `buildInfo.ts`          | the commit `/version` and the Sentry release report                      |

## The four things that will bite you

**The fence is not optional.** A bundle carries source only, so anything that would change
`node_modules`, the images, or the runtime font tree is hashed into the deps fingerprint
(`tooling/ota/depsFingerprint.mjs`, baked into the image by the Dockerfile) and such an update is
**refused**, not applied. If you add an input a bundle cannot carry, add it to `FIXED_INPUTS` /
`FIXED_TREES` — otherwise that change silently never reaches a deployment.

**`layout.ts` and `recover.ts` must stay import-poor.** They run from `instrument.mjs` **before the
app graph loads**, because under ESM the whole graph is evaluated before `bootstrap()` — a
half-swapped tree throws on import and the container just restart-loops. `node:*` and each other,
nothing else. An `import { env }` here can stop a broken deployment from repairing itself.

**The swap loop is idempotent by construction.** "Has this path been swapped?" is answered by whether
its staged copy still exists, so re-running `resumeSwaps` finishes an interrupted apply. Do not add
per-path progress state to the journal — that is the thing that would get out of sync with the
filesystem.

**Order: web release, then source, then restart.** The restart drops every socket, which is what makes
web clients check `/build.json`. Flip the web release first or they look, see the old build, and stay
on it until the next poll.

## Reporting a version

`GIT_COMMIT` is the IMAGE's commit and is wrong after an apply. Everything version-shaped goes through
`buildInfo.ts` — a stale Sentry `release` binds new traces to the previous build's source maps. The
surfaces that report one today are `health.controller.ts` (`/version`, the mobile version gate) and
`dashboard.service.ts` (the overview's server-build row, which the admin app also compares against the
web bundle's build id). Reach for `env.gitCommit` only when you specifically mean the image.

## Tests

`test/selfupdate.spec.ts` covers signature/digest/unsafe-path refusal, swap idempotency, an
interrupted apply, the two-failed-boots rollback, and one end-to-end apply against a real tarball.
