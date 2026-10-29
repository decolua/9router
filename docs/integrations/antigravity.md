# Antigravity + 9Router

Antigravity (Google) can be pointed at 9Router. The primary route is the
dashboard's automatic configuration; the generic OpenAI-compatible
environment pattern works as a secondary option.

## Option A — Dashboard (automatic)

1. Open **Dashboard → CLI Tools → Antigravity**.
2. Enter the base URL (default `http://localhost:20128/v1`) and select or
   create an API key.
3. Click **Save** — the card writes the configuration for you.

## Option B — Manual (env vars)

Point the tool at 9Router's OpenAI-compatible surface:

```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="sk-9r-..."   # key from Dashboard → Endpoint → API Keys
```

## Verify

Send a short prompt from the tool using a 9Router model id such as
`kr/claude-sonnet-4.5`, or check that the gateway serves your key:

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer sk-9r-..."
```

If you get a 401, check the key; if 404, check the model id
(`<provider>/<model>` format — list via `GET /v1/models` or the dashboard
**Providers** page).

## Notes

- If your Antigravity build only accepts an Anthropic-compatible endpoint,
  use the [Claude Code guide](claude-code.md) pattern
  (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` against
  `POST /v1/messages`).
- If neither custom-endpoint route works, use the dashboard CLI Tools page's
  local **MITM server** option (see
  [Supported tools](README.md#supported-tools)).
