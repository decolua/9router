# Codex + 9Router

Codex CLI (OpenAI) supports a custom **OpenAI-compatible** endpoint via
environment variables, which maps directly to 9Router's `/v1` surface.

## Option A — Dashboard (automatic)

1. Open **Dashboard → CLI Tools → Codex**.
2. Enter the base URL (default `http://localhost:20128/v1`) and select or
   create an API key.
3. Click **Save** — the card writes the configuration for you.

## Option B — Manual (env vars)

```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="sk-9r-..."   # key from Dashboard → Endpoint → API Keys
codex
```

You can also pin the model in `~/.codex/config.toml`:

```toml
model = "kr/claude-sonnet-4.5"
```

Model ids use the form `<provider>/<model>` — list the available ones with
`GET /v1/models` or browse the dashboard **Providers** page.

## Verify

```bash
codex "Say hello in one word"
```

If you get a 401, check the key; if 404, check the model id
(`<provider>/<model>` format).

## Notes

- 9Router streams SSE `chat.completion.chunk` events like OpenAI, so Codex's
  streaming works unchanged.
- For tools that only support an Anthropic endpoint, use the
  [Claude Code guide](claude-code.md) pattern (`ANTHROPIC_BASE_URL` +
  `/v1/messages`).
