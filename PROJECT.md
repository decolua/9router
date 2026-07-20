# Project: 9Router API Hang Fix

## Architecture
9Router is a Next.js App Router application providing API routing and translation services.
- **API Routes**: Located under `src/app/api/v1/chat/completions/route.js` and `src/app/api/v1/messages/route.js`.
- **SSE Streams**: Managed via `open-sse/utils/stream.js` and `open-sse/utils/streamHandler.js`.
- **Request Proxying**: Handled by global fetch patching in `open-sse/utils/proxyFetch.js`.
- **Database**: Persistent configuration and routing logs are managed via sql.js / better-sqlite3.

## Code Layout
- `src/app/api/v1/chat/completions/route.js` — Chat completions API endpoint
- `src/app/api/v1/messages/route.js` — Messages API endpoint
- `open-sse/utils/stream.js` — Stream definitions and stream transformers
- `open-sse/utils/streamHandler.js` — Handles routing and flushing streams to clients
- `open-sse/utils/proxyFetch.js` — Network request interceptor and routing
- `tests/` — Test suites directory

## Milestones
| # | Name | Scope | Dependencies | Status | Conv ID |
|---|------|-------|-------------|--------|---------|
| 1 | E2E Testing Track | Create opaque-box E2E test suite (Tiers 1-4), publish `TEST_READY.md` | None | DONE | 4cc64b7c-97fe-42ee-a294-19cacfb916cd |
| 2 | Diagnostic and Fix Phase 1 (Tiers 1-4) | Decompose by test tier and fix stream/DB/fetch issues until Tier 1-4 tests pass | M1 | IN_PROGRESS | 32db2e90-c879-4e6e-ba1c-eca22a825ca7 |
| 3 | Adversarial Hardening Phase 2 (Tier 5) | Perform adversarial white-box testing, fix coverage gaps | M2 | PLANNED | TBD |

## Interface Contracts
### Client ↔ API Endpoints
- **Endpoints**: `/v1/chat/completions`, `/v1/messages`
- **Protocol**: HTTP/1.1 or HTTP/2
- **Response Headers**:
  - `Content-Type: text/event-stream` (when `stream: true`)
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
- **Output Format**: Standard SSE stream formatted as `data: {...}` lines ending with `data: [DONE]`. No buffering or delaying allowed.
