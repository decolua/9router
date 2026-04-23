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

# Trace all transitive deps of puppeteer packages (serverExternalPackages)
RUN node -e " \
const {execSync} = require('child_process'); \
const {readFileSync, existsSync, mkdirSync} = require('fs'); \
const path = require('path'); \
const dest = '/puppeteer-deps/node_modules'; \
mkdirSync(dest, {recursive: true}); \
const visited = new Set(); \
function copyPkg(name) { \
  if (visited.has(name)) return; \
  visited.add(name); \
  const src = path.join('/app/node_modules', name); \
  if (!existsSync(src)) return; \
  const d = path.join(dest, name); \
  mkdirSync(path.dirname(d), {recursive: true}); \
  execSync('cp -r ' + JSON.stringify(src) + ' ' + JSON.stringify(d)); \
  try { \
    const pkg = JSON.parse(readFileSync(path.join(src, 'package.json'), 'utf8')); \
    Object.keys(pkg.dependencies || {}).forEach(dep => copyPkg(dep)); \
  } catch(e) {} \
} \
['@puppeteer','puppeteer','puppeteer-core','puppeteer-extra', \
 'puppeteer-extra-plugin','puppeteer-extra-plugin-stealth', \
 'puppeteer-extra-plugin-user-data-dir','puppeteer-extra-plugin-user-preferences' \
].forEach(copyPkg); \
console.log('Puppeteer deps traced:', visited.size, 'packages'); \
"

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
# Puppeteer + Stealth — auto-trace all transitive deps from builder
COPY --from=builder /puppeteer-deps/node_modules/ ./node_modules/

RUN mkdir -p /app/data && chown -R bun:bun /app

# Install Chromium + deps for Puppeteer auto-recovery, fix permissions at runtime
RUN apk --no-cache upgrade && apk --no-cache add su-exec chromium nss freetype harfbuzz ca-certificates ttf-freefont && \
  printf '#!/bin/sh\nchown -R bun:bun /app/data 2>/dev/null\nexec su-exec bun "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "server.js"]
