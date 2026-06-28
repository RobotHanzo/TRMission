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
WORKDIR /app
RUN corepack enable
COPY --from=deps /app /app
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["yarn", "workspace", "@trm/server", "start"]
