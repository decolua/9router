# GitHub Copilot + 9Router

The Copilot CLI and VS Code extension can be pointed at a custom
**OpenAI-compatible** endpoint, which maps to 9Router's `/v1` surface.

## Option A — Dashboard (automatic)

1. Open **Dashboard → CLI Tools → GitHub Copilot**.
2. Enter the base URL (default `http://localhost:20128/v1`) and select or
   create an API key.
3. Click **Save** — the card writes the configuration for you.

## Option B — Manual (environment)

Set the OpenAI-compatible endpoint before launching the CLI (or VS Code):

```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="sk-9r-..."   # key from Dashboard → Endpoint → API Keys
copilot
```

## Verify

Start a Copilot chat and send a short message, or check that the gateway
serves your key:

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer sk-9r-..."
```

If you get a 401, check the key; if 404, check the model id
(`<provider>/<model>` format, e.g. `kr/claude-sonnet-4.5` — list via
`GET /v1/models` or the dashboard **Providers** page).

## Notes

- Streaming (SSE) is supported — 9Router streams `chat.completion.chunk`
  events like OpenAI.
- For tools that only support an Anthropic endpoint, use the
  [Claude Code guide](claude-code.md) pattern (`ANTHROPIC_BASE_URL` +
  `/v1/messages`).
