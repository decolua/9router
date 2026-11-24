# Daily Check-in (auto sign-in for free-credit providers)

9router has no check-in capability: provider adapters only *read* quota
(`open-sse/services/usage/*`), and nothing claims a daily reward. This document
covers the design of the daily check-in feature, the protocol judgements it
depends on, and what has and has not been verified against real accounts.

Code map:

| Layer | File |
|---|---|
| Protocol (per-provider HTTP) | `src/shared/services/checkinProviders.js` |
| Scheduling + state file | `src/shared/services/checkinScheduler.js` |
| API | `src/app/api/checkin/route.js` |
| Dashboard UI | `src/app/(dashboard)/dashboard/checkin/` |
| Tests | `tests/unit/checkin-*.test.js` |

## 1. Providers covered

| Provider | Endpoint | Idempotent when | Idempotent HTTP | Verified against real accounts |
|---|---|---|---|---|
| `codebuddy-cn` | `POST https://copilot.tencent.com/v2/billing/meter/daily-checkin` | `code: 10001` / `1001` | **400** | ✅ 7/7 accounts |
| `codebuddy-intl` | `POST https://www.codebuddy.ai/v2/billing/meter/daily-checkin` | same | 400 | ⚠️ same protocol, no account available |
| `qoder` | `POST https://openapi.qoder.sh/sash/api/v1/me/campaigns/{id}/claim` | `replayed: true` | 200 | ✅ real response |
| `qoder-cn` | `POST https://openapi.qoder.com.cn/sash/api/v1/me/campaigns/{id}/claim` | `replayed: true` | 200 | ✅ real response |
| `minimax` | `POST https://agent.minimax.cn/minimax-cloud/api/v1/signin/claim?timezone_id=` | `claim_result: 2` | 200 | ⚠️ credential expired (401); only the failure path was exercised |

**Explicitly unsupported** (returns a reason without issuing any upstream
request): `cline` (no check-in endpoint), `workbuddy` (no such endpoint for the
international product), `raccoon` (daily credits are granted server-side).

> Provider ids here follow 9router's registry (`codebuddy-cn` /
> `codebuddy-intl`), not any other naming. `codebuddy-intl` shares the CN
> protocol on a different host, which is why it has an implementation but is
> flagged as not live-verified.

## 2. Touch points — additive only

| File | Change |
|---|---|
| `src/lib/db/repos/settingsRepo.js` | add `autoCheckin: { enabled: false, providers: {} }` to `DEFAULT_SETTINGS` |
| `src/instrumentation.js` | startup branch in `register()` (**primary entry point**, see below) |
| `src/shared/services/initializeApp.js` | one **redundant** branch in deferred startup |
| `src/shared/services/checkinProviders.js` | **new** — protocol layer, no `@/` imports |
| `src/shared/services/checkinScheduler.js` | **new** — scheduling + state file |
| `src/app/api/checkin/route.js` | **new** — API |
| `src/app/(dashboard)/dashboard/checkin/` | **new** — dashboard page |
| `src/shared/components/Sidebar.js` | one nav entry |
| `tests/unit/checkin-*.test.js` | **new** — offline regression |

No existing route, executor, or provider registry is modified, so the request
path is untouched.

### ⚠️ The scheduler must be wired into `instrumentation.js`, not only `initializeApp`

`initializeApp.js` is reached through
`src/app/layout.js` → `bootstrap.js` → `initializeApp()`, and **`layout.js` only
runs when a page is rendered**.

Measured: with the app up and only API traffic (`/api/health`, `/api/version`),
the scheduler's start line never appears and the state file is never touched.

⇒ A gateway that serves only API traffic — which is how 9router is typically
deployed; the dashboard is incidental — would **silently never check in**.

`register()` in `src/instrumentation.js` is Next's Node-runtime server hook and
runs once at boot regardless of traffic, so it is the primary entry point. The
`initializeApp.js` call is kept as a redundant safety net:
`configureCheckinScheduler` is idempotent (it guards on an existing timer held in
`global.__checkinScheduler`), so both firing is harmless.

### Authentication comes for free, but was checked

The route lives at `/api/checkin` (**not** `/api/v1/*`), so it falls into the
deny-by-default branch of `dashboardGuard.js` and requires a dashboard session or
CLI token.

> It is deliberately **not** added to `PUBLIC_PREFIXES` (`/api/v1`): check-in is a
> **write** operation, and putting it behind a public prefix would expose an
> unauthenticated "claim on my behalf" endpoint.

### Logging note

`initConsoleLogCapture()` replaces `console.*` with an in-memory ring buffer for
the dashboard log viewer, so anything the scheduler logs with `console.log` is
**invisible in `docker logs`**. The scheduler therefore writes diagnostics with
`process.stdout.write`.

## 3. Protocol judgements (each one corresponds to a real failure)

1. **Idempotency is decided from the response body, never the status code.**
   `codebuddy` returns **HTTP 400 + `code:10001`** when already claimed. Testing
   the status code alone reports "already claimed" as a **failure**. Measured:
   all 7 local accounts took this branch.

2. **Do not use `response.json()`.**
   With an expired credential the gateway returns an **HTML error page**, and
   `json()` throws `Unexpected token '<'` — hiding the real cause (reconnect the
   account). Always `text()` + manual parse.

