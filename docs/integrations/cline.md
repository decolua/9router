# Cline + 9Router

Cline (VS Code extension) supports both **OpenAI-compatible** and
**Anthropic-compatible** custom providers — 9Router implements both surfaces
(`/v1` and `/v1/messages`).

## Option A — Dashboard (automatic)

1. Open **Dashboard → CLI Tools → Cline**.
2. Enter the base URL (default `http://localhost:20128/v1`) and select or
   create an API key.
3. Click **Save** — the card writes the configuration for you.

## Option B — Manual (extension settings)

1. Open the Cline sidebar → **Settings** (gear icon).
2. Set **API Provider** to **OpenAI Compatible**.
3. Set **Base URL** to `http://localhost:20128/v1`.
4. Set **API Key** to a 9Router key
   (Dashboard → **Endpoint** → **API Keys** → create and copy).
5. Set **Model ID** to a 9Router model id such as `kr/claude-sonnet-4.5`
   (list via `GET /v1/models` or the dashboard **Providers** page).

Prefer the Anthropic route instead? Use Cline's **Anthropic** provider and
point its base URL at 9Router's `POST /v1/messages` surface — see the
[Claude Code guide](claude-code.md) for the `ANTHROPIC_BASE_URL` +
`ANTHROPIC_AUTH_TOKEN` pattern.

## Verify

Start a Cline task with a short prompt. If the request fails, check:

- The gateway is running and reachable at `http://localhost:20128/v1`.
- The API key is valid (create a fresh one on the Endpoint page).
- The model id exists in `<provider>/<model>` format.

## Notes

- Streaming (SSE) is supported on both the OpenAI and Anthropic surfaces.
- 401 = check the key; 404 = check the model id.
