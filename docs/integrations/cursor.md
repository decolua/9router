# Cursor + 9Router

Cursor accepts a custom **OpenAI-compatible** endpoint, which maps to 9Router's
`/v1` surface.

## Setup

1. Open Cursor → **Settings → Models**.
2. Under **OpenAI API Key**: create or select a 9Router API key
   (Dashboard → **Endpoint** → **API Keys**).
3. Set **OpenAI Base URL** to `http://localhost:20128/v1`.
4. In the model picker, use a 9Router model id such as `kr/claude-sonnet-4.5`
   (see `GET /v1/models` or the dashboard Providers page).

> Cursor 1.x+ also supports per-provider "Override OpenAI Base URL" in
> **Settings → Models → More** — same value, per profile.

## Verify

Start a chat in Cursor and send a message. If the request fails, check:

- The gateway is running and reachable at `http://localhost:20128/v1`.
- The API key is valid (create a fresh one on the Endpoint page).
- The model id exists (list via `GET /v1/models`).

## Notes

- Streaming (SSE) is supported — 9Router streams `chat.completion.chunk`
  events like OpenAI.
- For tools that only support an Anthropic endpoint, use the
  [Claude Code guide](claude-code.md) pattern (`ANTHROPIC_BASE_URL` +
  `/v1/messages`).
