#!/bin/bash
# install-mux.sh
TARGET_DIR="${1}"
UPDATE="${2:-true}"

set -e

echo "Starting Mux Installer Script..."
echo "Target Directory: $TARGET_DIR"
echo "Update: $UPDATE"

# 1. Clone or Pull
if [ ! -d "$TARGET_DIR" ]; then
    echo "Cloning Mux repository..."
    git clone https://github.com/coder/mux.git "$TARGET_DIR"
else
    if [ -d "$TARGET_DIR/.git" ]; then
        if [ "$UPDATE" = "true" ]; then
            echo "Pulling latest changes from GitHub..."
            cd "$TARGET_DIR"
            git pull
        else
            echo "Using existing local codebase (skipping git pull)..."
        fi
    else
        echo "Detecting corrupt target directory. Re-creating..."
        rm -rf "$TARGET_DIR"
        git clone https://github.com/coder/mux.git "$TARGET_DIR"
    fi
fi

# 2. Install dependencies
echo "Installing dependencies..."
cd "$TARGET_DIR"

if [ -d "node_modules" ]; then
    echo "Cleaning up previous node_modules..."
    rm -rf node_modules
fi

if npm install --legacy-peer-deps --no-audit --no-fund; then
    echo "Dependencies installed via npm."
else
    echo "npm install failed. Falling back to Bun..."
    bun install
fi

# 3. Build Mux
echo "Building Mux CLI & Web UI..."
mkdir -p dist

# Version file
echo 'export const VERSION = { git_describe: "0.26.1" };' > src/version.ts

# Compile bundles
bun x esbuild src/cli/api.ts --bundle --format=esm --platform=node --outfile=dist/cli/api.mjs
bun x tsc -p tsconfig.main.json
bun x tsc-alias -p tsconfig.main.json
bun x vite build

# Static assets
if [ -f "static/splash.html" ]; then
    cp static/splash.html dist/splash.html
fi
if [ -d "public" ]; then
    cp -r public/* dist/
fi

echo "Mux Build Completed successfully!"
