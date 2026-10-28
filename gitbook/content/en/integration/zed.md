# Zed Integration

Use 9Router inside [Zed](https://zed.dev) — either as the model backend for Zed's built-in agent, or through the **Agent Client Protocol (ACP)** so Zed gets 9Router's model picker, tools and fallbacks as a first-class External Agent.

## Prerequisites

- 9Router running locally (`9router`) or a remote 9Router server
- [Zed](https://zed.dev/download) editor
- API key from the 9Router dashboard (or created during setup)

## Quick setup

```bash
npx 9router connect zed
```

This writes `~/.config/zed/settings.json` for you:

- `language_models.openai_compatible.router9` — the 9Router endpoint pre-filled with your tool-capable models (combos first, capped at 25)
- `agent_servers.9router` — registers the 9Router ACP agent (`9router acp`)

It then prints the environment variable to export:

```bash
export ROUTER9_API_KEY=sk-...
```

Undo everything with:

```bash
npx 9router connect --reset --tools zed
```

## Path A — Zed Agent (native, no ACP)

Zed's built-in agent uses the `openai_compatible` provider written by `connect zed`:

```json
{
  "language_models": {
    "openai_compatible": {
      "router9": {
        "api_url": "http://localhost:20128/v1",
        "available_models": [
          { "name": "my-combo", "display_name": "my-combo", "max_tokens": 200000 },
          { "name": "kr/claude-sonnet-4.5", "display_name": "kr/claude-sonnet-4.5", "max_tokens": 200000, "max_output_tokens": 64000 }
        ]
      }
    }
  }
}
```

Zed derives the key env var from the provider id (`router9` → `ROUTER9_API_KEY`) and keeps keys out of `settings.json`. Restart Zed after exporting it, then pick a model from the Agent Panel.

## Path B — 9Router ACP agent (External Agent)

`9router acp` is an [Agent Client Protocol](https://agentclientprotocol.com) agent: Zed spawns it as a subprocess and talks to it over stdio. Every completion still runs through the gateway, so RTK token saving, quota-aware fallback and usage tracking all apply.

### 1. Make sure the gateway is reachable

```bash
9router                      # starts the dashboard + API on :20128
curl http://localhost:20128/api/health     # {"ok":true}
```

### 2. Store credentials for the agent

```bash
9router acp --login
```

The key is stored in `~/.9router/acp-config.json` (mode `0600`). Alternatively set `NINE_ROUTER_API_KEY` (and `NINE_ROUTER_URL` for a remote gateway).

### 3. Register the agent in Zed

`connect zed` already adds this; add it manually if you prefer:

```json
{
  "agent_servers": {
    "9router": { "type": "custom", "command": "9router", "args": ["acp"] }
  }
}
```

Open the Agent Panel → new thread → pick **9Router**.

### 4. What you get

- **Model picker** — every tool-capable model and combo from `GET /v1/models`, grouped (combos first). No manual model entry in `settings.json`.
- **Workspace tools** — `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`, `bash`, `web_fetch`; reads/writes go through Zed's own filesystem methods, edits show as diffs, mutating tools ask for permission first.
- **MCP** — MCP servers configured in Zed are forwarded to the agent and appear as `mcp__<server>__<tool>`.
- **RTK toggle** — per-session `RTK Token Saver` option (`x-9router-token-saver: off` when disabled).
- **Sessions** — threads persist across Zed restarts (`session/load`, `session/list`, `session/delete`).
- **Image prompts** — attach screenshots to a prompt.

### Debugging

In Zed: Command Palette → `dev: open acp logs`. The agent itself only writes to stderr and an optional `9router acp --log <file>` — stdout carries the protocol.

```bash
9router acp --url http://localhost:20128 --api-key sk-... --log /tmp/9router-acp.log
```

## Other ACP editors

Any ACP client can launch the same agent. Examples:

```json
// generic ACP client config
{ "command": "9router", "args": ["acp"] }
```

The agent advertises `authMethods` (including a `terminal` login method running `9router acp --login`), which is what registries such as the ACP Registry expect.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Agent thread shows "No 9Router API key" | Run `9router acp --login`, or export `NINE_ROUTER_API_KEY`, then restart the thread |
| "Cannot reach 9router gateway" | Start 9Router (`9router`) or point `--url` / `NINE_ROUTER_URL` at your server |
| Model list empty in the picker | Connect at least one provider in the dashboard; models without tool support are hidden on purpose |
| `9router: command not found` in Zed | Use an absolute path for `command` in `agent_servers` (`which 9router`) |
| Key rejected (401) | Rotate the key in the dashboard, or re-run `9router acp --login` |

## Next Steps

- [Claude Code integration](claude-code.md)
- [Codex integration](codex.md)
- [Other tools](other-tools.md)
- [API Reference](../api/reference.md)
