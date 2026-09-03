# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine
ARG BUN_IMAGE=oven/bun:1.4-alpine
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

RUN apk --no-cache upgrade && apk --no-cache add python3 make g++ linux-headers

COPY package.json bun.lock* package-lock.json* ./
# Use npm for deterministic build (better-sqlite3 optional dep compiles reliably on Node)
RUN --mount=type=cache,target=/root/.npm \
    if [ -f bun.lock ]; then npm install --include=optional; else npm install; fi

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
# Build with Node (webpack) - produces standalone output
RUN npm run build

FROM ${BUN_IMAGE} AS runner
WORKDIR /app
RUN apk --no-cache add su-exec wget

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/custom-server.js ./custom-server.js
COPY --from=builder /app/open-sse ./open-sse
COPY --from=builder /app/src/mitm ./src/mitm
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
COPY --from=builder /app/node_modules/next ./node_modules/next
COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js
# node-machine-id is createRequire-loaded at runtime; tracing omits it.
COPY --from=builder /app/node_modules/node-machine-id ./node_modules/node-machine-id

# Install Bun deps for runtime (better-sqlite3 not needed - Bun uses bun:sqlite, but keep sql.js)
# Ensure bun can run the standalone server (which is plain JS, no native deps needed)
RUN mkdir -p /app/data /app/data-home && \
    ln -sf /app/data-home /root/.9router 2>/dev/null || true && \
    mkdir -p /app/data && chown -R 1000:1000 /app 2>/dev/null || true

COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
# Bun is the mandatory runtime per migration task
CMD ["bun", "custom-server.js"]