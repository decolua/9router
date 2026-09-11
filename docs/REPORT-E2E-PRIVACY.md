# Report — Privacy module E2E (Playwright) + Duplicate-key bug fix

- **Date**: 2026-09-10
- **Environment**: 9router dev (Next 16.3.4, Turbopack) on isolated port `20127`, temporary `DATA_DIR` with a copy of the real DB (`~/.9router/db/data.sqlite`), Playwright + Google Chrome (`channel: "chrome"`), headful.
- **Scope**: every configuration possibility of the "Privacy" module + fixing `Encountered two children with the same key, regex-CC-\d{4}-0`.
- **Result**: bug fixed and proven by E2E; **20/20 scenarios PASS**; no commits made (kept the "do not commit" decision).

---

## 1. Diagnosis — root cause

**Reported error** (console): `Encountered two children with the same key, regex-CC-\d{4}-0` at `PrivacyClient.js:379`.

**Mechanism** — `src/app/(dashboard)/dashboard/privacy/PrivacyClient.js:374`:

```js
const id = cp.id || `${cp.type}-${cp.pattern}-${i}`;   // before the fix
```

The real DB had 3 legacy custom patterns (created before UUID generation existed in `onSaveCustom`):

| # | name | pattern | type | persisted id |
|---|---|---|---|---|
| 1 | codigo CC | `CC-\d{4}` | regex | *(missing)* → fallback `regex-CC-\d{4}-0` (i=0) |
| 2 | chave vault | `vault-*-secret` | wildcard | *(missing)* |
| 3 | codigo CC | `CC-\d{4}` | regex | `regex-CC-\d{4}-0` (derived legacy id) |

→ **#1 and #3 produced the same React key** `regex-CC-\d{4}-0` on the `<div key={id}>`; any re-render (checkbox/toggle click) fired the console error.

> Note: during the session the user changed the real DB (removed "chave vault" and the duplicate pattern; the remaining "codigo CC" got a UUID). The bug was reproduced with the **original snapshot** taken at test start.

## 2. Fixes applied

### A1 — Backend (main fix)
**`src/lib/db/repos/settingsRepo.js`**

- New pure function **`normalizeCustomPatterns(customPatterns)`** (exported): assigns `randomUUID()` (Node `node:crypto`) to every pattern with a missing, empty or **duplicate** id; preserves existing unique ids; idempotent (2nd pass changes nothing).
- Called at the end of **`mergeWithDefaults`**: every settings consumer gets `dlpCustomPatterns` with guaranteed-unique ids — permanently fixes the legacy data without touching the user's file.

### A2 — Frontend (safety net)
**`src/app/(dashboard)/dashboard/privacy/PrivacyClient.js:374`**

```js
const id = cp.id || `legacy-${cp.type}-${i}`;   // after the fix
```

The `legacy-` prefix never collides with legacy `regex-*/wild-*` ids; `testState`/`onRunTest`/Edit/Delete keep using the same stable `id`.

### A3 — Unit tests
**`tests/unit/saml.test.js`** — 5 new cases (4 behaviors + idempotency):
- `mergeWithDefaults` assigns UUIDs to patterns without ids (content preserved)
- `mergeWithDefaults` resolves the real collision (pattern without id + pattern with derived id → 2 distinct ids)
- `normalizeCustomPatterns` preserves valid unique ids; `undefined`/`null`/non-array → `[]`
- idempotency

### A4 — Dynamic-provider icon 404 (residual E2E console error)
**`src/shared/utils/providerIcon.js`** + new **`tests/unit/providerIcon.test.js`**

- Dynamic connections (`openai-compatible-chat-<uuid>`, …) never have a static PNG under `public/providers/` (only `openai.png` exists; the dynamic family has no file) → `getProviderIconSrc` issued a request → 404 on the console on first render; the existing `onError`/`failedIds` only prevented repeats.
- Fix: `resolveProviderIconId` now returns `""` for ids with a **UUID suffix** (`/-[0-9a-f]{8}-…{12}$/i`) → `null` src → `ProviderIcon` renders the letter fallback **with no request at all** (zero 404s).
- Tests: 5 cases (uuid chat → null; any uuid-suffixed id → null; static `anthropic`/`openai` preserved; alias `perplexity-agent` preserved; `failedIds` session cache preserved) — **5/5 PASS**.

**Result: `unit/saml.test.js` 17/17 PASS.**

## 3. E2E evidence

### 3.1 Pre-fix probe (live reproduction)
Run **before** the fixes, with the original DB snapshot: Privacy page loaded with the 3 legacy patterns + click on the "Password" checkbox → console captured **5× the duplicate-key error** (same message the user reported).

### 3.2 Post-fix run — 20/20 PASS

