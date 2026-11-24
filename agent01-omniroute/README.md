# Agent 01 — OmniRoute + Superpowers bridge

A small, dependency-free Python client for an **authorized running OmniRoute gateway**. It uses OmniRoute's OpenAI-compatible `/v1/models` and `/v1/chat/completions` interfaces. Agent 01 carries the Superpowers plan–test–debug–review methodology. The GitHub Actions workflow does **offline checks daily**; this is not a 24/7 LLM agent.

## What is working now

- Python client: read model catalog, make an AI completion over a configured OmniRoute endpoint.
- Safety: HTTPS required for remote gateways, no URL-embedded credentials, no redirects, no outbound calls without a key, no execution tools or shell calls. Loopback-only HTTP supported.
- Unit tests: mock OmniRoute HTTP endpoints, validates request format and blocks unsafe configurations.
- Zero-cost scheduled GitHub Actions QA (subject to GitHub plan limits), after workflow is merged to the repository default branch and GitHub Actions is enabled.

## Android Termux local gateway setup

From this directory run `bash run-termux.sh`. It installs Node.js, Python and **official** `omniroute` via npm then runs its dashboard bound to loopback (`127.0.0.1:20128`). Initial npm installation needs internet. Add an actual permitted model provider in the OmniRoute dashboard; free tiers may have quotas. Create your own *local* API key in the dashboard (never paste it into chat). In a **second** Termux session:

```bash
export OMNIROUTE_API_KEY='key-from-your-own-dashboard'
export OMNIROUTE_BASE_URL='http://127.0.0.1:20128'
python agent01.py probe
python agent01.py run 'Plan my highest-value next software deliverable and its tests'
```

If enabling MCP over the local HTTP server, run `omniroute mcp enable --transport streamable-http` (after server startup) or use its Dashboard → MCP settings. For a remote MCP gateway, do **not** open ports without authenticated TLS and tested firewall rules.

## Linux/server installation

With Node.js 22+ and Python 3.10+, install official OmniRoute from its publisher (`npm install -g omniroute`). Set `OMNIROUTE_MCP_ENFORCE_SCOPES=true`, `MCP_TOOL_ALLOW=...` as shown in `.env.example`, and run `omniroute` **behind an authenticated reverse proxy or only on loopback**. Local `HTTP` is allowed only on loopback; external access must have TLS and authentication.

## Remote MCP security checklist

1. Keep the dashboard and MCP HTTP service local-only until TLS, firewall, access logs and authorization are configured; do **not** create a public unauthenticated tunnel.
2. In OmniRoute, enable MCP streamable HTTP and `OMNIROUTE_MCP_ENFORCE_SCOPES=true` on the gateway process. Enforcement is opt-in in current documentation.
3. Create a *dedicated scoped* API key for the MCP client, e.g. `mcp:connect`, `read:health`, `read:quota`, `read:models`, `read:usage`, `execute:completions` only if it is required. `mcp:connect` provides remote MCP access without granting broad `manage`; test with your installed version. Do not use admin keys for autonomous tasks.
4. Expose the MCP URL `https://YOUR-HOST/api/mcp/stream` only through a properly authenticated HTTPS reverse proxy; keep the provider dashboard private and deny all other external endpoints wherever possible.
5. Start with tool allowlist `omniroute_get_health,omniroute_check_quota,omniroute_list_models_catalog,omniroute_cost_report,omniroute_route_request`, and verify the actual `tools/list` and denial of unauthorized tools.
6. Use provider budget caps, disabled paid fallbacks by default, audit logging, key rotation, and per-provider quotas. Avoid deploying on short-lived serverless hosts that cannot maintain OmniRoute's persistent gateway.
7. Do not set an MCP remote server address in camelRun until the URL and its auth scope are available. camelRun's own $0 balance still blocks its runs even if OmniRoute is connected: use this independent runner instead.

## Self-test and troubleshooting

`python -m unittest -v test_agent01.py` does not need any AI tokens. A real `probe` requires a running OmniRoute gateway and an API key; a real `run` additionally requires an available model provider. This project **does not** replace the OmniRoute server, silently connect accounts, overcome paywalls or provide free unlimited AI tokens.

Official references: https://github.com/marcpadz/omniroute and https://github.com/obra/superpowers