# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
WORKDIR /app

# Stage: dependencies (cached layer — only rebuilds when package.json changes)
FROM base AS deps
RUN apk --no-cache upgrade && apk --no-cache add python3 make g++ linux-headers
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  --mount=type=cache,target=/app/node_modules \
  npm ci

# Stage: development (hot reload, debug tools)
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 20128 9229
CMD ["npm", "run", "dev"]

# Stage: build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,target=/app/.next/cache npm run build

# Stage: production (minimal image)
FROM ${NODE_IMAGE} AS production
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

COPY --from=build /app/public ./public
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/custom-server.js ./custom-server.js
COPY --from=build /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=build /app/src/mitm ./src/mitm
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=build /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=build /app/node_modules/next ./node_modules/next

RUN mkdir -p /app/data && chown -R node:node /app && \
  mkdir -p /app/data-home && chown node:node /app/data-home && \
  ln -sf /app/data-home /root/.9router 2>/dev/null || true

# Fix permissions at runtime (handles mounted volumes)
RUN apk --no-cache upgrade && apk --no-cache add su-exec && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:20128/dashboard || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
