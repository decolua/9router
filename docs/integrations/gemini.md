# Gemini CLI + 9Router

Gemini CLI (Google) supports custom model endpoints. The most reliable route
is the dashboard's automatic configuration; the generic OpenAI-compatible
environment pattern works as a fallback.

## Option A — Dashboard (automatic)

1. Open **Dashboard → CLI Tools → Gemini**.
2. Enter the base URL (default `http://localhost:20128/v1`) and select or
   create an API key.
3. Click **Save** — the card writes the configuration for you.

## Option B — Manual (env vars)

Point the tool at 9Router's OpenAI-compatible surface:

```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="sk-9r-..."   # key from Dashboard → Endpoint → API Keys
gemini
```

## Verify

```bash
gemini "Say hello in one word"
```

If you get a 401, check the key; if 404, check the model id
(`<provider>/<model>` format, e.g. `kr/claude-sonnet-4.5` — list via
`GET /v1/models` or the dashboard **Providers** page).

## Notes

- Some Gemini-style tools only accept an Anthropic-compatible endpoint. In
  that case use the [Claude Code guide](claude-code.md) pattern
  (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` against `POST /v1/messages`).
- If neither custom-endpoint route works for your build, use the dashboard CLI
  Tools page's local **MITM server** option (see
  [Supported tools](README.md#supported-tools)).
