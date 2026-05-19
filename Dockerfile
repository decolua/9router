# syntax=docker/dockerfile:1.7
# Debian slim (glibc), not Alpine (musl): the Windsurf LS binary spawned
# by the Devin executor is glibc-linked and crashes on startup under
# musl, which surfaces as `LS port 42100 not ready after 30000ms` from
# open-sse/executors/devin-vendor/ls-manager.js.
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS base
WORKDIR /app

FROM base AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm install

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

# gosu = Debian equivalent of Alpine's su-exec; ca-certificates is
# required for the LS install download (HTTPS to GitHub releases).
RUN apt-get update && apt-get install -y --no-install-recommends \
      gosu ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder /app/node_modules/next ./node_modules/next

# ls-install.js writes the LS binary under `os.homedir()/.9router/ls`.
# Symlink for both /root (pre-drop) and /home/node (post-drop) so the
# install survives the gosu privilege drop in the entrypoint.
RUN mkdir -p /app/data /app/data-home \
    && chown -R node:node /app \
    && ln -sf /app/data-home /home/node/.9router \
    && ln -sf /app/data-home /root/.9router

# Entrypoint fixes mounted-volume perms as root, then drops to node.
RUN printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec gosu node "$@"\n' > /entrypoint.sh \
    && chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
