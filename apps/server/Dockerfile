# syntax=docker/dockerfile:1
# TRMission server. Build context = repo root (the server consumes workspace
# packages as TypeScript source + generated protobuf). Runs via @swc-node/register
# so NestJS decorator metadata is emitted at runtime.
FROM node:24-slim AS deps
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

FROM node:24-slim AS run
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
WORKDIR /app
RUN corepack enable
# No system font packages needed: the social-preview cards (src/og/) hand resvg its own
# bundled font files (apps/server/assets/fonts, loadSystemFonts: false) instead of relying
# on whatever the image happens to have installed.
COPY --from=deps /app /app
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["yarn", "workspace", "@trm/server", "start"]
