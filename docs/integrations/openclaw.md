# OpenClaw + 9Router

OpenClaw talks to **OpenAI-compatible** endpoints, which maps directly to
9Router's `/v1` surface.

## Option A — Dashboard (automatic)

1. Open **Dashboard → CLI Tools → OpenClaw**.
2. Enter the base URL (default `http://localhost:20128/v1`) and select or
   create an API key.
3. Click **Save** — the card writes the configuration for you.

## Option B — Manual (env vars)

```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="sk-9r-..."   # key from Dashboard → Endpoint → API Keys
openclaw
```

## Verify

Start OpenClaw and send a short prompt using a 9Router model id such as
`kr/claude-sonnet-4.5`. Model ids use the form `<provider>/<model>` — list
them via `GET /v1/models` or the dashboard **Providers** page.

If you get a 401, check the key; if 404, check the model id.

## Notes

- Streaming (SSE) is supported — 9Router streams `chat.completion.chunk`
  events like OpenAI.
- For tools that only support an Anthropic endpoint, use the
  [Claude Code guide](claude-code.md) pattern (`ANTHROPIC_BASE_URL` +
  `/v1/messages`).
