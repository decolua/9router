# 9Router API Reference

<!-- ch:trace row=DOC-24 spec=docs/api-reference.md#configuration test=none:doc-prose-no-test doc=docs/api-reference.md prompt=/tmp/9router-DOC-24-brief.txt evidence=none:doc-only-local-grep witness=docs/api-reference.md verdict=none:pending-foreman commit=0f1ed345 memory=none:project-record -->

9Router exposes an **OpenAI-compatible** API surface at `/v1`, plus an
Anthropic-compatible `POST /v1/messages`, and a set of dashboard APIs under
`/api`.

## Base URL

```
http://localhost:20128/v1
```

The port defaults to `20128` and can be changed with the `PORT` env var.
All `/v1` endpoints accept CORS from any origin.

## Configuration (environment variables)

The authoritative list of environment variables is
[`.env.example`](../.env.example) (each key commented with its default
and effect): auth secrets (`INITIAL_PASSWORD`, `JWT_SECRET`,
`API_KEY_SECRET`), server settings (`PORT`, `HOSTNAME`, `DATA_DIR`,
`REQUIRE_API_KEY`), and provider/API-key credentials for the routing
backends. Copy it with `cp .env.example .env` and edit before first boot.
Federation-specific keys (`FEDERATION_MODE`, `FEDERATION_CENTRAL_URL`,
`FEDERATION_TOKEN`, `FEDERATION_EDGE_ID`, `FEDERATION_REDACT_FIELDS`) are
documented in [FEDERATION.md](FEDERATION.md). Test-harness-only variables
(`RUN_E2E`, `RUN_REAL`) live in [`tests/`](../tests) and never affect a
production deployment.

## Authentication

9Router has two independent auth surfaces, and neither is a blanket
"API key on every request" rule.

### Dashboard API (`/api/*`) — deny-by-default

A `/api/*` request is allowed when **any** of the following holds:

1. Its path is on the public allow-list: `/api/health`, `/api/version`,
   `/api/init`, `/api/locale`, `/api/auth/login`, `/api/auth/logout`,
   `/api/auth/status`, `/api/auth/oidc*`, `/api/auth/saml*` and
   `/api/settings/require-login`.
2. Its path is under `/api/federation/*` — the dashboard session is deliberately
   skipped there so the federation role guard can enforce `FEDERATION_TOKEN` on
   protected federation handlers. The read-only local config/status surfaces
   document their token-less exceptions below (see [Federation docs](FEDERATION.md)).
3. It carries the `auth_token` JWT cookie issued by `POST /api/auth/login`, or
   dashboard login is switched off through the `requireLogin` setting.
4. It carries the on-host CLI token in the `x-9r-cli-token` header (derived from
   `MACHINE_ID_SALT`).

Every other `/api/*` route — including `GET/POST /api/keys`, `/api/settings`,
`/api/combos`, `/api/providers`, `/api/proxy-pools`, `/api/models`, `/api/usage`,
`/api/oauth`, `/api/cloud`, `/api/pricing`, `/api/tags`, `/api/cli-tools`,
`/api/mcp` and `/api/translator` — answers `401 {"error":"Unauthorized"}` without
one of the above.

Two stricter classes sit inside that set:

- `/api/shutdown`, `/api/settings/database`, `/api/version/update` and
  `/api/version/shutdown` always need a valid `auth_token` session or the CLI
  token — the `requireLogin: false` escape hatch does not apply to them, and the
  answer is `401` otherwise.
- The local-only routes (`/api/mcp/*`, `/api/cli-tools/cowork-settings`,
  `/api/cli-tools/antigravity-mitm`, the install/enable/disable/check endpoints
  under `/api/tunnel/`, `/api/headroom/start`, `/api/headroom/stop`,
  `/api/headroom/proxy`, `/api/oauth/cursor/auto-import`,
  `/api/oauth/kiro/auto-import`, `/api/oauth/zed/auto-import`,
  `/api/oauth/minimax-code/lease`, `/api/oauth/minimax-code-global/lease` and
  `/api/auth/reset-password`) need the CLI token
  or a loopback client that is authenticated, so a remote session gets `403` even
  when its cookie is valid.

