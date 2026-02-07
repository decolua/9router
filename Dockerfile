FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

COPY . ./
RUN npm run build

FROM node:22-bookworm-slim AS runner-base
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0

# Runtime writable location for localDb when DATA_DIR is configured to /app/data
RUN mkdir -p /app/data

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./

EXPOSE 20128

CMD ["node", "server.js"]

FROM runner-base AS runner-cli

# Install commonly used CLIs inside container for portable Docker deployments.
# openclaw depends on git+ssh references, so rewrite to https for non-interactive builds.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system url."https://github.com/".insteadOf "ssh://git@github.com/" \
  && npm install -g --no-audit --no-fund @openai/codex @anthropic-ai/claude-code droid openclaw@latest
