# syntax=docker/dockerfile:1.7
ARG BUN_IMAGE=oven/bun:1.3.2-alpine
FROM ${BUN_IMAGE} AS base
WORKDIR /app

FROM base AS builder

RUN apk --no-cache upgrade && apk --no-cache add nodejs npm python3 make g++ linux-headers

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm install

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${BUN_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge

RUN mkdir -p /app/data && chown -R bun:bun /app

# Fix permissions at runtime (handles mounted volumes)
RUN apk --no-cache upgrade && apk --no-cache add su-exec && \
  printf '#!/bin/sh\nchown -R bun:bun /app/data 2>/dev/null\nexec su-exec bun "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "server.js"]
