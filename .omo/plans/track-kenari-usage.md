# track-kenari-usage - Work Plan

## TL;DR (For humans)

**What you'll get:** kenari.id registered as a first-class OpenAI-compatible provider in this 9router instance. Once you add your `kn-` API key in the dashboard and route a request as `kenari/<model>`, every request's token usage is recorded and shows up automatically in the existing `/dashboard/usage` view (per-provider stats, history, live stream). On top of that: a **live balance panel** for kenari (reads your saldo via `GET /v1/account/quota`) and an **estimated Rupiah→USD cost** column, computed at a documented snapshot exchange rate (not a continuously accurate live cost).

**Why this approach:** 9router's usage recording is already provider-agnostic — it needs zero new code to *track* a registered provider. So the whole job is (1) one registry file, (2) a hand-edit to the registry index, (3) a per-provider quota adapter + dispatch wiring for the balance panel (this is NOT automatic — the dashboard maps providers to quota handlers explicitly), and (4) pricing rows scoped to kenari only. No new executor, no routing-engine change — the DefaultExecutor + OpenAI translator handle kenari as-is.

**What it will NOT do:** No new custom executor. No live/auto pricing-sync service (a single documented IDR→USD constant, not a currency system). No change to any other provider's pricing or behavior. No global `MODEL_PRICING`/`PATTERN_PRICING` edits. No change to shared cost arithmetic in `pricing.js` (a kenari zero cache-rate is an escalation, not a silent fix). No touching `open-sse/executors/*`. No build or test on Windows (homelab only). No registry-tooling refactor. Scope is exactly kenari; nothing is reduced from your request and nothing unrelated is added.

**Effort:** 8 implementation todos + 4 final-verification tasks. Small-to-medium; most files are additive. Roughly two parts: a **no-key part** (registry, routing, tracking, public pricing — fully doable now) and a **key-dependent part** (live balance panel + live end-to-end QA — blocked until you supply a non-shared `kn-` key).

**Risk:** Low-medium. Main risk is the **unverified `/v1/account/quota` response schema** (no kn- key at plan time) — Todo 5 fetches the real shape first, then implements the transform against it; that todo and the live QA (F3) are explicitly BLOCKED without a key and must not be faked. Second risk: the shared-key `403 shared_key_not_allowed` edge — handled with a graceful, non-throwing, message-only state.

**Decisions already made:** Provider id `kenari`, category `apikey`, `passthroughModels: true` (all kenari models routable), `features: { usage: true, usageApikey: true }`, pricing under `PROVIDER_PRICING["kenari"]` with one documented dated `KENARI_IDR_PER_USD` constant. Balance rendered via the existing generic quota table as a single `Balance (IDR)` quota entry (NOT using the `unlimited` flag); zero/unavailable balance renders a message-only state, not `0 / ∞`.

## Scope

