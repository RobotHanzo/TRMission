# TRMission web + maintainer dashboard. Build context = repo root. Builds both Vite
# bundles, then serves them from nginx (dashboard under /admin/) with /api + /ws
# proxied to the server service — same origin, so the Strict refresh cookie works
# for both apps.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN yarn install --immutable
RUN yarn workspace @trm/proto generate
RUN yarn workspace @trm/web build
RUN yarn workspace @trm/admin build

FROM nginx:alpine AS run
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html/admin
EXPOSE 80
