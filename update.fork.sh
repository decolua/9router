#!/usr/bin/env bash
# Custom update script for 9router - builds from audioscavenger/9router fork
# Usage: /usr/bin/update.fork [branch|tag]  (default: lxc-maintenance)

set -euo pipefail

APP="9Router"
REPO="audioscavenger/9router"
BRANCH="${1:-lxc-maintenance}"
INSTALL_DIR="/usr/lib/node_modules/9router"
BUILD_DIR="/tmp/9router-build-$$"

log_info() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
log_ok() { echo -e "\033[1;32m[OK]\033[0m $*"; }
log_error() { echo -e "\033[1;31m[ERROR]\033[0m $*"; }

# Check if running as root
if [[ $EUID -ne 0 ]]; then
  log_error "Must run as root"
  exit 1
fi

# Verify Node.js version (need >=20.18)
NODE_VER=$(node -v | sed 's/v//')
NODE_MAJOR=${NODE_VER%%.*}
if [[ $NODE_MAJOR -lt 20 ]]; then
  log_error "Node.js >=20 required, found v$NODE_VER"
  exit 1
fi
log_info "Using system Node.js v$NODE_VER"


# Stop service
log_info "Stopping $APP..."
systemctl stop 9router 2>/dev/null || true
log_ok "Stopped"

# Clone/update fork
log_info "Fetching $REPO@$BRANCH..."
rm -rf "$BUILD_DIR"
git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$BUILD_DIR"
cd "$BUILD_DIR"
log_ok "Source ready at $(git log -1 --oneline)"

# Install deps & build
log_info "Installing dependencies (including devDeps for build)..."
npm install --legacy-peer-deps --include=dev 2>&1
log_info "Installing CLI build dependencies..."
npm --prefix cli install --include=dev --legacy-peer-deps 2>&1 | tail -3
log_ok "Dependencies installed"

log_info "Building Next.js app (limiting workers to avoid freeze)..."
export NODE_OPTIONS="--max-old-space-size=2048"
export NEXT_BUILD_WORKERS=2
npm run build 2>&1
log_ok "Next.js build complete"

log_info "Building CLI package..."
npm --prefix cli run pack:cli 2>&1
log_ok "CLI package built"

# Find and install the tarball
TGZ=$(find . -maxdepth 1 -name "9router-*.tgz" | head -1)
if [[ -z "$TGZ" ]]; then
  log_error "CLI tarball not found"
  exit 1
fi
log_info "Installing $TGZ..."
npm install -g --ignore-scripts "$TGZ"
log_ok "Installed globally"

# Restart service
log_info "Starting $APP..."
systemctl start 9router
log_ok "Started"

# Cleanup
cd /
rm -rf "$BUILD_DIR"
log_ok "Update complete! Version: $(jq -r '.version' "$INSTALL_DIR/package.json")"