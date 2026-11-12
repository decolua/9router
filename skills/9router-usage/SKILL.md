---
name: 9router-usage
description: Token/cost usage and per-connection quota via the 9Router dashboard REST API (`/api/usage/*`, `/api/providers`). Use when the user asks how much they have spent, which models burned the most tokens, or how much quota is left on a provider account.
---

# 9Router — Usage & Quota

Requires `NINEROUTER_URL` (and `NINEROUTER_KEY` if auth enabled). See https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md for setup.

Quota is **not** exposed on `/v1/*`. It lives on the dashboard API at `/api/*`, which is session-guarded — `GET /v1/models` returning 200 proves nothing about auth or quota.

## Auth

```bash
export NINEROUTER_PASS="..."   # dashboard password

# Password login; stores the session cookie in 9r.jar
curl -s -c 9r.jar -X POST "$NINEROUTER_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"password\":\"$NINEROUTER_PASS\"}" >/dev/null
```

The cookie is the reliable path for `/api/*` — that is what the dashboard itself uses. `NINEROUTER_KEY` (a `sk-` dashboard key) authenticates `/v1/*`; do not assume it works on `/api/*`. A `401` on any call below means the cookie is missing, stale, or the password is wrong — re-run the login. Use `-b 9r.jar` on every request, and don't leave `9r.jar` in a shared directory.

## What this gateway burned (this machine's own logs)

`?period=` is required reading: valid values are `today`, `24h`, `7d` (**default**), `30d`, `60d`, `all`; anything else returns `400 {"error":"Invalid period"}`. Quote the window when reporting a number — 7 days and all-time differ by orders of magnitude on an active instance.

```bash
curl -s -b 9r.jar "$NINEROUTER_URL/api/usage/stats?period=all" | jq '{
  requests: .totalRequests,
  in: .totalPromptTokens,
  cached: .totalCachedTokens,
  out: .totalCompletionTokens,
  cost: .totalCost,
  byProvider: .byProvider,
  byModel: .byModel
}'
```

`byModel` / `byProvider` are `{ "<key>": { requests, promptTokens, completionTokens, cachedTokens, cost } }` — the top-level totals use `total*` names, the nested buckets do **not**. Sort them yourself; the API does not rank:

```bash
curl -s -b 9r.jar "$NINEROUTER_URL/api/usage/stats" \
  | jq -r '.byModel | to_entries | sort_by(-.value.promptTokens) | .[:10][]
      | "\(.value.requests)\t\(.value.promptTokens)\t\(.value.cost)\t\(.key)"'
```

`byModel` keys are `"<model> (<provider>)"`. Extra buckets: `byAccount`, `byApiKey`, `byEndpoint`, plus `last10Minutes` and `pending` for live activity.

This is local aggregation over `usage.json` — fast, no upstream calls.

## Quota left per provider account (upstream state)

Two hops: list connections, then query each by **connection UUID**.

```bash
curl -s -b 9r.jar "$NINEROUTER_URL/api/providers" \
  | jq -r '.connections[] | "\(.provider)\t\(.name)\t\(.id)"'

curl -s -b 9r.jar "$NINEROUTER_URL/api/usage/<connectionId>"
```

Response on success:

```json
{ "plan": "Free",
  "quotas": { "Allowance ($)": {
    "used": 0, "total": 0, "remainingPercentage": 0,
    "resetAt": "2026-11-19T08:28:04Z", "unlimited": false, "unit": "USD" } } }
```

On a provider without tracking, the response is `{ "message": "..." }` (sometimes with `plan` and an empty `quotas: {}`). Loop over every connection in one call:

```bash
curl -s -b 9r.jar "$NINEROUTER_URL/api/providers" | jq -r '.connections[].id' | tr -d '\r' \
  | while read -r id; do
      printf '%s\t' "$id"
      curl -s -b 9r.jar "$NINEROUTER_URL/api/usage/$id" \
        | jq -r '[.plan // "-", (.message // (.quotas | to_entries | map("\(.key)=\(.value.remainingPercentage)%") | join(", ")))] | @tsv' \
        | tr -d '\r'
    done
```

