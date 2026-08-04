#!/usr/bin/env bash

set -euo pipefail

PROGRAM_NAME="${0##*/}"
TOOL=""
BASE_URL="${NINEROUTER_URL:-}"
API_KEY="${NINEROUTER_KEY:-}"
MODEL="${NINEROUTER_MODEL:-}"
ALLOW_HTTP=0
SKIP_CHECK=0

usage() {
  cat <<EOF
Configure a local AI CLI to use a remote 9Router server.

Usage:
  $PROGRAM_NAME --tool <claude|codex|opencode> --url <url> --model <model> [options]

Options:
  --tool <name>       CLI tool to configure
  --url <url>         Public 9Router URL, with or without /v1
  --api-key <key>     9Router API key (hidden prompt when omitted)
  --model <model>     9Router model or combo ID (prompted when omitted)
  --allow-http        Allow plain HTTP for a non-local server
  --skip-check        Do not validate the key/model against /v1/models
  -h, --help          Show this help

Environment alternatives:
  NINEROUTER_URL, NINEROUTER_KEY, NINEROUTER_MODEL
  NINEROUTER_HOME (optional config-home override, primarily for automation)

Examples:
  $PROGRAM_NAME --tool claude --url https://router.example.com --model combo/auto
  NINEROUTER_KEY=sk_... $PROGRAM_NAME --tool opencode \\
    --url https://router.example.com/v1 --model kr/claude-sonnet-4.5
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

need_value() {
  [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 requires a value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tool)
      need_value "$@"
      TOOL="$2"
      shift 2
      ;;
    --url)
      need_value "$@"
      BASE_URL="$2"
      shift 2
      ;;
    --api-key)
      need_value "$@"
      API_KEY="$2"
      shift 2
      ;;
    --model)
      need_value "$@"
      MODEL="$2"
      shift 2
      ;;
    --allow-http)
      ALLOW_HTTP=1
      shift
      ;;
    --skip-check)
      SKIP_CHECK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

case "$TOOL" in
  claude|codex|opencode) ;;
  "") die "--tool is required" ;;
  *) die "unsupported tool '$TOOL' (use claude, codex, or opencode)" ;;
esac

[ -n "$BASE_URL" ] || die "--url or NINEROUTER_URL is required"
command -v python3 >/dev/null 2>&1 || die "python3 is required to preserve existing CLI settings"

BASE_URL="${BASE_URL%/}"
case "$BASE_URL" in
  */v1) API_URL="$BASE_URL" ;;
  *) API_URL="$BASE_URL/v1" ;;
esac

case "$API_URL" in
  https://*) ;;
  http://localhost:*|http://localhost/*|http://127.0.0.1:*|http://127.0.0.1/*|http://\[::1\]:*|http://\[::1\]/*) ;;
  http://*) [ "$ALLOW_HTTP" -eq 1 ] || die "remote URL must use HTTPS (or pass --allow-http for a trusted network)" ;;
  *) die "--url must start with http:// or https://" ;;
esac

if [ -z "$API_KEY" ]; then
  [ -t 0 ] || die "API key is required; set NINEROUTER_KEY when running non-interactively"
  printf '9Router API key: ' >&2
  IFS= read -r -s API_KEY
  printf '\n' >&2
fi
[ -n "$API_KEY" ] || die "API key cannot be empty"

if [ -z "$MODEL" ]; then
  [ -t 0 ] || die "model is required; set NINEROUTER_MODEL when running non-interactively"
  printf '9Router model or combo ID: ' >&2
  IFS= read -r MODEL
fi
[ -n "$MODEL" ] || die "model cannot be empty"

if [ "$SKIP_CHECK" -eq 0 ]; then
  command -v curl >/dev/null 2>&1 || die "curl is required to validate the remote server"
  RESPONSE_FILE="$(mktemp "${TMPDIR:-/tmp}/9router-models.XXXXXX")"
  trap 'rm -f "$RESPONSE_FILE"' EXIT
  HTTP_STATUS="$(printf 'Authorization: Bearer %s\n' "$API_KEY" | \
    curl --silent --show-error --location \
      --output "$RESPONSE_FILE" --write-out '%{http_code}' \
      --header @- "$API_URL/models")" || die "could not connect to $API_URL"
  [ "$HTTP_STATUS" = "200" ] || die "server returned HTTP $HTTP_STATUS for $API_URL/models"
  python3 - "$RESPONSE_FILE" "$MODEL" <<'PY'
import json
import sys

path, requested = sys.argv[1:]
try:
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"Error: /v1/models returned invalid JSON: {error}")

