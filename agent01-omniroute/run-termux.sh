#!/usr/bin/env bash
set -euo pipefail
if ! command -v pkg >/dev/null 2>&1; then
  echo "Install and run in Android Termux" >&2; exit 1
fi
pkg install -y nodejs-lts python
npm install -g omniroute
export HOSTNAME=127.0.0.1 PORT=20128
export OMNIROUTE_MCP_ENFORCE_SCOPES=true
export MCP_TOOL_ALLOW=omniroute_get_health,omniroute_check_quota,omniroute_list_models_catalog,omniroute_cost_report,omniroute_route_request
exec omniroute
