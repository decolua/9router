#!/bin/bash
# Create symlinks in node_modules so that Node.js ESM resolution finds
# open-sse/ and @/ aliases after vi.resetModules() clears Vite's resolver.
#
# Root cause: vitest 4.x resolve.alias only works during Vite's transform
# pipeline. After vi.resetModules(), dynamic import() falls back to Node.js
# ESM resolution which needs actual node_modules entries.
#
# Run after: npm install (root + tests/)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
NM="$ROOT/node_modules"

mkdir -p "$NM/@"

# open-sse (provider-agnostic routing engine)
ln -sfn "$ROOT/open-sse" "$NM/open-sse"

# @/ aliases → src/ subdirectories
ln -sfn "$ROOT/src/lib"     "$NM/@/lib"
ln -sfn "$ROOT/src/app"     "$NM/@/app"
ln -sfn "$ROOT/src/shared"  "$NM/@/shared"
ln -sfn "$ROOT/src/sse"     "$NM/@/sse"
ln -sfn "$ROOT/src/models"  "$NM/@/models"

echo "✓ Aliases configured: open-sse, @/lib, @/app, @/shared, @/sse, @/models"
