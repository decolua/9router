# 014 — Kimi (Kimi Code / coding-plan) Quota Tracker

## Goal
Surface **Kimi coding-plan** (a.k.a. "Kimi for coding" / Kimi Code membership) quota/usage in the
DurinDoor dashboard — remaining quota, reset time, rate-limit status — alongside the existing
per-provider quota rows.

## CRITICAL: this is a SPIKE-first plan
Web research (2026-06-22) found **no officially-documented authenticated endpoint that returns
Kimi *coding-plan* quota**. The two Kimi surfaces are distinct products and must not be conflated:

| Surface | What it is | Quota source |
|---|---|---|
| **Kimi Code** (coding plan) | `https://api.kimi.com/coding/v1` (OpenAI-compat) + `https://api.kimi.com/coding/` (Anthropic-compat); model `kimi-for-coding` | **UNKNOWN** — only visible via `https://www.kimi.com/code/console` (browser) or the Kimi Code CLI `/usage` command. No documented quota API. |
| **Moonshot Open Platform** (pay-as-you-go) | `https://api.moonshot.ai` | `GET /v1/users/me/balance` (returns balance) — **WRONG PRODUCT**; this is pay-go balance, NOT coding-plan membership quota. |

⚠️ Do **NOT** implement the tracker against `/v1/users/me/balance` — it is the wrong product and
will show meaningless numbers for a coding-plan user.

## Phase 0 — SPIKE: source discovery (do this FIRST, blocking)
Determine whether a programmatic source for Kimi coding-plan quota exists, its auth, and its
response shape. Techniques (no web fetch available in this env — use runtime tracing):
1. **Browser network trace** of `https://www.kimi.com/code/console` (DevTools → Network): capture
   the XHR/fetch the console makes to populate "remaining quota / rate-limit status". Record:
   URL, method, auth header shape (Bearer? cookie? custom), request body, and the **response JSON
   shape** (fields for remaining/used/total/reset).
2. **CLI network capture**: run the Kimi Code CLI `/usage` command under a proxy/mitm (or
   `NODE_DEBUG`/strace) to capture the endpoint + auth the CLI hits.
3. Classify the discovered source:
   - **(A) Authenticated JSON API** (best) → proceed to Phase 1 adapter.
   - **(B) CLI-output only** → adapter shells out to `/usage` and parses text (fragile; document).
   - **(C) Browser-only / cookie-auth console** (no stable token API) → **STOP** (scraping is
     brittle + likely ToS-violating; not worth a tracker).

**Spike deliverable:** a short findings note (URL + auth + response shape + classification A/B/C)
checked into this file's "Spike findings" section below. Phase 1 is GATED on classification A or B.

## Phase 1 — Adapter (only after spike finds source A or B)
Mirror the proven per-provider usage-adapter pattern. Reference template:
`open-sse/services/usage/kiro.js` (`getKiroUsage(accessToken, providerSpecificData, proxyOptions)` →
provider API → `parseKiroQuotaData(data)` → `{ quotaInfo, resetAt, … }`).

1. **Create `open-sse/services/usage/kimi.js`** — `getKimiUsage(accessToken, providerSpecificData, proxyOptions)`:
   - For source A: `proxyAwareFetch(<discovered-url>, { headers: <discovered-auth> })`, parse per the
     spike's response shape into the shared quota structure (remaining/used/total + `resetAt` via
     `parseResetTime`).
   - For source B: shell to the CLI `/usage`, parse text.
   - Reuse `U` / `parseResetTime` from `./shared.js`. Handle auth errors (401/403) like kiro.js does
     (return a `sawAuthError`-style fallback message, don't crash the usage panel).
2. **Normalize** into the existing `parseQuotaData` / `quotaInfos` / `remainingPercentage` shape in
   `open-sse/services/usage/normalize.js` (add a kimi branch) — do NOT invent a new shape.
3. **Wire** the dispatcher in `src/app/api/usage/[connectionId]/route.js` to call `getKimiUsage` for
   Kimi/Moonshot connections (reuse the connection's stored credentials — same auth the Kimi executor
   uses for chat).
4. **Surface in the EXISTING UI** — `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/`
   (`QuotaTable.js`, `QuotaProgressBar.js`, `ProviderLimitCard.js`). **No new UI component.** Kimi
   just becomes another row in the existing quota table once the adapter feeds it.
5. **Tests:** `tests/unit/kimi-usage.test.js` — mock the discovered endpoint, assert parsing →
   quotaInfo + remainingPercentage + resetAt; assert auth-error fallback. (Mirror
   `tests/unit/kiro-usage.test.js` if one exists.)

## Validation
- `npx vitest run tests/unit/kimi-usage.test.js`
- `npm run build` (UI route change)
- `npm run test:baseline` (32==32, no regression)
- Manual: a real Kimi coding-plan connection shows a quota row with sane remaining% + reset time.

## STOP conditions
- Spike classification = **C** (browser-only, no token API) → do NOT build a scraper; close as
  infeasible until Kimi exposes an API.
- Discovered endpoint requires credentials the dashboard doesn't already hold (e.g. a web session
  cookie) → flag; don't ask users to paste cookies.
- Response shape can't be mapped to remaining/used/total/reset → document + defer.

## Spike findings
_(to be filled by the Phase-0 spike — URL / auth / response shape / classification A|B|C)_

## Research sources (2026-06-22)
- Kimi Code console: https://www.kimi.com/code/console
- Kimi Code API (model calls only): https://api.kimi.com/coding/v1 (OpenAI-compat), https://api.kimi.com/coding/ (Anthropic-compat)
- Moonshot pay-go balance (WRONG product): GET https://api.moonshot.ai/v1/users/me/balance
- Kimi Code CLI `/usage` command (per Kimi Help Center FAQ)
