# Learnings — track-kenari-usage

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## Todo 4 � Public endpoint capture (2026-09-09)

- Both endpoints are live and truly public (no auth): GET /v1/models -> 200 (76 models), GET /api/public/pricing -> 200 (76 items, top-level keys: free_tier, items, usd_idr_rate=17500).
- kenari pricing unit is micro-IDR per 1M tokens (NOT USD). Field names in pricing.json items: price_in_micro_idr_per_1m, price_out_micro_idr_per_1m, price_cached_micro_idr_per_1m, price_cache_write_micro_idr_per_1m. models.json embeds the same numbers under pricing.{input,output,cache_read,cache_write} with unit:"micro_idr_per_1m_tokens", currency:"IDR". null = dimension not offered (most models have cache_write:null).
- pricing.json also carries market_in/market_out_micro_idr_per_1m (market reference) and pricing_lines[] with {billable, endpoint, micro_idr, unit, variant} � unit can be token_1m, image, second, 1k_chars for non-chat models.
- Seed ids confirmed in BOTH fixtures for Todo 1 registry: step-3-7-flash, glm-5-3-flash, gemini-2-5-flash-lite, gpt-oss-120b.
- GOTCHA: kenari.id serves an HTML SPA catch-all for unknown GET paths � every bogus GET returns 200 text/html (incl. /api/public/does-not-exist). Real non-200 only via method mismatch (POST/DELETE -> 405). The fetch layer must validate Content-Type/JSON.parse, not just HTTP status.
- Windows shell note: curl.exe spawn fails with uv_spawn in this environment; node fetch works fine.

## Todo 1 — registry entry (2026-09-09)

