# syntax=docker/dockerfile:1.7
# Multi-stage so the runtime image carries only prod deps + compiled JS.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# curl + ca-certs: the Trading API client shells out to /usr/bin/curl because
# eBay's edge rejects Node's TLS fingerprint when Trading-API headers are
# attached. ca-certs needed for HTTPS verification. See src/domain/ebay/curl.ts.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
