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
# The server-OTA fence, computed from this image's own files so a locally-built image is fenced
# exactly like a CI one (docs/release/server-ota.md). src/selfupdate reads it at boot and refuses any
# bundle whose fingerprint differs — that is what guarantees an OTA never has to change node_modules.
RUN node tooling/ota/depsFingerprint.mjs > /app/.trm-deps-fingerprint

# Re-layering stage. Everything that changes only when DEPENDENCIES change is moved aside so the run
# stage can COPY it as its own layer, ahead of the ~2MB source layer. Before this split the run stage
# was a single `COPY --from=deps /app /app` — one ~2GB layer that every commit invalidated, so every
# redeploy re-pulled the entire image. That is the cost the OTA path exists to avoid, and it is also
# what makes the fallback image pull (deps changed ⇒ Portainer webhook) land in seconds.
FROM deps AS layout
RUN set -eu; \
    mkdir -p /stable; \
    mv /app/node_modules /stable/node_modules; \
    mv /app/.yarn /stable/.yarn; \
    for dir in /app/apps/* /app/packages/* /app/tooling/*; do \
      [ -d "$dir/node_modules" ] || continue; \
      target="/stable${dir#/app}"; \
      mkdir -p "$target"; \
      mv "$dir/node_modules" "$target/node_modules"; \
    done; \
    mkdir -p /stable/apps/server; \
    mv /app/apps/server/assets /stable/apps/server/assets

FROM node:24-slim AS run
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
ENV PORT=3001
# No system font packages needed: the social-preview cards (src/og/) hand resvg its own
# bundled font files (apps/server/assets/fonts, loadSystemFonts: false) instead of relying
# on whatever the image happens to have installed. Those fonts are ~20MB and change ~never, so they
# ride in this stable layer and are covered by the fence rather than shipped in every OTA bundle.
COPY --from=layout /stable/ ./
COPY --from=layout /app/ ./
# LAST, deliberately: an ARG/ENV layer invalidates everything below it, so putting the per-commit
# commit hash above the COPYs would rebuild and re-push the ~2GB stable layer on every single build.
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
EXPOSE 3001
CMD ["yarn", "workspace", "@trm/server", "start"]
