# TRMission server. Build context = repo root (the server consumes workspace
# packages as TypeScript source + generated protobuf). Runs via @swc-node/register
# so NestJS decorator metadata is emitted at runtime.
FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY . .
RUN yarn install --immutable
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
