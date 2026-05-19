#!/usr/bin/env bash
# Install / update the Windsurf language server binary.
#
# Usage:
#   ./install-ls.sh                        # auto: our release → Exafunction fallback
#   ./install-ls.sh /path/to/local.bin     # install a local file
#   ./install-ls.sh --file /path/to.bin    # same as above
#   ./install-ls.sh --url <direct-url>     # install from a custom URL
#
# Auto-detects platform (Linux / macOS) and architecture (x64 / arm64).
# Override install path with LS_INSTALL_PATH env var.
set -euo pipefail

OUR_RELEASE='https://github.com/dwgx/WindsurfAPI/releases/latest/download'
EXAFUNCTION_API='https://api.github.com/repos/Exafunction/codeium/releases/latest'
# v2.0.93: windsurf-linux-server-release extracts LS from official Windsurf desktop builds.
WINDSURF_LS_RELEASE='https://github.com/CaiJingLong/windsurf-linux-server-release/releases/latest/download'

log() { echo -e "\033[1;34m==>\033[0m $*"; }
err() { echo -e "\033[1;31m!!\033[0m  $*" >&2; }

# ─── Platform detection ────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux)
    case "$arch" in
      x86_64|amd64)  ASSET='language_server_linux_x64' ;;
      aarch64|arm64) ASSET='language_server_linux_arm' ;;
      *) err "Unsupported Linux arch: $arch"; exit 1 ;;
    esac
    DEFAULT_PATH="/opt/windsurf/${ASSET}"
    ;;
  Darwin)
    case "$arch" in
      x86_64)        ASSET='language_server_macos_x64' ;;
      arm64)         ASSET='language_server_macos_arm' ;;
      *) err "Unsupported macOS arch: $arch"; exit 1 ;;
    esac
    DEFAULT_PATH="$HOME/.windsurf/${ASSET}"
    ;;
  *)
    err "Unsupported OS: $os (only Linux and macOS are supported)"
    exit 1
    ;;
esac

TARGET="${LS_INSTALL_PATH:-$DEFAULT_PATH}"
log "Platform: $os $arch → asset=$ASSET"
log "Target:   $TARGET"

mkdir -p "$(dirname "$TARGET")"

# Write to a sibling tmp file then atomic-rename onto the target. If the
# target is currently being executed (LS process has it mmap'd as the
# program text), Linux refuses an in-place open(O_WRONLY|O_TRUNC) with
# ETXTBSY ("file busy"). A rename(2), by contrast, just swaps the dirent
# pointer to a new inode — running processes keep their old inode and
# we get a fresh binary in place for the next exec.
TMP_TARGET="${TARGET}.new.$$"
trap 'rm -f "$TMP_TARGET"' EXIT

if [[ $# -gt 0 && "$1" == "--file" && -n "${2:-}" ]]; then
  log "Installing from local file: $2"
  cp -f "$2" "$TMP_TARGET"
elif [[ $# -gt 0 && "$1" != "--url" && "$1" != "--file" && -f "$1" ]]; then
  log "Installing from local file: $1"
  cp -f "$1" "$TMP_TARGET"
elif [[ $# -ge 2 && "$1" == "--url" ]]; then
  url="$2"
  log "Downloading from: $url"
  curl -fL --progress-bar -o "$TMP_TARGET" "$url"
else
  # Try our own GitHub release first (newer than Exafunction)
  our_url="${OUR_RELEASE}/${ASSET}"
  log "Trying WindsurfAPI release: $our_url"
  if curl -fL --progress-bar -o "$TMP_TARGET" "$our_url" 2>/dev/null; then
    log "Downloaded from WindsurfAPI release"
  else
    log "Not found in our release, trying windsurf-linux-server-release..."
    ws_url="${WINDSURF_LS_RELEASE}/${ASSET}"
    if curl -fL --progress-bar -o "$TMP_TARGET" "$ws_url" 2>/dev/null; then
      log "Downloaded from windsurf-linux-server-release (fresh WindSurf build)"
    else
      log "Not found there either, falling back to Exafunction..."
      if command -v jq >/dev/null 2>&1; then
        url="$(curl -fsSL "$EXAFUNCTION_API" | jq -r \
          --arg asset "$ASSET" '.assets[] | select(.name == $asset) | .browser_download_url')"
      else
        url="$(curl -fsSL "$EXAFUNCTION_API" | \
          grep -oE "https://[^\"]+/${ASSET}" | head -1)"
      fi
      if [[ -z "$url" ]]; then
        err "Could not find asset '$ASSET' in any release."
        err "Download manually from Windsurf desktop app:"
        err "  macOS: ~/Library/Application Support/Windsurf/.../bin/$ASSET"
        err "  Linux: ~/.windsurf/bin/$ASSET"
        exit 1
      fi
      log "Downloading: $url"
      curl -fL --progress-bar -o "$TMP_TARGET" "$url"
    fi
  fi
fi

chmod +x "$TMP_TARGET"
mv -f "$TMP_TARGET" "$TARGET"
trap - EXIT
size="$(du -h "$TARGET" | cut -f1)"
if command -v sha256sum >/dev/null 2>&1; then
  sha="$(sha256sum "$TARGET" | cut -c1-16)"
elif command -v shasum >/dev/null 2>&1; then
  sha="$(shasum -a 256 "$TARGET" | cut -c1-16)"
else
  sha="(no sha256 tool)"
fi
log "Installed: $TARGET ($size, sha256:$sha...)"

if [[ "$os" == "Darwin" ]]; then
  log ""
  log "macOS users: set this in your .env:"
  log "  LS_BINARY_PATH=$TARGET"
fi
