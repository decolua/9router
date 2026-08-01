# 9Router Test Suite

Vitest suite covering the open-sse handlers, translator, provider executors, DB
layer, and security audits (plus the original `/v1/embeddings` unit tests).

## Setup

Vitest is a local dev dependency of this `tests/` package — no global install and
no `/tmp` workarounds. From the repo root, make sure app dependencies are
installed, then install the test dependencies:

```bash
npm ci                  # repo root — installs open-sse/src deps + better-sqlite3
cd tests && npm install # installs vitest into tests/node_modules
```

## Running Tests

```bash
cd tests
npm test           # full suite, verbose reporter
npm run test:watch # watch mode
```

## CI gate (no-regression)

CI does **not** require every test to pass. A curated set of known failures
(`__baseline__/known-fails.txt`) is tolerated — some are intentional
"bug-exposing" TODO tests. The gate only fails when a test that is **not** in
that list fails (a real pass→fail regression):

```bash
cd tests
npm run test:ci    # runs the suite (JSON) then the no-regression gate
```

`test:ci` writes JSON results to `tests/.test-results.json` (gitignored) and runs
`__baseline__/verify-no-regression.mjs`, which exits non-zero on any regression.
This is what the GitHub Actions workflow (`.github/workflows/test.yml`) runs.

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
