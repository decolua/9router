# Antigravity OAuth Proxy

Standalone, consent-based local OAuth proxy. It uses no 9Router code or runtime dependencies.

## Run

```bash
cd tools/antigravity-oauth-proxy
export AG_PROXY_MASTER_KEY="a long unique secret"
export AG_OAUTH_CLIENT_ID="your registered OAuth client ID"
export AG_OAUTH_CLIENT_SECRET="your registered OAuth client secret"
export AG_PROXY_API_KEY="a separate key for API clients"
npm start
```

Open `http://127.0.0.1:8788/auth/start?name=Primary&priority=1` in each account owner's browser. Optional `models=model-a,model-b` assigns an account to only those models. The OAuth client's redirect URI must be registered as `http://127.0.0.1:8788/auth/callback` (or set `AG_PROXY_REDIRECT_URI` to a registered local callback).

Then use the normal local endpoint:

```bash
curl http://127.0.0.1:8788/v1/chat/completions \
  -H "Authorization: Bearer $AG_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"antigravity/gemini-3-flash-agent","messages":[{"role":"user","content":"Reply with OK."}]}'
```

The encrypted local store lives in `.data/accounts.enc.json`; it requires the same `AG_PROXY_MASTER_KEY` at every restart. Do not expose the listener publicly. Put TLS and authenticated network access in front of it before any remote use.

## Multi-account routing and observability

The encrypted store supports multiple user-consented accounts. Default routing is least-recently-used round robin among enabled accounts assigned to the requested model. Set `AG_PROXY_ROUTING_STRATEGY=priority`, or update it at runtime:

```bash
curl -X PATCH http://127.0.0.1:8788/admin/settings \
  -H "Authorization: Bearer $AG_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"strategy":"round-robin"}'
```

All admin output is redacted: it never returns access tokens, refresh tokens, ID tokens, or cookies.

| Endpoint | Purpose |
|---|---|
| `GET /admin/accounts` | List assigned accounts, expiry state, metrics, and active per-model cooldowns. |
| `GET /admin/status` | Get aggregate requests/successes/failures and account status. |
| `GET/PATCH /admin/settings` | Read or set `round-robin` / `priority` routing. |
| `PATCH /admin/accounts/:id` | Change name, enabled state, priority, or `allowedModels`. |
| `DELETE /admin/accounts/:id` | Disconnect and erase one local account record. |
| `POST /admin/accounts/:id/models/refresh` | Refresh the models available to that account. |

The proxy refreshes a token five minutes before expiry. Upstream 429/5xx responses produce a model-specific cooldown and attempt another eligible, user-authorized account; non-transient failures return to the caller. Use this only within the provider's authorized terms and account permissions.

Current API coverage: `GET /health`, consent OAuth at `/auth/start`, OpenAI model discovery at `GET /v1/models`, redacted admin endpoints, and OpenAI Chat Completions at `POST /v1/chat/completions` with basic text messages and SSE streaming.