Creating an API key therefore needs a session — the dashboard
(**Dashboard → Endpoint → API Keys**), or a two-step `curl`. This example runs as
written:

```bash
# 1. Log in — the auth_token JWT cookie is stored in cookies.txt
curl -s -c cookies.txt -X POST http://localhost:20128/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<dashboard password>"}'
# → 200 {"success":true}

# 2. Create the key with that session
curl -s -b cookies.txt -X POST http://localhost:20128/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name":"my-tool"}'
# → 201 {"key":"sk-...","name":"my-tool","id":"<uuid>","machineId":"..."}
```

Skip step 1 and the same create call answers `401 {"error":"Unauthorized"}` —
`/api/keys` belongs to the deny-by-default `/api/*` surface.

### LLM API (`/v1`, `/v1beta`, `/api/v1`, `/api/v1beta`, `/codex`, `/responses`)

These prefixes are public at the dashboard layer; their own check accepts a
request when **any** of the following holds:

1. **Trusted local client** — the request arrives from a loopback peer (and, when
   it carries an `Origin`, that origin is loopback too). The guard lets it through
   with no key; the endpoint handlers below add their own check.
   A request forwarded by a reverse proxy is never counted as local.
2. **Valid API key**, sent as any of:
   - `Authorization: Bearer sk-…`
   - `x-api-key: sk-…`
   - `x-goog-api-key: sk-…`
   - `?key=sk-...`

   These are keys **minted by this instance** — dashboard → Endpoint → API Keys,
   or login + `POST /api/keys` (recipe below). The `API_KEY_SECRET` environment
   variable is the server-side HMAC secret used to derive and validate those
   keys; it is **not** a client credential and must never be sent as a Bearer
   key. Sharing `API_KEY_SECRET` across federation instances keeps minted keys
   valid on every instance — it does not make the secret itself a client key.
3. **Remote keyless access, while the effective `requireApiKey` setting is
   `false`.** This is a deployment opt-out — and it is the state a fresh install
   boots in, because `.env.example` ships `REQUIRE_API_KEY=false` (see the
   `REQUIRE_API_KEY` row in the README for the unset semantics).

Otherwise a remote request with a missing or invalid key is rejected with
`401 {"error":{"message":"API key required for remote API access","type":"authentication_error","code":"invalid_api_key"}}`
— the dashboard guard answers before the request reaches the endpoint handler,
in the same OpenAI error envelope the handlers use (DF-9ROUTER-56).

### Endpoint handlers — the second check

Most LLM handlers (`/v1/chat/completions`, `/v1/messages`, `/v1/embeddings`, the
image, audio, search, fetch and video routes) then re-check the effective
`requireApiKey` themselves. When it is `true` they require a valid key from
**every** client — loopback included — and answer
`401 {"error":{"message":"Missing API key",…}}` or `"Invalid API key"`. When it is
`false` that check is skipped. A few read-only endpoints, `GET /v1/models` among
them, have no such check and therefore stay keyless on loopback even while
`requireApiKey` is `true`.

Verified against a running instance (loopback, no key sent):

| Effective `requireApiKey` | Client | `GET /v1/models` | `POST /v1/chat/completions` |
|---|---|---|---|
| `false` (shipped `.env.example`) | loopback | `200` | `200` (runs) |
| `false` | remote | `200` | `200` (runs) |
| `true` (runtime default) | loopback | `200` | `401` `Missing API key` |
| `true` | remote | `401` `authentication_error`/`invalid_api_key` | `401` `authentication_error`/`invalid_api_key` |

Both 401s share the OpenAI error envelope — `{"error":{"message":…,"type":"authentication_error","code":"invalid_api_key"}}`
— differing only in the message text.

