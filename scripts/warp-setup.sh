#!/usr/bin/env bash
# warp-setup.sh — download wgcf + wireproxy for the 9router WARP hop engine.
# Run once on the machine that runs 9router (Crostini, VPS, any Linux).
#
#   bash scripts/warp-setup.sh
#
# Binaries land in "$DATA_DIR/warp/bin" (DATA_DIR defaults to ~/.9router,
# matching src/lib/dataDir.js). The 9router dashboard creates the WARP pool:
# Proxy Pools → WARP → save → bind it to a connection (e.g. OpenCode Free).
set -euo pipefail

DATA_DIR="${DATA_DIR:-$HOME/.9router}"
BIN_DIR="$DATA_DIR/warp/bin"
mkdir -p "$BIN_DIR"

case "$(uname -m)" in
  x86_64)  ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
[ "$OS" = "linux" ] || { echo "This script targets Linux (Crostini/VPS)." >&2; exit 1; }

fetch_latest_asset() { # repo regex → url
  curl -fsSL "https://api.github.com/repos/$1/releases/latest" \
    | grep -oE "https://[^\" ]+$2" | head -n1
}

echo "==> wgcf"
WGCF_URL="$(fetch_latest_asset ViRb3/wgcf "wgcf_[0-9.]+_${OS}_${ARCH}$")"
[ -n "$WGCF_URL" ] || { echo "No wgcf asset for ${OS}/${ARCH}" >&2; exit 1; }
curl -fsSL "$WGCF_URL" -o "$BIN_DIR/wgcf"
chmod +x "$BIN_DIR/wgcf"

echo "==> wireproxy"
WIREPROXY_URL="$(fetch_latest_asset pufferffish/wireproxy "wireproxy_${OS}_${ARCH}\.tar\.gz$")"
[ -n "$WIREPROXY_URL" ] || { echo "No wireproxy asset for ${OS}/${ARCH}" >&2; exit 1; }
curl -fsSL "$WIREPROXY_URL" -o /tmp/wireproxy.tar.gz
tar -xzf /tmp/wireproxy.tar.gz -C "$BIN_DIR" wireproxy
chmod +x "$BIN_DIR/wireproxy"
rm -f /tmp/wireproxy.tar.gz

"$BIN_DIR/wgcf" --version || true
"$BIN_DIR/wireproxy" --version || true

cat <<EOF

Done. Next steps:
  1. Start 9router, open the dashboard → Proxy Pools → "WARP"
     (first use registers a free WARP account automatically).
  2. Bind that pool to a connection (e.g. OpenCode Free) and keep
     Strict Proxy + Auto Hop on.
  3. Optional: check egress with
     curl -x http://127.0.0.1:42901 https://www.cloudflare.com/cdn-cgi/trace
EOF
