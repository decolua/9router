# 9Router Dockerfile — production-ready
# Защита от падений через node --max-old-space-size + dumb-init

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat curl dumb-init
WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Production stage
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=20128
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Logs dir for crash.log
RUN mkdir -p /app/.9router/logs && chown -R nextjs:nodejs /app/.9router

USER nextjs
EXPOSE 20128

# Healthcheck — uses our /api/health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:20128/api/health || exit 1

# dumb-init — правильный PID 1, ловит zombie и graceful shutdown
ENTRYPOINT ["dumb-init", "--"]

# --max-old-space-size — heap limit
# --enable-source-maps — читаемые стектрейсы в crash.log
CMD ["node", "--max-old-space-size=2048", "--enable-source-maps", "server.js"]