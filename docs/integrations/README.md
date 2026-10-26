# 9Router — AI Code Tool Integrations

9Router exposes an OpenAI-compatible `/v1` API (plus an Anthropic-compatible
`/v1/messages`) on the gateway's base URL, so any AI coding tool that supports
custom API endpoints can be pointed at it.

**Default endpoint (local install):** `http://localhost:20128/v1`

The dashboard also ships a **CLI Tools** page (`/dashboard/cli-tools`) that
writes the configuration for many tools automatically — open it first, then use
the per-tool guides below for anything the page doesn't cover.

## Before you start

1. Start 9Router (see [README](../../README.md) — dev, production, or Docker).
2. Create an **API key**: Dashboard → **Endpoint** page → **API Keys** →
   create a new key and copy it. Keys are also usable as `x-api-key` or a
   `Bearer` token (see [API Reference](../api-reference.md#authentication)).
   On a loopback install the key is optional — the gateway trusts local
   clients, and `.env.example` ships `REQUIRE_API_KEY=false`; a remote client
   needs one while the effective `requireApiKey` is `true`.
3. Pick a model id from the dashboard's **Providers** page, or list them via
   `GET /v1/models`. Model ids use the form `<provider>/<model>`, e.g.
   `kr/claude-sonnet-4.5`.

## Guides

| Tool | Guide |
|---|---|
| Claude Code | [claude-code.md](claude-code.md) |
| Cursor | [cursor.md](cursor.md) |
| Antigravity | [antigravity.md](antigravity.md) |
| GitHub Copilot | [copilot.md](copilot.md) |
| Codex | [codex.md](codex.md) |
| Gemini CLI | [gemini.md](gemini.md) |
| OpenCode | [opencode.md](opencode.md) |
| Cline | [cline.md](cline.md) |
| OpenClaw | [openclaw.md](openclaw.md) |
| MCP servers | [mcp.md](mcp.md) |

## Supported tools

The dashboard CLI Tools page configures: **Claude Code, Codex, Cline, GitHub
Copilot, OpenClaw, OpenCode, Kilo, Droid, Hermes, Jcode, Grok Build, Cowork,
DeepSeek TUI, Antigravity**, plus a local **MITM server** for tools that cannot
be pointed at a custom endpoint. If your tool is not listed, use the manual
pattern from the guides — nearly every tool supports `base URL + API key`
configuration.