| # | Scenario | Result |
|---|---|---|
| S0 | Login (`/login`, default test-env password) | PASS |
| S1 | Open `/dashboard/privacy` (title "Privacy") | PASS |
| S2 | **No duplicate-key error** when interacting with checkboxes | PASS |
| S3 | Consent accept/revoke (couples `dlpEnabled`) + **consent_log** (delta ≥ 2 on `GET /api/dlp/consent-log`) | PASS |
| S4 | Enable toggle on/off (persistence) | PASS |
| S5 | 14 PII types — each toggled individually (persistence via `GET /api/settings`) | PASS |
| S6 | 7 templates (Minimal, Standard, Financial, Brazilian, USA, EUR, Full) — includes **Standard ⇒ Password checked** (validates the earlier fix) | PASS |
| S7 | Pseudonymization ↔ Anonymization mode (`dlpMode`) | PASS |
| S8 | Mask responses toggle (`dlpMaskResponses`) | PASS |
| 9.1 | Custom patterns normalized (non-empty, unique ids) | PASS |
| 9.2 | Edit existing pattern (rename persisted) | PASS |
| 9.3 | Add custom regex (`SK-[a-z0-9]{20}`) | PASS |
| 9.4 | Add wildcard with flags (`i`) | PASS |
| 9.5 | Test pattern with sample (`CC-1234 …`) → UI shows match | PASS |
| 9.6 | Toggle enable of custom pattern (persistence) | PASS |
| 9.7 | Delete custom pattern | PASS |
| 9.8 | Reload → persistence (names kept) | PASS |
| S10 | `/dashboard/usage` → "Privacy" card present | PASS |
| S11 | Sidebar without "Privacy & DLP" label (only "Privacy") | PASS |

**Post-fix console errors**: 1 in the E2E session — `404 /providers/openai-compatible-chat-<uuid>.png`, **fixed right after (A4)**: dynamic connection ids with a UUID suffix no longer issue icon requests (`null` src → letter fallback; proven by 5/5 unit tests + build ✓ 24.1s). The 404 was not part of the Privacy module; it was a dynamic-provider icon on the Usage page via `providerIcon.js`.

Screenshots of each scenario were stored under `tmp/opencode/privacy-e2e/shots/` — **removed** with the `tmp/` cleanup (evidence preserved in this report).

## 4. Regression

- **Tests affected by the changes** (`unit/saml`, `unit/consentLog`, `unit/dlp`, `unit/db-migration-chain`, `unit/db-driver-chain`): **70/70 PASS**.
- Full suite: 2259 pass / 114 fail / 17 expected-fail / 59 skip. All failures are **pre-existing baseline**:
  - `node:test` files not collected by vitest (`tests/auth/saml.test.js`, `tests/unit/cline-auth.test.js` — run with `node --test`);
  - live/network/cloud (`embeddings.cloud`, `mimo-free.live`, `cursor-models`, `image-fetch-hardening`, …);
  - catalogued in `tests/__baseline__/known-fails.txt` (`oauth-cursor-auto-import`, `translator-request-normalization`, `claude-header-forwarding`, `openai-to-claude`, …);
  - kiro/claude translators (upstream #3776: `claude-kiro-direct` 9, `kiro-terminal-integrity` 2, `openai-to-kiro`, …).
- **Structural proof**: `rg "settingsRepo|mergeWithDefaults"` across tests → **only `unit/saml.test.js`** (green) consumes the changed code; no failing file imports today's changes.

## 5. Notes / artifacts (from today's work)

| Item | What it is | Status |
|---|---|---|
| `tmp/` (~987 MB, untracked) | E2E environment (dev distDir `.next`, aborted build's `.next-build`, test DB, logs, shots). The sandbox mapped `/tmp/opencode` into the repo. | ✅ **removed** (`rm -rf tmp/`) |
| `.vitest/` (652 KB, untracked) | vitest cache | ✅ **removed** |
| Production build | **Verified twice on 2026-09-10**: `✓ Compiled successfully in 33.8s` and **`✓ 24.1s` (with A4)**, exit=0, using a temporary `NEXT_DIST_DIR` (dev `.next` untouched) — the earlier aborted-build gap is closed | ✅ done |
| `tests/translator/__snapshots__/golden-url-header.test.js.snap` (untracked) | Snapshot written by the full suite | ⚠️ review before committing |

## 6. Working tree state (nothing committed)

```
 M CHANGELOG.md                       M open-sse/AGENTS.md
 M src/app/(dashboard)/dashboard/privacy/PrivacyClient.js
 M src/app/(dashboard)/dashboard/privacy/page.js
 M src/app/(dashboard)/dashboard/usage/components/DlpStats.js
 M src/lib/db/repos/dlpStatsRepo.js   M src/lib/db/repos/settingsRepo.js      ← fix A1
 M src/lib/localDb.js                 M src/shared/components/Sidebar.js
 M src/shared/components/UsageStats.js M src/shared/utils/providerIcon.js     ← fix A4
 M tests/unit/dlp-stats.test.js       M tests/unit/saml.test.js               ← fix A3
?? plano-privacy
?? tests/translator/__snapshots__/golden-url-header.test.js.snap
?? tests/unit/providerIcon.test.js                                            ← fix A4
```

Pending commit groups (when authorized):
1. localDb fix (`localDb.js`) + "Privacy" rename (files + sidebar/stats/agents) + Standard template with `password`
2. **Duplicate-key fix** (`settingsRepo.js` + `PrivacyClient.js` + `tests/unit/saml.test.js`)
3. **Icon 404 fix** (`providerIcon.js` + `tests/unit/providerIcon.test.js`)