---
name: 9router-mcp-gateway
description: Connect one MCP endpoint to 9router's gateway to reach many upstream MCP servers (Jira, GitHub, search, etc.) with per-key scoping. Use when an AI harness should access multiple MCP tools through 9router instead of wiring each server individually.
---

# 9router MCP Gateway

The MCP Gateway turns 9router into a single MCP endpoint that fans out to
many upstream MCP servers. Instead of configuring an AI harness with N
separate MCP URLs (and a separate API key per server), you configure ONE
URL and ONE API key — 9router aggregates everything that key is allowed
to see.

## When to use this

- A single AI harness (Claude Code, Cursor, Codex CLI, etc.) needs access
  to multiple MCP servers at once: Jira, GitHub, Exa search, internal
  tools, etc.
- The same kind of MCP runs in multiple tenants (Jira company X vs Y) and
  each harness should only see its own tenant's tools.
- The operator wants unified usage logs of all MCP traffic through one
  9router instance.

## When NOT to use this

- A single MCP server with no scoping needs — connect the harness
  directly.
- Tools that aren't MCP — for OpenAI/Anthropic-format chat, use the
  `9router-chat` skill instead.

## Concepts

- **Instance** — one registered upstream MCP server (HTTP/SSE remote or
  stdio subprocess). Identified by a unique `slug` like `jira-acme`.
- **Gateway key** — an API key a harness uses to talk to the gateway.
  Scoped to a set of instances via grants.
- **Tool name** — the gateway exposes each upstream tool as
  `<instanceSlug>__<toolName>` (double underscore separator). So
  Jira's `create_issue` registered with slug `jira-acme` becomes
  `jira-acme__create_issue` to the harness.

## Quick start

1. Open the 9router dashboard → **MCP Gateway**.
2. Click **New instance**, pick a kind, fill in connection details, save.
3. Click **Test** on the instance row to confirm the upstream
   `tools/list` returns successfully.
4. Click **New key**, give it a name, copy the key (it is shown once).
5. Click **Grants** on the key, tick the instances this harness may see,
   save.
6. In the AI harness, configure one MCP server:
   - URL: `http://<your-9router-host>/api/mcp-gateway`
   - Auth: `Authorization: Bearer <gateway-key>` (or `x-api-key` header)
7. The harness now sees all upstream tools under their namespaced names.

## Example: tools/list

Request:
```http
POST /api/mcp-gateway HTTP/1.1
Host: localhost:20128
Authorization: Bearer sk-...
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {"name": "exa__web_search_exa", "description": "Search the web", ...},
      {"name": "jira-acme__create_issue", "description": "Create Jira issue", ...}
    ]
  }
}
```

## Example: tools/call

```http
POST /api/mcp-gateway HTTP/1.1
Authorization: Bearer sk-...

{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"exa__web_search_exa",
           "arguments":{"query":"what is the capital of france"}}}
```

The gateway splits the tool name on the first `__`, finds the instance
by slug, strips the prefix, and forwards `tools/call` to that upstream
with the provided arguments.

## Transports

- **HTTP / SSE** — point at a remote MCP server URL.
  Common authless public instances include
  `https://mcp.exa.ai/mcp` (Exa web search).
- **stdio** — register a local command + args + env. The gateway spawns
  one long-lived child process per instance and speaks newline-delimited
  JSON-RPC on stdin/stdout. Useful for `npx`-based MCP packages.

Both transports share the same per-key grant scope and the same
namespace prefix.

## SSE transport

Some harnesses prefer SSE. Open a long-lived GET to
`/api/mcp-gateway/sse` — the server replies with the MCP handshake:

```
event: endpoint
data: /api/mcp-gateway/message?sessionId=<uuid>
```

Then POST JSON-RPC requests to that URL; responses are pushed back
over the open SSE stream as `event: message` frames.

## Auth & visibility

- Gateway keys are separate from the regular 9router LLM API keys.
  A regular API key does not grant access to the gateway, and a
  gateway key does not grant access to chat/completions.
- Loopback callers and the 9router CLI token always have access.
- A gateway key only sees the instances it has been granted. Adding a
  new instance to 9router does not expose it to existing keys; the
  operator must grant the new instance to each key explicitly.

## OAuth-protected upstreams

For instances that require browser OAuth (Jira, some GitHub servers),
set `Requires OAuth` on the instance, then complete the connect flow
in the dashboard. The gateway stores the resulting access/refresh
tokens and attaches `Authorization: Bearer …` on every upstream call.
Tokens auto-refresh; if refresh fails the instance is marked
`needs reauth` and the dashboard surfaces a "re-login" prompt.

## Usage logs

Every `tools/call` is logged through the standard 9router usage pipeline
(provider `mcp-gateway`, model `<slug>__<toolName>`). It appears in
`/dashboard/usage` alongside normal LLM traffic — no new UI required.

## Operational notes

- Each stdio instance is one long-lived child process. Restart 9router
  to fully recycle them.
- The gateway never silently disables stdio; if the runtime image
  lacks `npx`/`python`/`docker`, stdio instances fail at spawn with
  "command not found" and the error surfaces in the per-instance Test
  button.
- Per-instance `headers` and `env` are merged into the upstream
  request/child env respectively. Operators are trusted; do not point
  the gateway at an untrusted control plane.
