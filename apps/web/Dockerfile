# TRMission web. Build context = repo root. Builds the Vite bundle, then serves it
# from nginx with /api + /ws proxied to the server service.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN yarn install --immutable
RUN yarn workspace @trm/proto generate
RUN yarn workspace @trm/web build

FROM nginx:alpine AS run
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
