# syntax=docker/dockerfile:1
# TRMission web + maintainer dashboard. Build context = repo root. Builds both Vite
# bundles, then serves them from nginx (dashboard under /admin/) with /api + /ws
# proxied to the server service — same origin, so the Strict refresh cookie works
# for both apps.
FROM node:24-slim AS build
ARG GIT_COMMIT=dev
ENV VITE_COMMIT_HASH=$GIT_COMMIT
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
RUN yarn workspace @trm/web build
RUN yarn workspace @trm/admin build

FROM nginx:alpine AS run
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 80
