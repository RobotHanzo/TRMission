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
# CJK + latin fonts for the dynamically rendered social-preview cards (resvg loads
# system fonts; without a TC face the zh-Hant card text would render as tofu boxes).
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app /app
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["yarn", "workspace", "@trm/server", "start"]
