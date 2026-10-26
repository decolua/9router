# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
WORKDIR /app

FROM base AS builder

RUN apk --no-cache upgrade && apk --no-cache add python3 make g++ linux-headers

# QA-9ROUTER-23 — reproducible dependency installs.
# package-lock.json is tracked in this repo, so the lockfile is copied in with
# package.json and `npm ci` installs exactly that resolution (and hard-fails the
# build when the two drift, instead of silently resolving newer versions like
# `npm install` did). No registry override: the build uses the standard npm
# registry, so the image no longer depends on a hardcoded third-party CN mirror
# (an operator can still point a build at a mirror via an .npmrc in the context).
COPY package.json package-lock.json ./
RUN npm ci

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

# QA-9ROUTER-33 — --chown=node:node on every COPY instead of a recursive
# `chown -R /app` afterwards: at HEAD that layer took 140.2s because it walked
# the whole tree (standalone node_modules + src), and under BuildKit the chown
# rewrites every file's metadata, which stalled `exporting to image` entirely
# on the dev box (no servable image). COPY-time chown is per-file metadata set
# at layer creation, no second pass over the image.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/custom-server.js ./custom-server.js
COPY --from=builder --chown=node:node /app/open-sse ./open-sse
# QA-9ROUTER-32 — ship the full src runtime surface. Next file tracing does
# not follow custom-server.js's dynamic imports, so the standalone image only
# ever contained a handful of traced src fragments. The reachable set from
# custom-server.js is: src/lib/federation/{proxy,failover,queue,headers,state,
# startLoops}.js, src/lib/db/driver.js, and src/sse/services/
# backgroundTokenRefresh.js — whose transitive chain additionally needs
# src/sse/utils/logger.js, src/sse/services/tokenRefresh.js, src/lib/localDb.js
# and src/lib/db/repos/connectionsRepo.js. Without these, clean-machine
# deploys died MODULE_NOT_FOUND at boot (QA repro, bunker agent + dev box).
# COPY merges directories with the traced fragments (same bytes, same builder)
# — it does not clobber them.
COPY --from=builder --chown=node:node /app/src ./src
# src/sse/services/* import the provider engine via the bare specifier
# "open-sse/*", which is a build-time alias (jsconfig/next.config). Plain-Node
# ESM resolves bare specifiers through node_modules only, so link the copied
# engine in — without this the backgroundTokenRefresh chain still fails even
# with src/ present (verified with node import probes).
RUN mkdir -p /app/node_modules && ln -s /app/open-sse /app/node_modules/open-sse
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder --chown=node:node /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder --chown=node:node /app/node_modules/next ./node_modules/next
# sql.js loads dist/sql-wasm.wasm by path at runtime; tracing only follows JS imports,
# so the last-resort DB driver would abort with ENOENT on the missing binary.
COPY --from=builder --chown=node:node /app/node_modules/sql.js ./node_modules/sql.js
# node-machine-id is createRequire-loaded at runtime; tracing omits it.
COPY --from=builder --chown=node:node /app/node_modules/node-machine-id ./node_modules/node-machine-id
# QA-9ROUTER-32 — npm deps of the now-shipped src runtime surface. The
# backgroundTokenRefresh -> src/lib/db chain needs uuid at runtime (first
# post-fix boot logged "Cannot find package 'uuid' ... connectionsRepo.js");
# bcryptjs/jose/undici/ora/chalk are the other production deps src/lib imports
# that standalone tracing omits for the same reason (it never followed these
# files). All six are real `dependencies` entries copied from the builder.
COPY --from=builder --chown=node:node /app/node_modules/uuid ./node_modules/uuid
COPY --from=builder --chown=node:node /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=builder --chown=node:node /app/node_modules/jose ./node_modules/jose
COPY --from=builder --chown=node:node /app/node_modules/undici ./node_modules/undici
COPY --from=builder --chown=node:node /app/node_modules/ora ./node_modules/ora
COPY --from=builder --chown=node:node /app/node_modules/chalk ./node_modules/chalk

# QA-9ROUTER-33 — the COPY lines above now carry --chown=node:node, so only
# the runtime-writable paths need chown here. The old `chown -R node:node
# /app` walked the ENTIRE image tree (140.2s at HEAD, then `exporting to
# image` never finished). /root/.9router symlink: the node user's home is
# /home/node, so /root/.9router only matters for root-mode runs; kept as-is.
RUN mkdir -p /app/data /app/data-home && \
  chown node:node /app /app/data /app/data-home && \
  ln -sf /app/data-home /root/.9router 2>/dev/null || true

# Fix permissions at runtime (handles mounted volumes).
# ffmpeg: required by upstream v0.5.111 runtime handlers (codexSttAudio,
# ttsProviders/localDevice) — audio transcoding via ffmpeg child process.
# No dist-upgrade in the runtime image (upstream reproducibility rationale).
RUN apk add --no-cache su-exec ffmpeg && \
  printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
