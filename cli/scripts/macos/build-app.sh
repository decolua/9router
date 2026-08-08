#!/bin/bash
# Build the 9Router macOS menu bar app (Apple Silicon), then package .dmg + .zip.
#
# Bundles: SwiftUI menu bar shell + Node runtime + 9router CLI (with deps).
# Alpha: ad-hoc signed (no Developer ID) — Gatekeeper will warn on other Macs.
#
# Usage:
#   build-app.sh                # build app + dmg + zip into dist/
#   build-app.sh --no-package   # build .app only (faster iteration)
#
# Env:
#   NODE_VERSION   Node version to bundle (default: 22.23.2)
#   CLI_TGZ        Path to a prebuilt 9router CLI tarball (default: build fresh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI_DIR="$REPO_ROOT/cli"

NODE_VERSION="${NODE_VERSION:-22.23.2}"
APP_VERSION="$(node -p "require('$CLI_DIR/package.json').version")"
DIST_DIR="${DIST_DIR:-$REPO_ROOT/dist}"
CACHE_DIR="${CACHE_DIR:-$HOME/.9router/build-cache}"
BUILD_DIR="$DIST_DIR/build"
APP_NAME="9Router"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
PKG_ONLY=0
[[ "${1:-}" == "--no-package" ]] && PKG_ONLY=1

mkdir -p "$DIST_DIR" "$CACHE_DIR"

echo "==> 1/6 Node runtime ($NODE_VERSION arm64)"
NODE_TGZ="$CACHE_DIR/node-v$NODE_VERSION-darwin-arm64.tar.gz"
if [[ ! -f "$NODE_TGZ" ]]; then
  echo "    downloading nodejs.org…"
  curl -fsSL -o "$NODE_TGZ" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-arm64.tar.gz"
fi

echo "==> 2/6 9router CLI tarball"
CLI_TGZ="${CLI_TGZ:-}"
if [[ -z "$CLI_TGZ" || ! -f "$CLI_TGZ" ]]; then
  CLI_TGZ="$DIST_DIR/9router-$APP_VERSION.tgz"
  if [[ ! -f "$CLI_TGZ" ]]; then
    (cd "$CLI_DIR" && npm run build >/dev/null && npm pack --pack-destination "$DIST_DIR" >/dev/null)
  fi
  CLI_TGZ="$(ls -t "$DIST_DIR"/9router-*.tgz | head -1)"
fi

echo "==> 3/6 assembling .app bundle"
rm -rf "$BUILD_DIR"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"

# Swift menu bar shell
swiftc -O -parse-as-library -framework AppKit -framework SwiftUI \
  -o "$APP_BUNDLE/Contents/MacOS/$APP_NAME" \
  "$SCRIPT_DIR/MenuBarApp.swift"

# Info.plist
sed "s|<string>0.5.50</string>|<string>$APP_VERSION</string>|" \
  "$SCRIPT_DIR/Info.plist" > "$APP_BUNDLE/Contents/Info.plist"

# App icon (.icns) from the repo's PWA icon asset
ICON_DIR="$BUILD_DIR/icon-work"
mkdir -p "$ICON_DIR/AppIcon.iconset"
sips -s format png --resampleWidth 1024 "$REPO_ROOT/public/icons/icon-512.svg" \
  --out "$ICON_DIR/AppIcon.iconset/icon_512x512@2x.png" >/dev/null 2>&1 || \
sips -s format png --resampleWidth 1024 "$REPO_ROOT/public/icons/icon-512.svg" \
  --out "$ICON_DIR/app-1024.png" >/dev/null
for px in 16 32 64 128 256 512; do
  sips -s format png --resampleWidth $px "$ICON_DIR/app-1024.png" \
    --out "$ICON_DIR/AppIcon.iconset/icon_${px}x${px}.png" >/dev/null 2>&1
  sips -s format png --resampleWidth $((px * 2)) "$ICON_DIR/app-1024.png" \
    --out "$ICON_DIR/AppIcon.iconset/icon_${px}x${px}@2x.png" >/dev/null 2>&1
done
iconutil -c icns "$ICON_DIR/AppIcon.iconset" -o "$APP_BUNDLE/Contents/Resources/AppIcon.icns"

# Menu bar icon — reuse the CLI's existing tray icon asset
cp "$REPO_ROOT/cli/src/cli/tray/icon.png" "$APP_BUNDLE/Contents/Resources/menubar.png"

# Node runtime — keep bin + lib only (BSD tar: member paths include top dir)
NODE_TOP="node-v$NODE_VERSION-darwin-arm64"
mkdir -p "$APP_BUNDLE/Contents/Resources/node"
tar -xzf "$NODE_TGZ" -C "$APP_BUNDLE/Contents/Resources/node" --strip-components=1 \
  "$NODE_TOP/bin" "$NODE_TOP/lib" "$NODE_TOP/include"
rm -rf "$APP_BUNDLE/Contents/Resources/node/include" \
       "$APP_BUNDLE/Contents/Resources/node/share" 2>/dev/null || true

# 9router CLI
mkdir -p "$APP_BUNDLE/Contents/Resources/9router"
tar -xzf "$CLI_TGZ" -C "$APP_BUNDLE/Contents/Resources/9router" --strip-components=1
(cd "$APP_BUNDLE/Contents/Resources/9router" && \
  NODE="$APP_BUNDLE/Contents/Resources/node/bin/node" && \
  "$NODE" "$APP_BUNDLE/Contents/Resources/node/lib/node_modules/npm/bin/npm-cli.js" \
    install --omit=dev --no-audit --no-fund --no-progress >/dev/null 2>&1 || \
  npm install --omit=dev --no-audit --no-fund --no-progress >/dev/null)

echo "==> 4/6 ad-hoc codesign"
codesign --force --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true

echo "==> 5/6 verify"
if [[ ! -x "$APP_BUNDLE/Contents/MacOS/$APP_NAME" ]]; then
  echo "❌ binary missing" >&2; exit 1
fi
codesign -v "$APP_BUNDLE" >/dev/null 2>&1 && echo "    codesign: ok (ad-hoc)" || true
file "$APP_BUNDLE/Contents/MacOS/$APP_NAME" | sed 's/^/    /'
echo "    bundle: $APP_BUNDLE"
echo "    node:   $("$APP_BUNDLE/Contents/Resources/node/bin/node" --version)"
echo "    cli:    $APP_VERSION"

[[ "$PKG_ONLY" == 1 ]] && { echo "✅ .app built (no package)"; exit 0; }

echo "==> 6/6 packaging .dmg + .zip"
DMG="$DIST_DIR/9Router-$APP_VERSION-arm64.dmg"
ZIP="$DIST_DIR/9Router-$APP_VERSION-arm64.zip"
rm -f "$DMG" "$ZIP"
# Staging dir with an Applications symlink so users can drag-to-install.
STAGE="$BUILD_DIR/dmg-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$APP_BUNDLE" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "9Router $APP_VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
ditto -c -k --keepParent "$APP_BUNDLE" "$ZIP"
echo "✅ $DMG"
echo "✅ $ZIP"