models = {item.get("id") for item in payload.get("data", []) if isinstance(item, dict)}
if requested not in models:
    raise SystemExit(f"Error: model '{requested}' was not returned by /v1/models")
PY
fi

export NINEROUTER_CONNECT_URL="$API_URL"
export NINEROUTER_CONNECT_KEY="$API_KEY"
export NINEROUTER_CONNECT_MODEL="$MODEL"
export NINEROUTER_CONNECT_HOME="${NINEROUTER_HOME:-$HOME}"

python3 - "$TOOL" <<'PY'
import json
import os
import re
import shutil
import stat
import sys
from datetime import datetime
from pathlib import Path

tool = sys.argv[1]
base_url = os.environ["NINEROUTER_CONNECT_URL"]
api_key = os.environ["NINEROUTER_CONNECT_KEY"]
model = os.environ["NINEROUTER_CONNECT_MODEL"]
home = Path(os.environ["NINEROUTER_CONNECT_HOME"]).expanduser()
stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")


def backup(path):
    if not path.exists():
        return None
    destination = path.with_name(f"{path.name}.9router-backup-{stamp}")
    shutil.copy2(path, destination)
    destination.chmod(stat.S_IRUSR | stat.S_IWUSR)
    return destination


def load_json(path):
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"Error: cannot safely update invalid JSON in {path}: {error}")
    if not isinstance(value, dict):
        raise SystemExit(f"Error: expected a JSON object in {path}")
    return value


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)


backups = []
if tool == "claude":
    path = home / ".claude" / "settings.json"
    config = load_json(path)
    saved = backup(path)
    if saved:
        backups.append(saved)
    env = config.setdefault("env", {})
    if not isinstance(env, dict):
        raise SystemExit(f"Error: expected 'env' to be an object in {path}")
    env.update({
        "ANTHROPIC_BASE_URL": base_url,
        "ANTHROPIC_AUTH_TOKEN": api_key,
        "ANTHROPIC_DEFAULT_OPUS_MODEL": model,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": model,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": model,
        "API_TIMEOUT_MS": "600000",
    })
    config["hasCompletedOnboarding"] = True
    write_json(path, config)

elif tool == "opencode":
    path = home / ".config" / "opencode" / "opencode.json"
    config = load_json(path)
    saved = backup(path)
    if saved:
        backups.append(saved)
    providers = config.setdefault("provider", {})
    if not isinstance(providers, dict):
        raise SystemExit(f"Error: expected 'provider' to be an object in {path}")
    provider = providers.setdefault("9router", {})
    provider.setdefault("npm", "@ai-sdk/openai-compatible")
    provider["options"] = {**provider.get("options", {}), "baseURL": base_url, "apiKey": api_key}
    models = provider.setdefault("models", {})
    models[model] = {
        "name": model,
        "modalities": {"input": ["text", "image"], "output": ["text"]},
    }
    config["model"] = f"9router/{model}"
    write_json(path, config)

else:
    directory = home / ".codex"
    config_path = directory / "config.toml"
    auth_path = directory / "auth.json"
    directory.mkdir(parents=True, exist_ok=True)
    for path in (config_path, auth_path):
        saved = backup(path)
        if saved:
            backups.append(saved)

    content = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    lines = content.splitlines()
    output = []
    section = None
    skip_section = False
    for line in lines:
        match = re.match(r"^\s*\[([^]]+)\]\s*(?:#.*)?$", line)
        if match:
            section = match.group(1).strip()
            skip_section = section in {"model_providers.9router", "agents.subagent"}
            if skip_section:
                continue
        if skip_section:
            continue
        if section is None and re.match(r'^\s*(model|model_provider)\s*=', line):
            continue
        output.append(line)

    escaped_model = model.replace("\\", "\\\\").replace('"', '\\"')
    escaped_url = base_url.replace("\\", "\\\\").replace('"', '\\"')
    top = [f'model = "{escaped_model}"', 'model_provider = "9router"', ""]
    block = [
        "[model_providers.9router]",
        'name = "9Router"',
        f'base_url = "{escaped_url}"',
        'wire_api = "responses"',
        "",
        "[agents.subagent]",
        f'model = "{escaped_model}"',
    ]
    config_path.write_text("\n".join(top + output).rstrip() + "\n\n" + "\n".join(block) + "\n", encoding="utf-8")
    config_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    auth = load_json(auth_path)
    auth.update({"OPENAI_API_KEY": api_key, "auth_mode": "apikey"})
    write_json(auth_path, auth)
    path = config_path

print(f"Configured {tool}: {path}")
for saved in backups:
    print(f"Backup: {saved}")
PY

printf 'Remote endpoint: %s\n' "$API_URL"
printf 'Model: %s\n' "$MODEL"
