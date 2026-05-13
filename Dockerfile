# ==========================================
# STAGE 1: BUILD
# ==========================================
FROM node:22-alpine AS builder

ENV NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm install --silent

COPY . ./

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build


# ==========================================
# STAGE 2: RUNNER (Super Clean, Full Root)
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data

# Copy hasil build
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./

# Copy kebutuhan MITM & Tambahan
COPY --from=builder /app/open-sse ./open-sse
COPY --from=builder /app/src/mitm ./src/mitm
COPY --from=builder /app/src/shared ./src/shared
COPY --from=builder /app/src/lib ./src/lib

# Fix Database
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/sql.js/dist/sql-wasm.wasm ./node_modules/sql.js/dist/sql-wasm.wasm
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge

# healthy check & docker updater
RUN apk add --no-cache curl wget git

# Cukup buat folder data saja, tidak perlu setting user lagi
RUN mkdir -p /app/data /app/data-home

EXPOSE 20128


CMD ["node", "server.js"]