- Created `open-sse/providers/registry/kenari.js` modeled on groq.js (plain apikey, single-endpoint OpenAI format, no oauth/transports). `transport.format` omitted (defaults to "openai").
- Seed model `owned_by` values from models.json: step-3-7-flash→stepfun, glm-5-3-flash→z-ai, gemini-2-5-flash-lite→google, gpt-oss-120b→openai. Names derived: "Step 3.7 Flash", "GLM 5.3 Flash", "Gemini 2.5 Flash Lite", "GPT-OSS 120B" (matches groq.js's existing "GPT-OSS 120B" naming).
- `passthroughModels: true` set so unlisted kenari models stay routable. `features: {usage:true, usageApikey:true}` per groq.js analog.
- Added code comment above transport.usage: quota endpoint rejects shared keys (403 shared_key_not_allowed) — context for Todo 6.
- Acceptance: `node -e "import('./open-sse/providers/registry/kenari.js').then(m=>console.log(m.default.id, m.default.category, m.default.passthroughModels))"` prints `kenari apikey true` (exit 0). Node emits a benign MODULE_TYPELESS_PACKAGE_JSON warning on this repo (no "type":"module" in root package.json) — not an error.
- Did NOT touch registry/index.js (Todo 2).

## Todo 2 — hand-register kenari in registry/index.js (2026-09-09)

- Added `import p125 from "./kenari.js";` immediately after `import p124 from "./xquik.js";` (line 127) and `p125,` as the last array entry before `];` (line 253). Diff is exactly +2 lines, nothing else touched.
- p125 confirmed as the next unused number: highest existing is p124; gaps (p101/p102/p104/p114/p123) are pre-existing and were left alone.
- Acceptance: `node -e "import('./open-sse/providers/index.js').then(m=>console.log(!!m.PROVIDERS.kenari, m.PROVIDER_MODELS.kenari?.length>=0))"` prints `true true` (exit 0).
- Negative check (plan QA-failure): with the `p125,` array entry removed but the import kept, the same command prints `false false` — proving the array entry is what registers the provider into PROVIDERS/PROVIDER_MODELS. Restored the entry; final state re-verified `true true`.
- Note: the file's "Auto-generated" header is stale — no working generator exists; hand-editing is the sanctioned path. Do not run scripts/migrate-registry.mjs.

## Todo 7 — kenari pricing in open-sse/providers/pricing.js (2026-09-09)

- Added `export const KENARI_IDR_PER_USD = 17500;` just above `PROVIDER_PRICING` (source: tests/fixtures/kenari/pricing.json top-level `usd_idr_rate`, fetched 2026-09-09, manual snapshot not live).
- Added `PROVIDER_PRICING.kenari` sibling block (after tokenrouter, before closing `};`). Conversion formula: `usdPerMillion = microIdrPer1M / 1_000_000 / 17500`.
- Computed values (raw micro-IDR/1M → USD/1M):
  - step-3-7-flash: input 4,200,000,000 → 0.24; output 24,000,000,000 → 1.371429; cached 840,000,000 → 0.048; cache_write null → OMITTED
  - glm-5-3-flash: input 15,000,000 → 0.000857; output 50,000,000 → 0.002857; cached 2,500,000 → 0.000143; cache_write null → OMITTED
  - gemini-2-5-flash-lite: input 400,000,000 → 0.022857; output 1,700,000,000 → 0.097143; cached 40,000,000 → 0.002286; cache_write 350,000,000 → 0.02 (cache_creation)
  - gpt-oss-120b: input 630,000,000 → 0.036; output 3,500,000,000 → 0.2; cached 63,000,000 → 0.0036; cache_write null → OMITTED
- Rule applied: fixture `null` cache_write → omit `cache_creation` field entirely (cost calc falls back to `pricing.cache_creation || pricing.input`). Only a genuine zero rate would be escalated; null = not offered.
- Exact comment text used above the kenari block: "Kenari — rates converted from kenari's own pricing fixture (tests/fixtures/kenari/pricing.json, captured via public GET /api/public/pricing, no auth, fetched 2026-09-09). Fixture unit is micro-IDR per 1M tokens; converted to USD/1M with KENARI_IDR_PER_USD (kenari's own usd_idr_rate field). Manual refresh only, not live. cache_creation omitted where the fixture has null cache_write (dimension not offered) — the cost calculator falls back to pricing.input in that case."
- Verification: `getPricingForModel('kenari', <each seed>)` returns the objects above; `git diff` shows ONLY the kenari block + KENARI_IDR_PER_USD constant, nothing else touched. No build/test run (Windows workstation).

## Todo 3 — mocked-upstream usage tracking test (2026-09-09)

- Added `tests/unit/kenari-tracking.test.js`. Harness combines `groq-usage.test.js` proxyAwareFetch mocking with `cached-token-e2e.test.js` temporary DATA_DIR + real SQLite setup; `db-concurrent.test.js` also exercises saveRequestUsage against real SQLite. `embedding-usage-persistence.test.js` only spies on persistence, so it is not the DB integration precedent.
- Real path under test: DefaultExecutor (kenari registry URL/auth) -> mocked HTTP response -> handleNonStreamingResponse -> extractUsageFromResponse -> saveUsageStats -> canonicalizeUsage -> real saveRequestUsage -> usageHistory/usageDaily -> getUsageHistory/getUsageStats. Outer routing/account selection and streaming are explicitly outside this test; observability detail writes are stubbed.
- saveUsageStats is fire-and-forget and returns void. A partial usageDb mock wraps actual.saveRequestUsage with vi.fn and awaits its recorded promise, without replacing persistence or relying on sleeps. Exactly one call and exactly one SQL row are asserted.
- Non-streaming extraction omits total_tokens; storage assertions use exact prompt=123, completion=45, sum=168. Client-facing usage gets a separate 2000-token buffer and must NOT be used as the persistence expectation.
- getUsageStats('all') exercises daily aggregation; '24h' exercises live history. Both assert one request and exact tokens; the pre-request control requires kenari absent and history empty.
- driver.js stores its adapter globally, so vi.resetModules alone does not reset it. closeAdapter is used before initialization and before temporary-directory removal. Full Vitest execution is deferred to the homelab; workstation verification is static only.

## Todo 8 — no-key subset: pricing + passthrough tests, baseline, changelog (2026-09-09)

- Created `tests/unit/kenari-usage.test.js` — NO-KEY subset only. Top-of-file comment notes quota/getKenariUsage/usage-dispatch tests are deferred to when Todo 5/6 unblock. Four pricing tests (seeded override exact values, MODEL_PRICING fallback via gpt-4o-mini, null for synthetic model, gh regression guard) + two passthrough tests.
- Passthrough mechanism (REAL, verified in source): `src/shared/constants/models.js` `isValidModel(aliasOrId, modelId)` returns true if `PASSTHROUGH_PROVIDERS.has(aliasOrId)` — a Set built from `AI_PROVIDERS` entries with `passthroughModels: true` (models.js:20-24, 27-33). kenari's registry entry sets `passthroughModels: true` (kenari.js:34), so `isValidModel("kenari", "vendor/new-model")` → true. Contrast test: groq (no passthrough flag, model not in its list) → false. Tested the function directly rather than simulating an HTTP round-trip.
- Baseline entry shape: copied the simple apikey convention from groq/deepseek — `baseUrl` + `validateUrl` + `format` only. Live `PROVIDERS.kenari` (via `node -e "import('./open-sse/providers/index.js')..."`) is exactly `{baseUrl, validateUrl, usage:{url}, format}`; the `usage` block is NOT captured in baseline (groq also has a usage block in its registry but its baseline entry omits it). File is alphabetically ordered; `kenari` inserted between `iflow` and `kilocode`.
- CHANGELOG: added `# v0.5.70 (2026-09-09)` top section with one `## Features` bullet ("**Providers**: add kenari.id as an OpenAI-compatible provider with automatic usage tracking and IDR→USD pricing"), matching the existing `# vX.Y.Z (date)` header style.
- Static verification (Windows, no vitest): `node --check` on the new test file exit 0; `node -e` importing pricing.js confirmed all asserted values (step-3-7-flash {0.24,1.371429,0.048}, glm-5-3-flash, gemini-2-5-flash-lite incl. cache_creation 0.02, gpt-oss-120b, gh gpt-5.3-codex regression, gpt-4o-mini fallback, null synthetic); baseline JSON still parses. Note: `src/shared/constants/models.js` cannot be imported via plain `node -e` (needs vitest's `open-sse`/`@/` alias resolution) — the isValidModel assertions run under vitest on homelab only.

## Oracle F2 fix � disable premature usage flags (2026-09-09)

- Removed the entire eatures: { usage: true, usageApikey: true } block from open-sse/providers/registry/kenari.js (not emptied to {} � omitted entirely, matching openrouter.js/mistral.js which have no features key). Reason: the quota/balance adapter backing those flags (plan Todo 5/6) is not implemented, so the dashboard's "check quota" UI for kenari connections would resolve to the generic "Usage API not implemented for kenari" fallback. Removing the flags takes kenari out of USAGE_SUPPORTED_PROVIDERS/USAGE_APIKEY_PROVIDERS (derived via REGISTRY.filter(r => r.features?.usage) / .features?.usageApikey in src/shared/constants/providers.js:159-165); no other UI/routing is affected. Automatic request-usage tracking pipeline (kenari-tracking.test.js) is unaffected � it runs regardless of these flags.
- Added one-line comment above passthroughModels: ` // Quota/balance panel deferred until a non-shared kn- key is available (plan Todo 5/6). ` � reference to plan .omo/plans/track-kenari-usage.md Todo 5/6.
- Kenari registry still keeps 	ransport.usage.url + its shared-key 403 comment; that's fine (matches groq's usage block and only feeds a future adapter, not the dashboard eligibility flags).
- Added the missing 3rd-tier (PATTERN_PRICING) test to kenari-usage.test.js: getPricingForModel("kenari", "gemini-9-flash") ? {input:0.3, output:2.5, cached:0.03, reasoning:3.75, cache_creation:0.3} (the gemini-*-flash pattern at pricing.js:314; NOT in MODEL_PRICING, NOT in PROVIDER_PRICING.kenari � verified via node -e). Also narrowed the misleading comment on the gpt-4o-mini test to describe only the canonical (2nd-tier) fallback it tests.
- Verification (Windows, static only): node --check on the test file exit 0; node -e import of pricing.js confirms gemini-9-flash resolves via pattern tier; node -e import of registry/kenari.js (and providers/index.js projection) confirms eatures key is gone.

## Oracle F1 fix — close 2 test-coverage gaps (2026-09-09)

- Gap A (stats-route coverage): added to tests/unit/kenari-tracking.test.js a direct call of the real GET handler from src/app/api/usage/stats/route.js. Mocked `next/server` NextResponse.json to a plain `{ body, status }` object (precedent: tests/unit/api/proxy-pool-fitness-routes.test.js), imported `{ GET: getUsageStatsRoute }` in beforeAll, then after the existing `for (const period of ["all","24h"])` loop called `getUsageStatsRoute(new Request("http://router.test/api/usage/stats?period=all"))` and asserted `status === 200` and `body.byProvider.kenari` matches `{requests:1, promptTokens:123, completionTokens:45}`. Runs in the same it() so the usageHistory row already exists. Existing direct-DB assertions untouched.
- Gap B (upstream-model-string coverage): added to tests/unit/kenari-usage.test.js's "kenari passthrough routing" describe a new it() importing parseModel (open-sse/services/model.js) and getModelUpstreamId (open-sse/config/providerModels.js). VERIFIED via node -e (not assumed): `parseModel("kenari/vendor/new-model")` → `{"provider":"kenari","model":"vendor/new-model","isAlias":false,"providerAlias":"kenari"}`; `getModelUpstreamId("kenari","vendor/new-model")` → `"vendor/new-model"` unchanged (findModel finds no registry entry among the 4 seeded kenari models → fallback `return baseId + suffix` with empty suffix). Also confirmed `getModelUpstreamId("kenari","step-3-7-flash")` → `"step-3-7-flash"` (seeded id round-trips too).
- Both files pass `node --check` (exit 0). No product code touched; no vitest run (Windows). Files left unstaged for the orchestrator.

## Todo 5/6 — real Kenari quota fixtures and adapter (2026-09-09)

- Real non-shared-key quota response is a two-window Rupiah schema, not the stale plan's flat balance: `plan.name="Kreator"`; `plan.windows.month` and `.week` each supply `used_rp`, `remaining_rp`, and `resets_at`. The captured totals are month `54096 + 545904 = 600000` and week `54096 + 95904 = 150000`.
- The deliberate invalid token returned HTTP `401` with the plain-text body `invalid key`. The adapter therefore classifies every 401/ordinary 403 as the sanitized authentication message; its shared-key specialization only triggers on 403 JSON/string content containing `shared_key_not_allowed`.
- No existing groq/deepseek adapter has a timeout. Kenari uses a local `AbortController` with a 10,000 ms deadline, passes `signal` through `proxyAwareFetch`, and clears the timer in `finally`. All network, timeout, malformed JSON, non-JSON success, and absent/malformed windows return `{ plan: "kenari", message: "Balance unavailable" }` without propagating upstream text.
- `ProviderLimits` already renders multiple normalized quota entries and computes remaining percentage from `used`/`total`; no dashboard renderer edit was needed. Kenari maps valid windows to `Month (IDR)` and `Week (IDR)` without `unlimited` so each actual amount remains visible.
