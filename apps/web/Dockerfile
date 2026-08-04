# syntax=docker/dockerfile:1
# TRMission web + maintainer dashboard. Build context = repo root. Builds both Vite
# bundles, then serves them from nginx (dashboard under /admin/) with /api + /ws
# proxied to the server service — same origin, so the Strict refresh cookie works
# for both apps.
FROM node:24-slim AS build
ARG GIT_COMMIT=dev
ENV VITE_COMMIT_HASH=$GIT_COMMIT

# Sentry (issue #44). Both bundles are static, so their config is BAKED HERE, not read from the
# container's environment at runtime. A DSN is a public ingest endpoint (not a credential) and is
# meant to ship in the bundle, so it rides in as a plain build arg.
#
# The source-map upload token does NOT: it arrives as a BuildKit secret mounted onto the two build
# steps below, never as an ARG/ENV — a build arg is recorded in the stage's layer metadata and in
# the GitHub Actions build cache, which would leak the token to anyone who can read either. The
# maps themselves are deleted right after upload (vite.config.ts), so they are never served.
# Everything here is optional: unset ⇒ no reporting, no upload, unchanged output.
ARG SENTRY_DSN=
ARG ADMIN_SENTRY_DSN=
ARG SENTRY_ENVIRONMENT=
ARG SENTRY_TRACES_SAMPLE_RATE=
ARG SENTRY_REPLAY_SAMPLE_RATE=
ARG SENTRY_REPLAY_ERROR_SAMPLE_RATE=
ARG SENTRY_ORG=
ARG SENTRY_PROJECT=
ARG SENTRY_ADMIN_PROJECT=
ENV VITE_SENTRY_DSN=$SENTRY_DSN \
    VITE_SENTRY_ENVIRONMENT=$SENTRY_ENVIRONMENT \
    VITE_SENTRY_TRACES_SAMPLE_RATE=$SENTRY_TRACES_SAMPLE_RATE \
    VITE_SENTRY_REPLAY_SAMPLE_RATE=$SENTRY_REPLAY_SAMPLE_RATE \
    VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE=$SENTRY_REPLAY_ERROR_SAMPLE_RATE \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_ADMIN_PROJECT=$SENTRY_ADMIN_PROJECT

WORKDIR /app
RUN corepack enable

# Manifests only, so `yarn install` stays cached across commits that don't touch dependencies —
# a `COPY . .` before install would invalidate this (and every layer after it) on any source
# change. Every workspace's package.json must be listed (yarn needs the full workspace graph to
# validate the lockfile) — add a line here whenever a new package/app/tooling workspace is added.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
COPY apps/admin/package.json apps/admin/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/bots/package.json packages/bots/package.json
COPY packages/client-core/package.json packages/client-core/package.json
COPY packages/codec/package.json packages/codec/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/map-data/package.json packages/map-data/package.json
COPY packages/proto/package.json packages/proto/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY tooling/tsc7/package.json tooling/tsc7/package.json
RUN --mount=type=cache,target=/root/.yarn/berry/cache,sharing=locked \
    yarn install --immutable

COPY . .
RUN yarn workspace @trm/proto generate
# `|| true`: no secret mounted (the normal case for anyone without a Sentry account) leaves the
# token empty, which makes vite.config.ts skip the upload plugin entirely.
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    yarn workspace @trm/web build
# The dashboard is its own Sentry project, so it overrides the DSN for this step only. Otherwise
# admin events would land in the WEB project while admin's source maps upload to the admin one, and
# every admin stack trace would come out unsymbolicated. Its upload target is read separately from
# SENTRY_ADMIN_PROJECT by apps/admin/vite.config.ts, so only the DSN needs overriding here.
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    VITE_SENTRY_DSN="$ADMIN_SENTRY_DSN" \
    yarn workspace @trm/admin build

FROM nginx:alpine AS run
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# The bundles land in /usr/share/trm-web — NOT in nginx's document root, and deliberately NOT under
# /srv/web. Two separate reasons:
#
#   * nginx serves from /srv/web/current, a symlink the server re-points when it applies a web OTA
#     (see nginx.conf and docs/release/server-ota.md).
#   * /srv/web is a VOLUME MOUNT POINT in every real deployment, and Docker copies an image's
#     content into a named volume only while that volume is still EMPTY. Baked under /srv/web, the
#     first deploy's copy would mask every later image's bundles for the life of the volume: the
#     seed script would keep reading the FIRST build's build.json, so `current` could never move and
#     an image pull would stop updating the web tier entirely.
#
# The seed script below makes `current` exist before nginx starts, so an image-only deployment with
# no volume mounted behaves exactly as it did before.
COPY --from=build /app/apps/web/dist /usr/share/trm-web
COPY --from=build /app/apps/admin/dist /usr/share/trm-web/admin
COPY apps/web/docker-seed-releases.sh /docker-entrypoint.d/20-trm-seed-releases.sh
# chmod as its own RUN rather than `COPY --chmod`: nginx's entrypoint skips a non-executable script
# with only a warning, and `--chmod` needs BuildKit, which a `DOCKER_BUILDKIT=0` build won't have.
RUN chmod +x /docker-entrypoint.d/20-trm-seed-releases.sh
EXPOSE 80
