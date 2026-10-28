# Standalone Antigravity Proxy Pipeline

## Consent-based connection lifecycle

`GET /auth/start` creates an authorization URL and a short-lived PKCE/state pair. The user authenticates in the browser. `GET /auth/callback` validates state, exchanges the authorization code, fetches account email and Code Assist project metadata, and writes an encrypted local connection.

The encrypted store holds multiple user-owned connections, each with identity, access-token expiry, refresh token, project ID, allowed-model assignment, per-model cooldowns, and local request metrics. No endpoint returns token fields. Refresh writes replace the encrypted record atomically; do not run multiple service instances against the same store.

## Serving a normal endpoint

`POST /v1/chat/completions` accepts an OpenAI Chat Completions text request. A model value such as `antigravity/gemini-3-flash-agent` selects the upstream model. The service chooses an enabled, model-eligible account by least-recently-used round robin or priority, refreshes expiring credentials, resolves the project ID, translates messages to the Cloud Code envelope, and sends the authorized request upstream. A rate-limit or transient upstream failure creates a model-scoped cooldown and tries another eligible account.

The response is normalized to OpenAI Chat Completions JSON or SSE chunks. The standalone service does not reuse 9Router's translator or executor modules.

## Operational checks

1. Confirm `GET /api/health` succeeds.
2. Set `AG_PROXY_API_KEY` before using a non-local URL.
3. Complete user-consented login at `/auth/start` for every account; do not inspect the encrypted store.
4. Query `GET /admin/status` to confirm redacted expiry and routing state, then `GET /v1/models` to choose an advertised `antigravity/...` model.
5. Send a minimal non-streaming chat request and confirm the selected account's redacted metrics change.

Never use real access/refresh tokens in test fixtures. Use mocks or an opt-in test isolated from logs and source control.
