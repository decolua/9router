# Claude Code + 9Router

Claude Code supports a custom Anthropic endpoint. 9Router implements the
Anthropic Messages API at `POST /v1/messages`, so Claude Code can talk to it
directly.

## Option A — Dashboard (automatic)

1. Open **Dashboard → CLI Tools → Claude Code**.
2. Enter the base URL (default `http://localhost:20128/v1`) and select or
   create an API key.
3. Click **Save** — the card writes `ANTHROPIC_BASE_URL` and
   `ANTHROPIC_AUTH_TOKEN` into Claude Code's settings for you.

## Option B — Manual (env vars)

```bash
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"
export ANTHROPIC_AUTH_TOKEN="sk-9r-..."   # key from Dashboard → Endpoint → API Keys
claude
```

You can also persist these in `~/.claude/settings.json` under `"env"`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:20128/v1",
    "ANTHROPIC_AUTH_TOKEN": "sk-9r-..."
  }
}
```

## Verify

```bash
claude -p "Say hello in one word" --model kr/claude-sonnet-4.5
```

Replace the model id with one listed in `GET /v1/models`. If you get a 401,
check the key; if 404, check the model id (`<provider>/<model>` format).