So `GET /v1/models` works with or without a key on loopback, while a completion
call always needs one once `requireApiKey` is `true`:

```bash
curl http://localhost:20128/v1/models
curl http://localhost:20128/v1/models -H "Authorization: Bearer sk-..."
```

When a key **is** required, a missing or invalid one surfaces from the endpoint
handler as:

| Status | Meaning |
|---|---|
| `401` | Missing or invalid API key (`{"error":{"message":"Missing API key"/"Invalid API key","type":"authentication_error","code":"invalid_api_key"}}`) |

## Endpoints

### `POST /v1/chat/completions`

OpenAI-compatible chat completions. Request:

```json
{
  "model": "kr/claude-sonnet-4.5",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false
}
```

Non-streaming response:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "kr/claude-sonnet-4.5",
  "choices": [
    {"index": 0, "message": {"role": "assistant", "content": "Hi there!"}, "finish_reason": "stop"}
  ],
  "usage": {"prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16}
}
```

With `"stream": true` the server returns SSE chunks
(`data: {"object":"chat.completion.chunk",...}` terminated by `data: [DONE]`).

**Model ids** use the form `<provider-alias>/<model>` (e.g. `kr/claude-sonnet-4.5`).
Requesting a model with no active provider credentials returns `404`/`503`
(see error table below). Requests with no `model` field return `400`.

### `POST /v1/messages`

Anthropic Messages API format (used by Claude Code via `ANTHROPIC_BASE_URL`):

```json
{
  "model": "kr/claude-sonnet-4.5",
  "max_tokens": 1024,
  "messages": [{"role": "user", "content": "Hello!"}]
}
```

The request is translated into the same internal chat pipeline as
`/v1/chat/completions`.

### `GET /v1/models`

Lists available models:

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer sk-..."
```

Returns a JSON object with a `data` array of `{id, object: "model", ...}`
entries (OpenAI shape). Live catalogs are resolved per provider when possible.

### Other `/v1` endpoints

| Endpoint | Purpose |
|---|---|
| `POST /v1/audio/speech` | Text-to-speech |
| `POST /v1/audio/transcriptions` | Speech-to-text |
| `GET /v1/audio/voices` | List TTS voices for a provider (`?provider=…`) |
| `POST /v1/api/chat` | Ollama-format chat (NDJSON stream) |
| `POST /v1/embeddings` | Embeddings |
| `POST /v1/images/generations` | Image generation |
| `POST /v1/messages/count_tokens` | Count tokens for a Messages request |
| `GET /v1/models/info` | Detailed model catalog (kind, endpoint, capabilities) |
| `GET /v1/models/{kind}` | Model listing filtered by service kind |
| `GET /v1/models/{provider}/{model}` | Single model lookup from the LLM catalog |
| `POST /v1/responses` | OpenAI Responses-format endpoint |
| `POST /v1/responses/compact` | Compact conversation context |
| `POST /v1/search` | Web search |
| `POST /v1/systemone` | System One (Jev) decision models |
| `POST /v1/videos/generations` | Video generation |
| `POST /v1/videos/edits` | Async video edit (xAI Grok Imagine) |
| `POST /v1/videos/extensions` | Async video extension (xAI Grok Imagine) |
| `GET /v1/videos/{id}` | Poll async video job status |
| `POST /v1/web/fetch` | Web URL fetch/extract |

