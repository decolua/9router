# 9Router Embeddings Tests

Unit tests for the `/v1/embeddings` endpoint implementation.

## Setup

Install test dependencies from the `tests/` directory:

```bash
cd tests/ && npm install
```

## Running Tests

From the `tests/` directory:

```bash
npm test
```

Or run vitest directly with npx:

```bash
npx vitest run --reporter=verbose --config ./vitest.config.js
```

## Test Files

| File | What it tests |
|------|--------------|
| `unit/embeddingsCore.test.js` | `open-sse/handlers/embeddingsCore.js` — core logic: body builder, URL router, headers, handler flow |
| `unit/embeddings.cloud.test.js` | `cloud/src/handlers/embeddings.js` — cloud worker handler: auth, validation, rate limits, CORS |

## Coverage Summary (59 tests)

### `embeddingsCore.test.js` (36 tests)
- `buildEmbeddingsBody`: single string, array, encoding_format, default float
- `buildEmbeddingsUrl`: openai, openrouter, openai-compatible-*, unsupported providers
- `buildEmbeddingsHeaders`: per-provider header sets, fallback to accessToken
- `handleEmbeddingsCore` input validation: missing, wrong type, null, empty
- `handleEmbeddingsCore` success: response format, CORS, Content-Type, callbacks
- `handleEmbeddingsCore` errors: 400/429/500, network error, invalid JSON
- `handleEmbeddingsCore` token refresh: 401 retry, graceful fallback

### `embeddings.cloud.test.js` (23 tests)
- CORS OPTIONS: 200 response, empty body, correct headers
- Authentication: missing key, bad format, old-format key, wrong key value, valid key
- Body validation: invalid JSON, missing model, missing input, bad model
- Happy path: single string, array, correct delegation, CORS header, machineId override
- Rate limiting: all accounts rate-limited → 503 + Retry-After, no credentials → 400
- Error propagation: non-fallback errors passed through, 429 exhausts accounts
- machineId override: validates key, rejects wrong key

## ChatGPT / Codex integration

Run the adapter, bridge, reasoning and compaction unit tests from `tests/`:

```bash
npx vitest run unit/chatgpt-integration.test.js unit/chatgpt-bridge.test.js unit/chatgpt-reasoning.test.js unit/chatgpt-compaction.test.js
```

For the full built-server path, start a standalone build with a **disposable `DATA_DIR`**, then run from the repository root:

```bash
CHATGPT_QA_PASSWORD=your-disposable-password node scripts/test-chatgpt-integration.mjs http://127.0.0.1:20241 --disposable --check-codex
```

This creates temporary provider/key records in that disposable server and runs its real Responses translator against a loopback fixture. `--check-codex` additionally requires Codex CLI (tested with 0.154.0; override its path with `CHATGPT_QA_CODEX`). It uses a temporary `CODEX_HOME` with fake authentication, exercises manual, repeated and automatic compaction, restarts app-server, resumes the saved task and continues. It does not use the user's Codex history or credentials. Add `--check-installer` on macOS to test a temporary launchd installation.

Codex compaction v2 sends an input `compaction_trigger` to `/responses`. The SSE stream must contain exactly one completed `compaction` item and a final `response.completed`; an assistant summary message alone fails Codex's history reducer. The legacy `/responses/compact` route returns the same item in a `response.compaction` JSON object.

9router seals summaries as its own AES-GCM state, deriving the encryption key from the authenticated router API key. Continuation and subsequent compaction decode that state before provider translation. It survives server and Codex restarts, but requires the same router API key. Native OpenAI encrypted state cannot be decoded by this adapter. These checks validate the protocol and history lifecycle; summarization quality and context limits still depend on the selected provider.
