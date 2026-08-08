#!/bin/bash
# Install/uninstall the 9router config receive daemon (macOS launchd).
#
# The daemon polls the private sync repo every N seconds and auto-imports
# configs published for this device (backup → import → restart → health check).
#
# Usage:
#   install-sync-daemon.sh [--interval 60]
#   install-sync-daemon.sh --uninstall
#
# Requires: the 9router CLI on PATH (with `config receive --daemon`).

set -euo pipefail

LABEL="com.9router.config-sync"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/$LABEL.plist"
INTERVAL="${INTERVAL:-60}"

for a in "$@"; do
  case "$a" in
    --uninstall)
      launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
      rm -f "$PLIST"
      echo "✅ Removed $LABEL"
      exit 0
      ;;
    --interval)
      INTERVAL="$2"; shift 2
      ;;
  esac
done

command -v 9router >/dev/null || { echo "❌ 9router CLI not found on PATH" >&2; exit 1; }
CLI="$(command -v 9router)"

mkdir -p "$PLIST_DIR"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CLI</string>
    <string>config</string>
    <string>receive</string>
    <string>--daemon</string>
    <string>--interval</string>
    <string>$INTERVAL</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(npm prefix -g)/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>$HOME/.9router/logs/sync-daemon.log</string>
  <key>StandardErrorPath</key><string>$HOME/.9router/logs/sync-daemon.log</string>
</dict>
</plist>
EOF

mkdir -p "$HOME/.9router/logs"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✅ Installed $LABEL (interval ${INTERVAL}s, CLI: $CLI)"
echo "   Logs: ~/.9router/logs/sync-daemon.log"
echo "   Device: $("$CLI" config device-name)"
