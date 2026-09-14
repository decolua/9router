---
name: antigravity-oauth-endpoint
description: Run and extend the standalone consent-based Antigravity OAuth proxy, which connects a user-owned account through browser OAuth and exposes authorized models through a normal OpenAI-compatible local endpoint without requiring 9Router. Use when setting up, securing, diagnosing, or extending that proxy. Do not use to extract, import, scrape, intercept, or reuse credentials from an IDE, browser profile, another application, or another user.
---

# Antigravity OAuth Endpoint

Use `tools/antigravity-oauth-proxy`, a self-contained Node service. Treat access and refresh tokens as secrets; never print, export, log, or ask a user to paste them.

## Workflow

1. Confirm the user owns the account and wants to authorize it. Explain that the browser login happens with Google and that Antigravity subscription/OAuth use may be subject to the provider's terms.
2. Configure `AG_PROXY_MASTER_KEY`, a registered OAuth client ID/secret, and a separate `AG_PROXY_API_KEY`. Start the service with `npm start` in `tools/antigravity-oauth-proxy`.
3. Start consent at `GET /auth/start`. The callback validates an in-memory state and PKCE verifier, then persists the returned connection encrypted at rest. Do not add token-file, browser-cookie, IDE-store, clipboard, or MITM import paths.
4. Verify the gateway with `GET /health`, then discover models with `GET /v1/models` and call `POST /v1/chat/completions` with `model: "antigravity/<model-id>"`.
5. Keep the listener local by default. Configure TLS and authenticated network access separately before any remote exposure.
6. Add each owned account with a separate consent flow. Use the redacted `/admin/accounts` and `/admin/status` endpoints to observe expiry, refresh state, request metrics, assignment, and per-model cooldowns.
7. Set `/admin/settings` to `round-robin` or `priority`. Restrict an account with `allowedModels` when needed. On expiry, preserve the rotated refresh token and fetch/persist the current project ID; do not expose token values or use account rotation to circumvent provider limits.

## Endpoint Examples

Set the standalone gateway URL and its gateway API key, not an Antigravity OAuth token:

```bash
export AG_PROXY_URL="http://127.0.0.1:8788"
export AG_PROXY_API_KEY="..."

curl "$AG_PROXY_URL/v1/models" \
  -H "Authorization: Bearer $AG_PROXY_API_KEY"

curl "$AG_PROXY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $AG_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "antigravity/gemini-3-flash-agent",
    "messages": [{"role": "user", "content": "Reply with OK."}],
    "stream": false
  }'
```

The standalone service currently serves OpenAI Chat Completions only. Add other client formats only with explicit request/response translation and tests. Read [references/standalone-pipeline.md](references/standalone-pipeline.md) before changing the connection or translation pipeline.

## Security Requirements

- Require an explicit authorization action in a browser owned by the user.
- Keep OAuth and 9Router API credentials server-side; redact them from diagnostics, tests, and artifacts.
- Require a gateway API key and TLS/authenticated tunnel before any remote exposure. Do not advertise a public unauthenticated endpoint.
- Validate OAuth `state` and bind authorization-code exchange to a short-lived, server-side PKCE session when modifying the OAuth flow.
- Implement disconnect by deleting the selected connection and clearing its in-memory project/session cache; do not retain revoked credentials.
- Return provider errors and connection metadata without access tokens, refresh tokens, ID tokens, or cookie values.

## Source Map

- Service implementation: `tools/antigravity-oauth-proxy/server.mjs`
- Runtime configuration and API instructions: `tools/antigravity-oauth-proxy/README.md`