Output: `<id>  <plan>  <quota summary | upstream message>`.

Sequential is fine for a handful of connections; parallelise (or cache) if the user has dozens — each hop makes a live upstream call and is rate-limit-sensitive.

## Where the numbers come from — do not mix them up

- `/api/usage/stats` (+ `history`, `logs`, `request-logs`, `chart`) = **this gateway's** consumption, from local logs.
- `/api/usage/<connectionId>` = **upstream account** state, fetched live from the provider.
- Never answer "how much have I used" with the second, or "how much is left" with the first.

## Provider support

`getUsageForProvider` (`open-sse/services/usage.js`) dispatches through a `USAGE_HANDLERS` map. Handlers exist for:

`github`, `gemini-cli`, `antigravity`, `claude`, `codex`, `kiro`, `qoder`, `qoder-cn`, `iflow`, `ollama`, `glm`, `glm-cn`, `minimax`, `minimax-cn`, `minimax-code`, `minimax-code-global`, `vercel-ai-gateway`, `codebuddy-cn`, `codebuddy-intl`, `grok-cli`, `kimi`, `opencode-go`, `opencode-zen`, `deepseek`, `groq`, `zed`, `xiaomi-mimo`, `commandcode`, `cursor`, `clinepass`

Anything else returns `{ "message": "Usage API not implemented for <provider>" }` — providers that pass the gate below but have no handler (e.g. `kilocode`, `nous`).

**API-key connections are gated too.** `GET /api/usage/<id>` short-circuits *before* handler dispatch with `{ "message": "Usage not available for this connection" }` unless the connection is `authType: "oauth"` *or* its provider is in `USAGE_APIKEY_PROVIDERS`. That single check is why multiple openrouter seats all report the same "not available" — the gap is per provider, not per account — and why an api-key provider can be fully supported by inference and still show no quota.

Other observed messages and what they mean:

| Message | Meaning |
|---|---|
| `Usage fetch returned 401` / `quota API rejected the current token` | Credential problem on an otherwise working connection (qoder, kiro) |
| `project ID not available` | gemini-cli needs a GCP project with Gemini Code Assist access |
| `No rate-limit data reported for this key yet` | groq; headers only exist after traffic |
| `Credential refresh failed: …` (401) | OAuth token refresh failed; reconnect the account |

Absence of data is **not** evidence of zero quota — report the message verbatim. Per-provider tracking gaps are consolidated upstream in [decolua/9router#3701](https://github.com/decolua/9router/issues/3701).

## Pitfalls

- `/api/usage/<providerName>` returns `404 {"error":"Connection not found"}` — it needs the connection **UUID** from `/api/providers`.
- **Reading quota can refresh OAuth credentials.** For `authType: "oauth"`, the GET path runs `refreshAndUpdateCredentials` before fetching usage, and retries once with a forced refresh on auth-expired messages. `?force=1` skips the `needsRefresh` check and always refreshes. Harmless normally, but do not poll it in a tight loop, and don't do it while another process is mid-refresh (a stale-snapshot refresh can invalidate the session).
- A 401 on these endpoints is usually the **dashboard** session expiring, not the provider: re-login, then re-check before reporting a provider credential problem.
- The provider gap is per *provider*, not per account: every openrouter seat returns the same "not available", so don't report it N times.
- `total: 0` with `remainingPercentage: 0` means *no allowance configured*, not *quota exhausted*. Say "no allowance reported" rather than "0% left".
- `unlimited: true` makes `remainingPercentage` meaningless — report "unlimited".
- A connection can have `errorCode` / `lastError` (e.g. 402 from upstream) while usage still reports fine; show both when diagnosing.
- The dashboard page (`/dashboard/quota`) is the same data in the browser — link it when the user wants to eyeball it.
- On Windows, `jq` emits CRLF: pipe through `tr -d '\r'` before `while read`, or the trailing `\r` ends up inside the connection id and every follow-up call returns empty.

## Other endpoints

`/api/usage/history`, `/api/usage/logs`, `/api/usage/request-logs`, `/api/usage/chart`, `/api/keys`, `/api/provider-nodes` — same origin, same session cookie.