All are gated by the rules in [Authentication](#authentication). The four
endpoints below get the same LLM-API gate as `POST /v1/chat/completions`: the
dashboard guard treats `/v1` and `/v1beta` as public LLM prefixes (loopback is
trusted, and a remote keyless request is allowed only while the effective
`requireApiKey` setting is `false`), and the POST handlers re-check the
effective `requireApiKey` themselves — so from remote clients they need a valid
key only while `requireApiKey` is `true`, exactly like a completion call (see
[Endpoint handlers](#endpoint-handlers--the-second-check)). `GET
/v1/models/{kind}` is a read-only model listing with no handler-level key
check — like `GET /v1/models`, it stays keyless on loopback even while
`requireApiKey` is `true`.

### `POST /v1/systemone` — System One (Jev) decision models

Also reachable as `POST /systemone` (a Next.js rewrite to the same route in
`next.config.mjs`). Routes a decision request to a `kind: "systemone"` model;
the body is passed through to the provider's System One endpoint untouched —
these models have no chat translation layer.

Request:

```json
{
  "model": "typesafe/jev-1.13",
  "state": { "task": "route this ticket", "queue_depth": 3 },
  "questions": {
    "priority": "Which lane should this ticket go to?",
    "escalate": "Should this be escalated?"
  }
}
```

- `model` (required) — a `<provider-alias>/<model>` id resolving to a
  `kind: "systemone"` model (`typesafe/jev-1.13`, `rev-latest`,
  `v1m-decision-engine`, `@cf/cloudflare/clef-flash`, …). A missing model, a
  missing `state`, or a missing `questions` object answers `400`.
- `state` (required) — any JSON value; forwarded as-is.
- `questions` (required) — a JSON object (not an array) of the decisions to
  make; forwarded as-is.

The request goes to the provider's System One endpoint (`systemoneConfig` in
the provider registry) with the account's own credentials, and the provider's
JSON response body is returned unchanged:

```json
{
  "priority": "urgent",
  "escalate": false,
  "usage": { "input_tokens": 120, "output_tokens": 8 }
}
```

(Exact response fields are provider-defined; `usage` is optional. Only input/
output token counts, when present, are recorded for usage tracking.)

Served by providers with a System One lane: **OpenRouter** (`systemone`
alias), **v1m** (`systemone`/`jev` aliases), **opencode**, **opencode-zen**,
and **Cloudflare AI** (whose endpoint embeds the account id and model in the
path, e.g. `@cf/cloudflare/clef-flash`). Requesting a model whose provider has
no System One endpoint answers `400 Provider 'X' does not support System One.`
Errors use the OpenAI envelope from [Errors](#errors); auth follows the LLM-API
gate.

### `POST /v1/api/chat` — Ollama-format chat

Native Ollama client compatibility: an Ollama-format `/api/chat` request
answered with Ollama NDJSON. Reachable at `/v1/api/chat` via the `/v1/:path*`
rewrite. The request body is the standard Ollama chat shape (it is routed
through the same internal chat pipeline as `POST /v1/chat/completions`, so
`model` accepts the same `<provider-alias>/<model>` ids):

```json
{
  "model": "kr/claude-sonnet-4.5",
  "messages": [{ "role": "user", "content": "Hello!" }]
}
```

The response is **always** Ollama NDJSON — one JSON object per line, streamed
regardless of the request's `stream` field:

```
{"model":"kr/claude-sonnet-4.5","message":{"role":"assistant","content":"Hi"},"done":false}
{"model":"kr/claude-sonnet-4.5","message":{"role":"assistant","content":" there"},"done":false}
{"model":"kr/claude-sonnet-4.5","message":{"role":"assistant","content":""},"done":true}
```

Tool calls arrive as Ollama `message.tool_calls` with parsed JSON `arguments`
on the final `done: true` line. The last line always carries `done: true`.

### `GET /v1/models/{kind}` — models filtered by service kind

`GET /v1/models` variant that returns only models of one service kind. The
kind is a URL slug:

| Slug | Kind(s) selected |
|---|---|
| `image` | image generation |
| `tts` | text-to-speech |
| `stt` | speech-to-text |
| `embedding` | embeddings |
| `image-to-text` | vision / image understanding |
| `web` | web search and web fetch |

```bash
curl http://localhost:20128/v1/models/embedding
```

```json
{
  "object": "list",
  "data": [
    { "id": "openai/text-embedding-3-small", "object": "model", "...": "..." }
  ]
}
```

The same catch-all route also serves `GET
/v1/models/{provider}/{model}` — a single-model lookup against the same LLM
catalog `GET /v1/models` exposes (a one-segment path that is not a kind slug
is treated as a model id). Unknown model ids answer `404` with
`code: "model_not_found"`. Per-key model access controls apply to both forms
when configured.

### `POST /v1beta/models/{model}:generateContent` — Gemini-native generateContent

Gemini API compatibility for clients like Gemini CLI and the `@google/genai`
SDK. Both actions are served:

- `POST /v1beta/models/{model}:generateContent` — non-streaming (plain JSON)
- `POST /v1beta/models/{model}:streamGenerateContent` — streaming (Gemini SSE;
  `@google/genai` calls this with `?alt=sse`). Streaming intent comes from the
  URL action suffix, not a body field.

The model is a Gemini-native path segment: either a bare id (`gemini-3-flash`)
or a provider-prefixed id (`google/gemini-3-flash` / `kr/gemini-3-flash`).
`GET /v1beta/models` lists the catalog in Gemini `models.list` shape
(`{ "models": [ { "name": "models/<provider>/<model>", … } ] }`).

Request (Gemini `generateContent` body):

```json
{
  "systemInstruction": { "parts": [{ "text": "You are concise." }] },
  "contents": [
    { "role": "user", "parts": [{ "text": "Hello!" }] }
  ],
  "generationConfig": { "temperature": 0.7, "maxOutputTokens": 256 }
}
```

The request is translated into the same internal chat pipeline as
`POST /v1/chat/completions` (`systemInstruction` → system message, `contents`
→ user/assistant messages, `generationConfig.maxOutputTokens` / `temperature`
/ `topP` → their OpenAI equivalents) and answered in Gemini format:

```json
{
  "candidates": [
    {
      "content": { "role": "model", "parts": [{ "text": "Hi there!" }] },
      "finishReason": "STOP",
      "index": 0
    }
  ],
  "modelVersion": "kr/gemini-3-flash",
  "usageMetadata": {
    "promptTokenCount": 12,
    "candidatesTokenCount": 4,
    "totalTokenCount": 16
  }
}
```

Streaming chunks carry `candidates[].content.parts[].text` deltas, an optional
`thought: true` part for reasoning deltas, and `finishReason` / `usageMetadata`
/ `modelVersion` on the final chunk; the stream just closes (no `data: [DONE]`
sentinel). `finishReason` maps from OpenAI (`stop`→`STOP`, `length`→
`MAX_TOKENS`, `content_filter`→`SAFETY`).

Special case: a request for a Gemini TTS model (or with
`generationConfig.responseModalities` containing `AUDIO`) is forwarded
**natively** to Google's `generativelanguage.googleapis.com` endpoint with a
Gemini account's own credentials, with account fallback on failures — the body
is not translated. Auth accepts the client key via `Authorization: Bearer`,
`x-goog-api-key`, or `?key=` (same LLM-API gate).

## Errors

All endpoints return OpenAI-compatible error bodies:

```json
{
  "error": {
    "message": "Model not found",
    "type": "invalid_request_error",
    "code": "model_not_found"
  }
}
```

Two layers can answer before an endpoint does (see
[Authentication](#authentication)): the dashboard guard returns
`{"error":{"message":"API key required for remote API access","type":"authentication_error","code":"invalid_api_key"}}`
for a keyless remote LLM request while `requireApiKey` is `true`, and
`{"error":"Unauthorized"}` for an unauthenticated `/api/*` request (the
dashboard surface keeps its flat body; the OpenAI-style `/v1` surface uses the
envelope above).

| HTTP | type | code | Meaning |
|---|---|---|---|
| `400` | `invalid_request_error` | `bad_request` | Malformed request / missing model |
| `401` | `authentication_error` | `invalid_api_key` | Missing or invalid key |
| `402` | `billing_error` | `payment_required` | Quota/payment issue |
| `403` | `permission_error` | `insufficient_quota` | Quota exhausted |
| `404` | `invalid_request_error` | `model_not_found` | Unknown model — when the id is in no catalog the message reads `Model 'X' not found in catalog`; ids the catalog lists but that have no usable connection keep the `No active credentials for provider: X` wording (DF-9ROUTER-56) |
| `406` | `invalid_request_error` | `model_not_supported` | Model not supported by provider |
| `429` | `rate_limit_error` | `rate_limit_exceeded` | Provider rate limit (transient) |
| `5xx` | `server_error` | `internal_server_error` / `bad_gateway` / `service_unavailable` / `gateway_timeout` | Upstream or gateway failure |

Streaming requests surface errors as `data: {"error": {...}}` SSE events before
the stream closes.

## Rate limiting

9Router does not apply a global request-rate limiter on `/v1`. Provider-level
rate limits (e.g. Copilot/Codex subscriptions) are handled internally with
cooldowns and are reported to clients as `429`/`503`.

## Dashboard APIs (`/api`)

### Federation configuration and replication API

The federation route set has seven registered handlers. `GET
/api/federation/config-status` is a **token-less, read-only** endpoint for an
instance's own dashboard configuration page. It exposes local configuration
metadata only; the federation token is represented only as configured yes/no
and its value never leaves the server. `OPTIONS
/api/federation/config-status` returns `204 No Content` for CORS preflight.

| Endpoint | Purpose | Access |
|---|---|---|
| `GET /api/federation/config-status` | Local federation configuration metadata | Token-less, read-only; `OPTIONS` returns `204` |
| `GET /api/federation/local-status` | Local edge lifecycle and replica status | Token-less local dashboard status |
| `GET /api/federation/delta?since=<revision>` | Replication changes since a watermark | `FEDERATION_TOKEN` |
| `POST /api/federation/replay` | Replay a queued edge write | `FEDERATION_TOKEN` + fencing material |
| `GET /api/federation/snapshot?since=0` | Bootstrap snapshot | `FEDERATION_TOKEN` |
| `GET /api/federation/status` | Central/edge diagnostic status | `FEDERATION_TOKEN` |
| `GET /api/federation/verify` | Heartbeat and lease renewal | `FEDERATION_TOKEN` |

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `POST /api/auth/login` | Dashboard login (JWT cookie) |
| `GET/POST /api/keys` | List / create API keys |
| `GET/POST /api/combos` | List / create combos (model routing rules) |
| `GET /api/settings` | Runtime settings |
| `GET /api/usage/stats` | Token/cost aggregates + recent requests for the Usage page |
| `GET /api/federation/status` | Federation mode status (edge/central) |

`GET /api/usage/stats` takes `?period=today`, `24h`, `7d` (default), `30d`, `60d`
or `all`, and only reports requests that completed: token counts come from the provider's
own usage metadata (Claude/Responses, OpenAI, Gemini, and native Ollama's
top-level `prompt_eval_count`/`eval_count`). When a provider reports no counts at
all and the response carried content, the tokens are estimated from the request
body and the response text and the stored row is marked `"estimated": true`; a
response with neither counts nor content is not recorded.

Dashboard routes (`/api/*`) are deny-by-default and need the `auth_token` session
cookie or the host CLI token — an API key does not authorize them. The LLM
prefixes are keyless for trusted local clients and require an API key from remote
clients only while the effective `requireApiKey` is `true` (`.env.example` ships
`REQUIRE_API_KEY=false`, so a fresh install serves them keyless). See
[Authentication](#authentication).

## See also

- [Integrations guide](integrations/README.md) — Claude Code, Cursor, and other tools.
- [Local MCP integrations](integrations/mcp.md) — HTTP SSE bridge for local stdio MCP servers.
- [Federation docs](FEDERATION.md) — edge/central deployment.