3. **"Nothing to claim" ≠ "already claimed".**
   Qoder's claimed test must be "a campaign exists with
   `actionType === 'CLAIM_BENEFIT'` **and** `claimStatus === 'CLAIMED'`", never
   "there is no claimable item, therefore claimed". The latter misfires while the
   campaign list has not refreshed, and that error direction is **irreversible**
   (the day is genuinely missed). Measured: `qoder-cn` exposes both
   `VIEW_DETAILS` and `CLAIM_BENEFIT/CLAIMED`.

4. **`active` is always `true` once a response is received.**
   Qoder clears `campaigns` and returns `showCampaign:false` after claiming. If
   `active` were derived from "the list is non-empty", the caller would hit the
   "campaign not open" branch first and report a claimed day as "not open".

5. **HTTP 401/403 must be classified as an expired credential**, not allowed to
   fall into the "not checked in today" default. This is a real misfire found
   while implementing: `minimax` returns `401 {"error":"invalid access token"}`,
   which is **valid JSON**, so a parse-based check cannot see it. Guarded by a
   regression test. Safe because `codebuddy`'s idempotent branch is **400**, not
   401/403.

6. **Serial, provider by provider and account by account. Never concurrent.**
   One round is `providers × accounts` upstream requests; pacing is deliberate.

7. **"Handled today" is not "did anything succeed".**
   The date is recorded only when at least one `claimed` or `already-claimed`
   result exists. A round that fails entirely records **nothing** and retries
   later — otherwise one upstream hiccup loses the day.

8. **Opt-in, default off.** Check-in spends upstream quota on the user's behalf,
   and 9router is a multi-user gateway. Default-on would consume quota without
   consent and invite rate limiting.

## 4. Time zones

- `codebuddy` / `qoder`: the daily allowance settles on **UTC+8**, so the day
  boundary is computed with an **arithmetic shift** (`utc8DateString`).
  Using the host time zone is wrong in both directions — east of UTC+8 records
  the day too early (a real miss), west of it runs twice.
- `minimax`: the exception. It settles on the **client-reported IANA zone**;
  `timezone_id` is a required query parameter and UTC+8 must **not** be
  substituted.

## 5. API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/checkin` | Status: switch, whether it ran today, last per-provider result, supported providers and their account counts |
| `GET` | `/api/checkin?probe=1` | **Read-only** live upstream status (one request per account, claims nothing) |
| `POST` | `/api/checkin` | **Run one round** (write). Bypasses the "already ran today" guard |
| `POST` | `/api/checkin?dryRun=1` | Read-only probe (same as `probe=1`) |
| `POST` | `/api/checkin?provider=<id>` | Run one provider only (invalid id ⇒ 400) |
| `PATCH` | `/api/checkin` | Change switch / delay / provider selection |

`PATCH` body:

```json
{ "enabled": true, "delayMs": 30000, "providers": { "codebuddy-cn": true, "qoder-cn": true } }
```

## 6. State file

`DATA_DIR/checkin-state.json`, written atomically (tmp + rename):

```json
{
  "lastDate": "2026-10-15",
  "lastAt": 1792000000000,
  "lastMarked": true,
  "channels": [
    { "provider": "codebuddy-cn", "label": "CodeBuddy CN", "accounts": 7, "alreadyClaimed": 7, "failed": 0 }
  ]
}
```

It is a **separate file rather than a settings entry** because it is runtime
state, not user configuration — merging it into settings would let a
settings export/import carry away or overwrite check-in progress.

## 7. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `NINEROUTER_CHECKIN_DELAY_MS` | `30000` | Delay before the first round at boot. **`0` is valid** (run immediately) |

> Do not write `Number(env.X) || default`: `0` is both valid and falsy, so it
> would be silently replaced by 30 s. The code tests
> `Number.isFinite(parsed) && parsed >= 0` explicitly.

## 8. Tests

```bash
cd tests && npx vitest run unit/checkin-providers.test.js unit/checkin-scheduler.test.js unit/checkin-i18n.test.js
```

Covers, offline and without touching a real database:

- every idempotency branch (`400`+`code:10001`/`1001`, `replayed`, `claim_result`) and the misfires above
- expired-credential classification, HTML error pages
- the UTC+8 day boundary, and `minimax` using the reported IANA zone
- selection semantics: empty `providers` means all; `only` bypasses the opt-in filter
- one account failing must not abort the round
- user-facing strings must be English (the runtime i18n looks up **English
  source strings**, so a Chinese source string is never translated and would
  render verbatim in the English UI)

## 9. Known limits

1. **`codebuddy-intl` is not verified against a real account.** The endpoint is
   inferred from the CN registry entry (same path, different host).
   `listCheckinProviders()` reports `verified:false` for it rather than
   pretending otherwise.
2. **`minimax` success path is unverified.** The only available credential was
   expired (401), so only the failure path was exercised.
3. **`qoder`'s `CLAIM_BENEFIT` claim is unverified.** The available `qoder`
   (international) connection only exposed `VIEW_DETAILS`; only `qoder-cn`
   showed the `CLAIM_BENEFIT/CLAIMED` shape. The endpoint follows the protocol
   above, and the `replayed` idempotency judgement is implemented but untested
   live.
4. **Connections with `isActive === false` are skipped** — treated as
   deliberately excluded by the user.