**In scope (files to create/edit):**
- `open-sse/providers/registry/kenari.js` (new registry entry).
- `open-sse/providers/registry/index.js` (hand-add import + array entry — see Approved exceptions).
- `open-sse/services/usage/kenari.js` (new per-provider quota/balance adapter).
- `open-sse/services/usage.js` (register kenari in the dispatch map).
- `open-sse/providers/pricing.js` (add `PROVIDER_PRICING["kenari"]` block + dated `KENARI_IDR_PER_USD` constant ONLY).
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js` — ONLY if Todo 5 proves the generic normalizer cannot render the balance; see Todo 5 decision gate (see Approved exceptions).
- `tests/unit/kenari-usage.test.js` (new; mirrors `tests/unit/groq-usage.test.js`).
- `tests/unit/kenari-tracking.test.js` (new; mocked-upstream tracking test, Todo 3).
- `tests/unit/usage-dispatch.test.js` (add kenari to the manually-maintained supported list — ONLY if Todo 6 completes).
- `tests/__baseline__/providers-baseline.json` (narrow kenari-only addition after review, Todo 8; the file `verify-providers.mjs:9` reads).
- `tests/fixtures/kenari/` (masked response fixtures).
- `CHANGELOG.md`.

**Approved exceptions (Nulla-approved for this plan):**
- `registry/index.js` is labelled auto-generated but has no working generator (`migrate-registry.mjs` is stale). Hand-editing it is the sanctioned path here; do NOT run or "fix" the migration tooling.
- `ProviderLimits/utils.js` may be edited ONLY under Todo 5's decision gate (balance cannot render via the generic path). If the generic path works, this file is NOT touched.

**Out of scope / Must-NOT-Have:**
- Any file under `open-sse/executors/*`.
- Any edit to global `MODEL_PRICING`, `PATTERN_PRICING`, any other provider's `PROVIDER_PRICING`, or the shared cost arithmetic in `pricing.js` (lines ~430-445).
- Any custom executor, protobuf/binary handling, or translator change.
- Any live currency-conversion service, scheduled pricing sync, or generalized multi-currency system.
- Running `scripts/migrate-registry.mjs` or refactoring registry tooling.
- Regenerating all baseline snapshots blindly, or adding kenari test files to `known-fails.txt` to hide failures.
- Any build/test/vitest/baseline run on this Windows workstation.
- Adding kenari as a runtime "custom endpoint node" via `/api/provider-nodes` (we want a built-in registry provider).
- Guessing the `/v1/account/quota` schema, or claiming the balance panel / live QA is done without a real key.

## Verification strategy

- **TDD mix:** the quota adapter and pricing conversion are pure/mockable → tests-first. Registry entry + index wiring → tests-after (dispatch test + baseline).
- **All verification runs on the homelab** (`nullaserver`), never Windows. Authoritative procedure: `docs/ops/NINEROUTER_HOMELAB_BUILD_TEST.md`. The `tests/` directory is an independent ESM package: Vitest runs from `/app/tests` inside the Docker test container using `unit/...` relative paths (NOT repo-root paths).
- **Baseline:** the runbook generates a full-suite JSON report, then `node tests/__baseline__/verify-no-regression.mjs <results.json>` compares it (the script REQUIRES the results path argument — omitting it exits 2 with `Missing results.json path`). Use the runbook's exact results path (e.g. `/results/current.json`). Require `No regression` + exit 0.
- The new kenari provider WILL appear as an intentional diff in `verify-providers.mjs`; review it as expected, do NOT suppress it and do NOT blanket-regenerate.
- **Secret handling:** any real `kn-` key is loaded on the homelab from an env var / untracked file — NEVER pasted into tool-call text, shell history, logs, or evidence files. Fixtures are masked before saving. This applies from the first curl in Todo 5, not just at commit time.
- Agent-executed QA for each todo: happy path + failure path, exact command, evidence under `.qa-results/` (not committed).

## Execution strategy

**No-key part (proceeds now):**
- Wave 0: Todo 4 (capture PUBLIC `/api/public/pricing` + `/v1/models`, no key) — runs FIRST because Todo 1 needs verified seed model ids.
- Wave 1: Todos 1-2-3 (registry entry, index wiring, prove usage auto-tracks via a mocked-upstream integration test).
- Wave 2: Todo 7 pricing (depends on Todo 4).

**Key-dependent part (BLOCKED until Nulla supplies a non-shared `kn-` key):**
- Todo 5 (capture real `/v1/account/quota` schema) → Todo 6 (adapter + dispatch + balance rendering). If no key: mark Todo 5, Todo 6, and F3 `BLOCKED`, deliver the no-key part, and do NOT claim the balance panel is done.

**Then:** Todo 8 (tests/baseline/docs, over whichever todos completed) → Final verification wave (F1-F4). F3 (live QA), the kenari dispatch-list assertion, and the balance-panel portions of F1/F2/F4 are BLOCKED without a key.

Dependency matrix: 4←(none) ; 1←4 ; 2←1 ; 3←2 ; 5←(key) ; 6←5 ; 7←4 ; 8←(completed subset of 1-7; its dispatch-list edit is conditional on 6) ; F1-F4←8. Partial delivery is valid: when 5-6 are BLOCKED, Todo 8 skips the dispatch-list edit and the kenari `usage-dispatch` assertion, and F2's adapter-specific checks are marked N/A-blocked.

## Todos

- [x] 1. `open-sse/providers/registry/kenari.js`: create the registry entry (blocked by 4)
  - **References:** template `open-sse/providers/REGISTRY_TEMPLATE.js`; field contract `open-sse/providers/schema.js:5-29` (docs/defaults, not an executable validator); analog `open-sse/providers/registry/groq.js` (apikey + transport.usage.url + features.usage/usageApikey), `deepseek.js` (models + features); executor URL/auth build `open-sse/executors/default.js:129-146`. kenari facts: base `https://kenari.id/v1`, chat `POST /v1/chat/completions`, models `GET /v1/models` (public), quota `GET /v1/account/quota`, Bearer `kn-`.
  - **Do:** export default object: `id: "kenari"`, `category: "apikey"`, `passthroughModels: true`, `display: { name: "kenari", website: "https://kenari.id", notice: { apiKeyUrl: "https://kenari.id/login" } }`, `transport: { baseUrl: "https://kenari.id/v1/chat/completions", validateUrl: "https://kenari.id/v1/models", usage: { url: "https://kenari.id/v1/account/quota" } }`, `features: { usage: true, usageApikey: true }`, and a seed `models: [...]` of 2-4 model ids **taken from Todo 4's `tests/fixtures/kenari/models.json`**. `passthroughModels` routes the rest.
  - **Acceptance:** on homelab, `node -e "import('./open-sse/providers/registry/kenari.js').then(m=>console.log(m.default.id, m.default.category, m.default.passthroughModels))"` from repo root prints `kenari apikey true`; each seed model id also appears in `tests/fixtures/kenari/models.json`.
  - **QA happy:** import succeeds; required keys present (id/category/transport.baseUrl/features). Evidence: `.qa-results/01-registry-import.txt`.
  - **QA failure (executable):** write a throwaway `scripts/tmp-kenari-url-check.mjs` that imports `getExecutor` from `open-sse/executors/index.js` AFTER Todo 2 registers kenari, calls `getExecutor("kenari").buildUrl(...)` with a minimal credentials object, and asserts the resolved URL equals `https://kenari.id/v1/chat/completions`; then flip the registry `baseUrl` to a wrong value and assert the URL changes; revert and delete the throwaway. (This QA runs after Todo 2.) Evidence: `.qa-results/01-url-assert.txt`.
  - **Commit:** `feat(providers): add kenari.id registry entry`

- [x] 2. `open-sse/providers/registry/index.js`: hand-register kenari (blocked by 1)
  - **References:** `open-sse/providers/registry/index.js` (hand-maintained; existing `pN` import + array pattern); Approved exceptions above.
  - **Do:** add `import pN from "./kenari.js";` with the next free `pN`, append `pN` to the exported array, matching existing ordering/format. Touch no unrelated lines.
  - **Acceptance:** on homelab, `node -e "import('./open-sse/providers/index.js').then(m=>console.log(!!m.PROVIDERS.kenari, m.PROVIDER_MODELS.kenari?.length>=0))"` → `true true`.
  - **QA happy:** kenari present in `APIKEY_PROVIDERS` (check via `src/shared/constants/providers.js`). Evidence: `.qa-results/02-registry-index.txt`.
  - **QA failure (executable):** remove the array entry (keep the import), re-run the acceptance node cmd → `false`; restore. Evidence: `.qa-results/02-negative.txt`.
  - **Commit:** `feat(providers): register kenari in registry index`

- [x] 3. Prove usage auto-tracking via a mocked-upstream integration test (blocked by 2)
  - **References:** `usageRepo.js:281` saveRequestUsage; `src/app/api/usage/stats/route.js`; `src/sse/handlers/chat.js:363-371` (connectionId/apiKey passthrough); existing streaming/non-streaming test harness patterns under `tests/` (mock `proxyAwareFetch`/upstream fetch). This todo's product-code output is ZERO — it is a NEW test file `tests/unit/kenari-tracking.test.js` proving the registry entry suffices for tracking.
  - **Do:** write `tests/unit/kenari-tracking.test.js` that mocks a kenari chat completion (known token counts) through the routing path with a mocked upstream, and asserts a `usageHistory` row with `provider="kenari"`, the expected `connectionId`, exact token totals, and NO duplicate row; plus `/api/usage/stats` `byProvider.kenari` present. Use the same mock harness as existing usage tests (identify the exact helper in an existing `tests/unit/*` file and reuse it).
  - **Acceptance:** on homelab, from `/app/tests`: `npx vitest run unit/kenari-tracking.test.js` exits 0.
  - **QA happy:** test asserts exact token totals + kenari attribution. Evidence: `.qa-results/03-tracking.txt`.
  - **QA failure (executable):** temporarily change asserted provider to a fake id → test fails; revert. Evidence: `.qa-results/03-bites.txt`.
  - **Commit:** `test(usage): kenari usage-tracking integration test`

- [x] 4. Capture PUBLIC `/api/public/pricing` + `/v1/models` (no key; no dependencies; runs first)
  - **References:** kenari docs `/docs/models` (`/api/public/pricing` micro-IDR/1M; `/v1/models` public). pricing precedence + unit `open-sse/providers/pricing.js:1,375-391,430-445`.
  - **Do:** `curl https://kenari.id/v1/models` and `curl https://kenari.id/api/public/pricing` (no auth); save `tests/fixtures/kenari/models.json` and `tests/fixtures/kenari/pricing.json`. Document, in a comment block, the exact per-model input/output/cache-read/cache-write fields and their unit; confirm the 2-4 seed model ids used in Todo 1.
  - **Acceptance:** both fixtures parse as JSON; pricing fixture has numeric per-token rates with a documented unit; `models.json` contains the 2-4 ids Todo 1 will seed.
  - **QA happy (executable):** `curl -o /dev/null -w '%{http_code}' https://kenari.id/api/public/pricing` → `200`; `node -e "JSON.parse(require('fs').readFileSync('tests/fixtures/kenari/pricing.json'))"` exits 0. Evidence: `.qa-results/04-public.md`.
  - **QA failure (executable):** point the fetch at a bogus path `https://kenari.id/api/public/does-not-exist` → assert non-200 status captured; and feed a truncated/malformed JSON string to the parse step → assert it throws (proves the capture step would reject a bad payload rather than silently seeding garbage). Evidence: `.qa-results/04-malformed.txt`.
  - **Commit:** `test(providers): add kenari public models + pricing fixtures`

- [x] 5. Capture REAL `/v1/account/quota` schema — KEY-DEPENDENT (blocked by: non-shared `kn-` key)
  - **UNBLOCKED (2026-09-09):** Nulla supplied a non-shared `kn-` key via `KENARI_KEY` env var on homelab. Real schema captured: `{coupon, plan:{name, windows:{month:{used_rp,remaining_rp,resets_at}, week:{...}}}}` — a 2-window rolling structure, DIFFERENT from the plan's original flat single-balance assumption. Saved masked (secret-free) `tests/fixtures/kenari/quota-success.json` and `quota-invalid.json` (real 401 "invalid key" response). Grep-verified no `kn-` string present.
  - **References:** kenari docs `/docs/authentication` (quota needs non-shared key; `403 shared_key_not_allowed`); adapter output contracts `open-sse/services/usage/groq.js:98-129`, `deepseek.js:90-108`; dashboard normalizer `ProviderLimits/utils.js:666-675,289-294`; `QuotaTable.js:189-204`.
  - **Do:** on homelab, load a Nulla-supplied non-shared `kn-` key from an env var (NEVER in tool text/history/logs); `curl -H "Authorization: Bearer $KENARI_KEY" https://kenari.id/v1/account/quota`; save a MASKED `tests/fixtures/kenari/quota-success.json` (balance field + unit documented). If a shared key is available, also capture `tests/fixtures/kenari/quota-403.json`. If NO key is available: set this todo, Todo 6, and F3 to `BLOCKED`, record it in the draft, and stop the key-dependent branch — do NOT guess the schema.
  - **Acceptance:** `quota-success.json` exists, parses, contains a numeric balance field with documented unit; key is masked (grep the fixture for `kn-` → no match).
  - **QA happy:** balance field identified + unit documented. Evidence: `.qa-results/05-schema.md`.
  - **QA failure (executable):** `curl` with an invalid key → capture status + body shape into `quota-invalid.json` for adapter error handling. Evidence: `.qa-results/05-invalid.txt`.
  - **Commit:** `test(usage): add masked kenari quota fixtures`

- [x] 6. `open-sse/services/usage/kenari.js` + register in `usage.js` — KEY-DEPENDENT (blocked by 5)
  - **UNBLOCKED (2026-09-09):** Implemented `getKenariUsage(apiKey, proxyOptions)` adapted to the real 2-window schema (`Month (IDR)`/`Week (IDR)` quotas, `total = used_rp + remaining_rp`), AbortController 10s timeout, sanitized message-only degradation for missing key / 403 shared-key / 401 auth-failed / malformed / network-error. Registered in `USAGE_HANDLERS` dispatch map. Re-enabled `features: {usage:true, usageApikey:true}` on the registry entry (correct reversal of the earlier no-key-phase removal, since the adapter now exists). Extended `tests/unit/kenari-usage.test.js` with 5 adapter tests (success/shared-key/invalid-key/malformed/no-key) and added `kenari` to `tests/unit/usage-dispatch.test.js`'s SUPPORTED list. Independently re-verified by orchestrator: `node --check` all files exit 0, no `kn-`/`KENARI_KEY` string in any file, fixture math cross-checked (month total 600000, week total 150000).
  - **References:** dispatch map `open-sse/services/usage.js:36-65` (add `kenari: (c) => getKenariUsage(c.apiKey, c.proxyOptions)`), fallback `:74-75`; signature match `groq.js:68` / `deepseek.js:43`; `proxyAwareFetch` third-arg proxy options; refresh-skip for apikey `src/app/api/usage/[connectionId]/route.js:139-145,158-176`; renderer `ProviderLimits/utils.js:289-294`, `QuotaTable.js:189-204`.
  - **Do:** implement `getKenariUsage(apiKey, proxyOptions = null)` calling `GET /v1/account/quota` with Bearer auth and a **bounded abort deadline** (add an AbortController/timeout — the groq/deepseek helpers do not supply one). Transform the Todo-5 fixture into the definite normalized shape `{ plan: "kenari", quotas: { "Balance (IDR)": { used: 0, total: <balanceIdr>, resetAt: null } } }` (do NOT set `unlimited` — it would hide the amount).
    - **Decision gate (balance rendering):** the generic normalizer renders a positive balance as `100%` and `0 / <balance>` (verified `utils.js:289-294`, `QuotaTable.js:189-204`) — acceptable. For zero/missing/null/blank/non-finite/negative balance, return a **message-only** state (`{ plan: "kenari", message: "..." }`) NOT a `0 / ∞` quota. ONLY if the generic path cannot render the intended positive-balance display do you edit `ProviderLimits/utils.js` (Approved exception) with a minimal kenari branch; otherwise leave that file untouched and document the decision in the commit body.
    - **Error handling (sanitized, non-throwing, no raw upstream bodies/exception text):** `403 shared_key_not_allowed` → message-only "balance view needs a non-shared key", NO fabricated balance, NO connection mutation; ordinary 401/403 → auth-failed message; malformed/missing balance/timeout/network → "unavailable" message-only object. Register kenari in the dispatch map.
  - **Acceptance:** `tests/unit/kenari-usage.test.js` (Todo 8 finalizes) passes on homelab: asserts exact quota URL called once, Bearer key + proxyOptions forwarded, an abort/timeout is set, fixture → exact normalized `Balance (IDR)` values, and the 403-shared-key + malformed + timeout branches return message-only objects without throwing.
  - **QA happy:** with success fixture mocked, adapter returns the balance shape; ProviderLimits renders it (homelab agent-browser check with the concrete assertion "kenari card shows Balance (IDR) 0 / <balance>"). Evidence: `.qa-results/06-quota-ok.txt` + UI note.
  - **QA failure (executable):** mock `403 shared_key_not_allowed` → assert message-only object, no throw, no fabricated balance; assert route does not refresh credentials (apikey path `route.js:158-176`). Evidence: `.qa-results/06-shared-key.txt`.
  - **Commit:** `feat(usage): add kenari balance adapter + dispatch`

- [x] 7. `open-sse/providers/pricing.js`: add kenari pricing (blocked by 4)
  - **References:** precedence override→canonical(incl. last slash segment)→pattern→null `open-sse/providers/pricing.js:375-391`; USD/1M unit `pricing.js:1`; cost calc `usageRepo.js:138-145`; cache arithmetic `pricing.js:433,445` (`cached||input`, `cache_creation||input`); Todo-4 `pricing.json` fixture.
  - **Do:** add a `PROVIDER_PRICING["kenari"]` block with per-model input/output (+ cache-read/cache-write where the feed provides them), converted with the explicit formula `usdPerMillion = microIdrPerMillion / 1_000_000 / KENARI_IDR_PER_USD` via a single module constant `KENARI_IDR_PER_USD` (comment: source + capture date + manual-refresh note). Map feed cache fields EXPLICITLY to `cached` / `cache_creation`. **If the feed has a legitimate zero cache rate:** do NOT encode it (the shared `cached||input` arithmetic would charge input rate, and fixing that is out of scope) — instead ESCALATE to Nulla. Do NOT edit global `MODEL_PRICING`/`PATTERN_PRICING`.
  - **Acceptance:** on homelab, `getPricingForModel("kenari","<seed-model>")` returns USD rates matching the formula (assert the exact number from a fixture value); the SAME model id under another provider is unchanged.
  - **QA happy (three cases):** (a) a kenari model in the override → converted rate; (b) a kenari model absent from the override but present in canonical/pattern → gets the documented fallback estimate (non-zero) — documented as a reference estimate, not kenari's real price; (c) a synthetic model matching NEITHER canonical nor pattern → `null`/cost 0. Evidence: `.qa-results/07-pricing.txt`.
  - **QA failure (executable):** assert an unrelated provider's `getPricingForModel` output is byte-identical to pre-change (regression guard). Evidence: `.qa-results/07-regression.txt`.
  - **Commit:** `feat(pricing): add kenari IDR->USD pricing (snapshot rate)`

- [x] 8. Tests + dispatch list + baseline + docs (blocked by the completed subset of 1-7)
  - **References:** `tests/unit/groq-usage.test.js` (mock `proxyAwareFetch`, exact URL/auth, quota parse, imports dashboard normalizer); `tests/unit/usage-dispatch.test.js:15-20,31-37` (manual supported-provider list; unsupported-provider message rejected — so only add kenari here if Todo 6 registered the handler); dispatch fallback `open-sse/services/usage.js:74-75`; `tests/__baseline__/verify-providers.mjs:9,23-44` (reads `providers-baseline.json`; new provider = intentional diff); runbook `docs/ops/NINEROUTER_HOMELAB_BUILD_TEST.md`; CHANGELOG.md; `open-sse/AGENTS.md`.
  - **Do:** finalize `tests/unit/kenari-usage.test.js` — **only if Todo 6 ran:** happy quota, 403 shared-key, malformed, timeout, balance normalization, AND add kenari to `usage-dispatch.test.js`; **always:** pricing conversion three-case + passthrough routing of a nested unseeded model id `kenari/vendor/new-model` → upstream `vendor/new-model`. If Todo 6 is BLOCKED, do NOT add kenari to `usage-dispatch.test.js` (it would hit the unsupported-provider message at `usage.js:74-75` and fail `usage-dispatch.test.js:31-37`). Update CHANGELOG.md. Add ONLY the intentional kenari entry to `tests/__baseline__/providers-baseline.json` after review.
  - **Acceptance:** on homelab from `/app/tests`: `npx vitest run unit/kenari-usage.test.js unit/kenari-tracking.test.js` (add `unit/usage-dispatch.test.js` to the list only if Todo 6 ran) exits 0. Then per runbook generate the full-suite JSON report and run `node tests/__baseline__/verify-no-regression.mjs <runbook-results-path>` (e.g. `/results/current.json`) → prints `No regression`, exit 0.
  - **QA happy:** targeted suite green; baseline clean with only the kenari provider diff acknowledged. Evidence: `.qa-results/08-vitest.txt`, `.qa-results/08-baseline.txt`.
  - **QA failure (executable):** break the quota URL in the adapter (if Todo 6 ran) or the pricing formula → the kenari test fails on that assertion; revert. Evidence: `.qa-results/08-bites.txt`.
  - **Commit:** `test(usage): kenari unit + dispatch/baseline + docs`

## Final verification wave

- [x] F1. Plan compliance audit: every non-blocked todo done, every file that was ACTUALLY touched is within the in-scope whitelist (not "every whitelisted file must be touched" — `utils.js` and the key-dependent files may legitimately be untouched), and nothing out-of-scope modified (no `open-sse/executors/*`, no global `MODEL_PRICING`/`PATTERN_PRICING`, no shared cost arithmetic, no other provider pricing). Confirm the two Approved exceptions (`registry/index.js`, and `utils.js` only if the Todo 6 gate required it) are the only "exception" edits. If the key-dependent branch is BLOCKED, F1 audits only the no-key deliverables and records the block. Evidence: `git diff --stat` vs Scope. APPROVE/REJECT.
  - **VERDICT: APPROVE** (2026-09-09, after two fix rounds). Round 1: `.qa-results/04-public.md`/`04-malformed.txt` were accidentally committed (violates "evidence not committed" rule) — fixed in `f4da8df2` (untracked + `.gitignore` entry). Round 2: Todo 3's tracking test only asserted the DB-layer `getUsageStats()`, not the actual `/api/usage/stats` HTTP route; Todo 8's passthrough test only covered `isValidModel` (validation layer), not `getModelUpstreamId`/`parseModel` (the actual routing-layer functions deciding the upstream model string for `kenari/vendor/new-model`) — both gaps closed with additive test assertions, independently re-verified via `node -e` to match exactly. Also noted: a pre-existing `clientSecret` value in `tests/__baseline__/providers-baseline.json` predates this branch (confirmed via `git show master:...` + `git log -p`) — flagged to Nulla separately, out of scope for this PR, not gating.
- [x] F2. Code quality + independent diff review (Oracle): trace kenari adapter vs groq/deepseek precedent line-by-line; confirm the balance normalization is definite (no `unlimited`, correct zero/negative/missing handling), abort/timeout present, 403/malformed paths graceful and non-mutating; confirm pricing conversion math, provider-scoping, and the three fallback cases; confirm registry entry matches schema. Read the actual diff, do not just re-run tests. APPROVE/REJECT.
  - **VERDICT: APPROVE** (2026-09-09, after one fix round). Initial review found `features: {usage:true, usageApikey:true}` on kenari's registry entry prematurely advertised quota-eligibility for an adapter that doesn't exist (Todo 5/6 blocked). Fixed: flags removed (commit `74809423`), matching openrouter.js/mistral.js's no-`features`-key convention; automatic request-tracking (kenari-tracking.test.js) confirmed unaffected. Re-review APPROVED: pricing math, provider-scoping, 3-tier fallback (incl. added pattern-only test case), registry schema, tracking test, and baseline entry all independently verified correct. Non-blocking wording nit noted (transport.usage comment says "usage tracking" where "quota retrieval" is more precise) — not gating.
- [x] F3. Real manual QA on homelab dev container — KEY-DEPENDENT: add kenari key, route a real request, open `/dashboard/usage` → confirm kenari in `byProvider` stats, `Balance (IDR)` panel shows real saldo (agent-browser assertion on the rendered value), cost column non-zero for a priced model; confirm shared-key message-only state if a shared key is available. If no key: F3 is BLOCKED — record it; the no-key mocked equivalent (Todo 3) stands as the tracking proof. Evidence: `.qa-results/F3/`. APPROVE/REJECT/BLOCKED.
  - **VERDICT: APPROVE (2026-09-09).** Deployed `feature/kenari-usage` (SHA `a72878cf`) to `ninerouter-dev` on homelab (Docker build --no-cache, safe recreate, `9router-dev-data` volume preserved, health 200, public URL 307→/dashboard). Nulla connected a real kenari API key ("Kenari test" connection) directly via the dashboard UI. Screenshot confirms the live `getKenariUsage` adapter renders exactly as designed: **Month (IDR) 54,096/600,000 (91%, green)** and **Week (IDR) 54,096/150,000 (64%, amber)**, both with correct reset countdowns ("in 3m", "in 5h 15m") — matching the real 2-window schema captured in Todo 5 and the normalization logic implemented in Todo 6. Refresh-quota control present and functional. This is genuine live production-endpoint verification, not a mock.
- [x] F4. Scope fidelity: confirm the delivered result tracks kenari usage in the existing dashboard as requested, pricing included, nothing reduced and nothing unrequested added. Explicitly state which parts (balance panel, live QA) are delivered vs BLOCKED-on-key so nothing is over-claimed. APPROVE/REJECT.
  - **VERDICT: APPROVE** (2026-09-09, updated after Todo 5/6 unblocked in `cd1a553d`). DELIVERED: first-class kenari apikey provider (4 seeded models + passthrough), automatic request-usage tracking (proven no-key via mocked-upstream test), snapshot IDR→USD pricing for all 4 seeded models with correct fallback chain, real quota schema capture + `getKenariUsage` balance adapter (Month/Week IDR windows, sanitized error handling) + dispatch registration + re-enabled feature flags. REMAINING BLOCKED-ON-ACTIVE-KEY (not delivered, by design): F3 live homelab QA / rendered balance-panel verification — the temp key used for schema capture was deactivated by Nulla; Nulla will connect kenari via the dashboard UI directly post-deploy instead. No scope creep, no unrequested changes.

## Commit strategy

One commit per todo (messages above), Conventional Commits. Root package versioned independently — log kenari addition in `CHANGELOG.md` (Todo 8). NEVER commit `.env`, the real `kn-` key, or unmasked fixtures; fixtures under `tests/fixtures/kenari/` must be masked (verified by grep for `kn-`). `.qa-results/` is NOT committed (it is evidence only) — Todo 3's "test" commit commits the test FILE, not evidence. If the key-dependent branch is BLOCKED, commit only the no-key todos.

## Success criteria

- kenari is a routable `apikey` provider (`kenari/<model>`) via DefaultExecutor with no executor changes.
- A kenari request records a `usageHistory` row and appears in `/api/usage/stats` `byProvider` and `/dashboard/usage` — proven by Todo 3's mocked-upstream test (no key) and, when a key exists, F3 live.
- With a non-shared key: the `/dashboard/usage` panel shows kenari's real `Balance (IDR)`; shared-key/zero/error cases degrade to a message-only state (never `0 / ∞`, never a fabricated balance).
- Cost column shows estimated USD (converted from micro-IDR at the documented snapshot rate) for priced models; unlisted models follow the existing documented fallback chain; no other provider's pricing or the shared arithmetic changes.
- Targeted vitest green + full-suite baseline `No regression` (exit 0), both on homelab, with the only baseline diff being the intentional kenari provider addition.
- All four final-verification tasks APPROVE (F3 and balance-panel parts may be BLOCKED-on-key and are explicitly reported as such, not silently passed).
