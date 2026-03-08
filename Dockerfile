FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

COPY . ./
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="egs-proxy-ai"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0

# Runtime writable dir for DATA_DIR, tunnel state, etc.
RUN mkdir -p /app/data /app/bin

# Cloudflare Tunnel (cloudflared) for optional remote access from dashboard
ARG TARGETARCH
RUN case "$TARGETARCH" in \
    amd64) CF_ARCH=amd64 ;; \
    arm64) CF_ARCH=arm64 ;; \
    *) CF_ARCH=amd64 ;; \
    esac \
    && wget -q -O /tmp/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
    && mv /tmp/cloudflared /app/bin/cloudflared \
    && chmod +x /app/bin/cloudflared

# App runtime (Next.js standalone)
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/open-sse ./open-sse

# Migrations and entrypoint (migrate on start when DATABASE_URL is set)
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

# Ensure pg is available for scripts/db/migrate.js (standalone may not include it)
COPY --from=builder /app/package.json ./
RUN npm install pg --omit=dev --no-save --ignore-scripts

EXPOSE 20128

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
