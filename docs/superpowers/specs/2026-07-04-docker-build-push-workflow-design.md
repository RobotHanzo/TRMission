# Docker build & push workflow

## Purpose

On every push to `main`, build the two production Docker images (`server`, `web`) and push them to
GitHub Container Registry (GHCR), so a deployable, traceable image always exists for the latest
`main` commit.

## Trigger

`push` to `main`, filtered to paths that can affect the images: `apps/**`, `packages/**`,
`yarn.lock`, and the workflow file itself. Doc-only or unrelated commits don't trigger a build.

## Jobs

One job, matrixed over the two images so they build in parallel:

| image  | Dockerfile               | build context | pushed as                                                                                               |
| ------ | ------------------------ | ------------- | ------------------------------------------------------------------------------------------------------- |
| server | `apps/server/Dockerfile` | repo root     | `ghcr.io/robothanzo/trmission-server`                                                                   |
| web    | `apps/web/Dockerfile`    | repo root     | `ghcr.io/robothanzo/trmission-web` (also bundles the maintainer dashboard, per the existing Dockerfile) |

## Registry & auth

GHCR (`ghcr.io`). Login via `docker/login-action` using `github.actor` and the built-in
`GITHUB_TOKEN` — the job needs `permissions: packages: write`. No repo secrets required.

## Tagging

Via `docker/metadata-action`:

- `latest`
- `sha-<short-sha>` — immutable, traceable back to the exact commit

## Build

`docker/build-push-action`, `platforms: linux/amd64` only (no arm64 — keeps builds fast; can be
added later if an ARM deployment target shows up). GitHub Actions layer cache
(`cache-from`/`cache-to: type=gha`), scoped per image via the matrix, since both Dockerfiles run a
full `yarn install --immutable`.

## Concurrency

`concurrency: group: docker-${{ matrix.image }}-${{ github.ref }}, cancel-in-progress: true` so a
rapid string of pushes to `main` doesn't queue up stale builds.

## Out of scope

- No deployment step (this workflow only builds and pushes images).
- No multi-arch (amd64 only, per above).
- No image scanning/signing — can be added later as a separate concern.
