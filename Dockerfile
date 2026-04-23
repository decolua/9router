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
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
# Puppeteer + Stealth for Token Scheduler auto-recovery (serverExternalPackages)
COPY --from=builder /app/node_modules/@puppeteer ./node_modules/@puppeteer
COPY --from=builder /app/node_modules/puppeteer ./node_modules/puppeteer
COPY --from=builder /app/node_modules/puppeteer-core ./node_modules/puppeteer-core
COPY --from=builder /app/node_modules/puppeteer-extra ./node_modules/puppeteer-extra
COPY --from=builder /app/node_modules/puppeteer-extra-plugin ./node_modules/puppeteer-extra-plugin
COPY --from=builder /app/node_modules/puppeteer-extra-plugin-stealth ./node_modules/puppeteer-extra-plugin-stealth
COPY --from=builder /app/node_modules/puppeteer-extra-plugin-user-data-dir ./node_modules/puppeteer-extra-plugin-user-data-dir
COPY --from=builder /app/node_modules/puppeteer-extra-plugin-user-preferences ./node_modules/puppeteer-extra-plugin-user-preferences
# Puppeteer transitive dependencies
COPY --from=builder /app/node_modules/chromium-bidi ./node_modules/chromium-bidi
COPY --from=builder /app/node_modules/cosmiconfig ./node_modules/cosmiconfig
COPY --from=builder /app/node_modules/deepmerge ./node_modules/deepmerge
COPY --from=builder /app/node_modules/devtools-protocol ./node_modules/devtools-protocol
COPY --from=builder /app/node_modules/merge-deep ./node_modules/merge-deep
COPY --from=builder /app/node_modules/typed-query-selector ./node_modules/typed-query-selector
COPY --from=builder /app/node_modules/ws ./node_modules/ws

RUN mkdir -p /app/data && chown -R bun:bun /app

# Install Chromium + deps for Puppeteer auto-recovery, fix permissions at runtime
RUN apk --no-cache upgrade && apk --no-cache add su-exec chromium nss freetype harfbuzz ca-certificates ttf-freefont && \
  printf '#!/bin/sh\nchown -R bun:bun /app/data 2>/dev/null\nexec su-exec bun "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "server.js"]
