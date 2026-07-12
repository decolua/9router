# MiniMax-M3 Model Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `MiniMax-M3` as a first-class built-in model to both `minimax` and `minimax-cn` providers in 9router, with correct pricing entries, so that the model is auto-listed in both providers, the test button works, and users no longer need the custom-model workaround.

**Architecture:** Add a new entry to each provider's model array in `open-sse/config/providerModels.js` with `targetFormat: "claude"` so the router formats requests as Anthropic Messages. Add corresponding pricing entries (Standard tier, ≤512k input) in `src/shared/constants/pricing.js`. No backend, UI, or routing code changes — the router picks up the model automatically once it is registered.

**Tech Stack:** JavaScript (ES modules), Next.js 16, Vitest, plain data files (no behavior code to write).

---

## File Structure

This plan modifies two existing data files. No new files are created.

- `open-sse/config/providerModels.js` — registry of models per provider alias (line 339: `minimax` array, line 365: `minimax-cn` array)
- `src/shared/constants/pricing.js` — per-model pricing table for the `MiniMax-*` model family
- `tests/unit/provider-models-minimax-m3.test.js` — NEW unit test verifying M3 is registered for both providers with correct format

## Prerequisites

Before starting:
- Node.js ≥ 18 installed
- Repository at `/Users/hodtien/sourcecodes/github-code/9router`
- Dependencies installed at root (`npm install`)
- Test dependencies available (`/tmp/node_modules/.bin/vitest` per `tests/package.json`)

Verify test runner works:

```bash
cd /Users/hodtien/sourcecodes/github-code/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/provider-validation.test.js --reporter=verbose 2>&1 | head -20
```

Expected: Test suite runs and reports "passed" for the provider validation tests (or fails with import error if env not set up — that's fine for our purposes; we only need vitest to load the file).

---

## Task 1: Write failing test for M3 model registration

**Files:**
- Create: `tests/unit/provider-models-minimax-m3.test.js`

- [ ] **Step 1: Create the failing test file**

Write `tests/unit/provider-models-minimax-m3.test.js`:

```js
/**
 * Unit tests verifying MiniMax-M3 is registered as a first-class
 * built-in model for both the `minimax` (international) and
 * `minimax-cn` (China) providers, with `targetFormat: "claude"`.
 *
 * Run: cd tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/provider-models-minimax-m3.test.js --reporter=verbose
 */

import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS, getModelsByProviderId } from "../../open-sse/config/providerModels.js";

describe("MiniMax-M3 model registration", () => {
  it("includes MiniMax-M3 in PROVIDER_MODELS.minimax", () => {
    const models = PROVIDER_MODELS.minimax || [];
    const m3 = models.find((m) => m.id === "MiniMax-M3");
    expect(m3).toBeDefined();
    expect(m3).toMatchObject({
      id: "MiniMax-M3",
      name: "MiniMax M3",
      targetFormat: "claude",
    });
  });

  it("includes MiniMax-M3 in PROVIDER_MODELS['minimax-cn']", () => {
    const models = PROVIDER_MODELS["minimax-cn"] || [];
    const m3 = models.find((m) => m.id === "MiniMax-M3");
    expect(m3).toBeDefined();
    expect(m3).toMatchObject({
      id: "MiniMax-M3",
      name: "MiniMax M3",
      targetFormat: "claude",
    });
  });

  it("exposes MiniMax-M3 through getModelsByProviderId for both provider IDs", () => {
    const intlModels = getModelsByProviderId("minimax");
    const cnModels = getModelsByProviderId("minimax-cn");

    expect(intlModels.some((m) => m.id === "MiniMax-M3")).toBe(true);
    expect(cnModels.some((m) => m.id === "MiniMax-M3")).toBe(true);
  });

  it("does not regress the existing M2.7 / M2.5 / M2.1 entries", () => {
    const intlIds = (PROVIDER_MODELS.minimax || []).map((m) => m.id);
    const cnIds = (PROVIDER_MODELS["minimax-cn"] || []).map((m) => m.id);

    for (const id of ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"]) {
      expect(intlIds).toContain(id);
      expect(cnIds).toContain(id);
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it FAILS**

Run:
```bash
cd /Users/hodtien/sourcecodes/github-code/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/provider-models-minimax-m3.test.js --reporter=verbose
```

Expected: All 4 tests FAIL with messages like:
- `expected undefined to be defined`
- `expected false to be true`
- `expected [ 'MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M2.1' ] to contain 'MiniMax-M2.1'` (this last one PASSES — we just need the M3 tests to fail)

At minimum the first 3 tests must fail. (Test 4 should still pass because M2.x entries already exist.)

- [ ] **Step 3: Commit the failing test**

```bash
cd /Users/hodtien/sourcecodes/github-code/9router && git add tests/unit/provider-models-minimax-m3.test.js && git commit -m "test: add failing tests for MiniMax-M3 model registration"
```

---

## Task 2: Add MiniMax-M3 to `minimax` provider array

**Files:**
- Modify: `open-sse/config/providerModels.js:339-345`

- [ ] **Step 1: Edit the `minimax` array**

Open `open-sse/config/providerModels.js`. Find the `minimax:` block (around line 339):

```js
  minimax: [
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
    // Image models
    { id: "minimax-image-01", name: "MiniMax Image 01", type: "image", params: ["n", "size", "response_format"] },
  ],
```

Replace it with (M3 added as the first entry):

```js
  minimax: [
    { id: "MiniMax-M3", name: "MiniMax M3", targetFormat: "claude" },
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
    // Image models
    { id: "minimax-image-01", name: "MiniMax Image 01", type: "image", params: ["n", "size", "response_format"] },
  ],
```

- [ ] **Step 2: Run the test and verify the first 2 tests now PASS**

Run:
```bash
cd /Users/hodtien/sourcecodes/github-code/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/provider-models-minimax-m3.test.js --reporter=verbose
```

Expected: Tests 1 (`includes MiniMax-M3 in PROVIDER_MODELS.minimax`) and 3 (`exposes MiniMax-M3 through getModelsByProviderId for both provider IDs`) now PASS. Test 2 still fails because `minimax-cn` is not updated yet.

- [ ] **Step 3: Commit**

```bash
cd /Users/hodtien/sourcecodes/github-code/9router && git add open-sse/config/providerModels.js && git commit -m "feat(minimax): add MiniMax-M3 to international provider models"
```

---

## Task 3: Add MiniMax-M3 to `minimax-cn` provider array

**Files:**
- Modify: `open-sse/config/providerModels.js:366-369`

- [ ] **Step 1: Edit the `minimax-cn` array**

Open `open-sse/config/providerModels.js`. Find the `"minimax-cn":` block (around line 365):

```js
  "minimax-cn": [
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
  ],
```

Replace it with (M3 added as the first entry):

```js
  "minimax-cn": [
    { id: "MiniMax-M3", name: "MiniMax M3", targetFormat: "claude" },
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
  ],
```

- [ ] **Step 2: Run all tests and verify they PASS**

Run:
```bash
cd /Users/hodtien/sourcecodes/github-code/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/provider-models-minimax-m3.test.js --reporter=verbose
```

Expected: All 4 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/hodtien/sourcecodes/github-code/9router && git add open-sse/config/providerModels.js && git commit -m "feat(minimax): add MiniMax-M3 to China provider models"
```

---

## Task 4: Write failing test for M3 pricing

**Files:**
- Create: `tests/unit/minimax-m3-pricing.test.js`

- [ ] **Step 1: Create the failing test file**

Write `tests/unit/minimax-m3-pricing.test.js`:

```js
/**
 * Unit tests verifying MiniMax-M3 pricing entries exist with the
 * Standard-tier values (input $0.30 / output $1.20 / cached $0.06 per M tokens)
 * and that the lowercase variant `minimax-m3` is also present.
 *
 * Run: cd tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/minimax-m3-pricing.test.js --reporter=verbose
 */

import { describe, it, expect } from "vitest";
import pricingModule from "../../src/shared/constants/pricing.js";

const { getPricingForModel, PRICING } = pricingModule;

describe("MiniMax-M3 pricing", () => {
  it("exposes an exact pricing entry for MiniMax-M3", () => {
    const p = getPricingForModel("MiniMax-M3");
    expect(p).toBeDefined();
    expect(p).toMatchObject({
      input: 0.30,
      output: 1.20,
      cached: 0.06,
    });
  });

  it("exposes an exact pricing entry for lowercase minimax-m3", () => {
    const p = getPricingForModel("minimax-m3");
    expect(p).toBeDefined();
    expect(p).toMatchObject({
      input: 0.30,
      output: 1.20,
      cached: 0.06,
    });
  });

  it("includes the explicit PRICING entries for both casings", () => {
    expect(PRICING).toHaveProperty("MiniMax-M3");
    expect(PRICING).toHaveProperty("minimax-m3");
  });
});
```

> **Note:** The two import paths (`getPricingForModel` as a function and `PRICING` as an object) need to match what `src/shared/constants/pricing.js` actually exports. If the file does not export `PRICING`, drop test 3 and keep tests 1 and 2 — see Step 1b below.

- [ ] **Step 1b (if needed): Inspect the actual exports of `pricing.js`**

Run:
```bash
cd /Users/hodtien/sourcecodes/github-code/9router && grep -n "^export" src/shared/constants/pricing.js
```

If you see something like `export const getPricingForModel = ...` and `export const PRICING = ...`, the test as written will work. If `PRICING` is not exported, delete test 3 from the test file (keep only tests 1 and 2). The exact-match fallback still works without `PRICING` being exported.

- [ ] **Step 2: Run the test and verify it FAILS**

Run:
```bash
cd /Users/hodtien/sourcecodes/github-code/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/minimax-m3-pricing.test.js --reporter=verbose
```

Expected: At least tests 1 and 2 FAIL with messages like `expected undefined to be defined` (since no exact entry exists yet, the function likely falls through to the regex pattern with a different pricing or returns undefined).

- [ ] **Step 3: Commit the failing test**

```bash
cd /Users/hodtien/sourcecodes/github-code/9router && git add tests/unit/minimax-m3-pricing.test.js && git commit -m "test: add failing tests for MiniMax-M3 pricing"
```

---

## Task 5: Add MiniMax-M3 pricing entries

**Files:**
- Modify: `src/shared/constants/pricing.js`

- [ ] **Step 1: Inspect the existing `MiniMax` pricing block**

Open `src/shared/constants/pricing.js`. Find the `// === MiniMax ===` section near the top of the pricing table.

The block currently looks like (lines ~60-70):

```js
  // === MiniMax ===
  "MiniMax-M2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.5":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.7":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.5":                 { input: 0.60,  output: 2.40,  cached: 0.30,  reasoning: 3.60,   cache_creation: 0.60  },
```

- [ ] **Step 2: Add M3 entries**

Insert the two new entries — one for the canonical `MiniMax-M3` and one for the lowercase `minimax-m3` variant. The order should match the existing pattern (latest model first):

```js
  // === MiniMax ===
  "MiniMax-M3":                   { input: 0.30,  output: 1.20,  cached: 0.06 },
  "MiniMax-M2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.5":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.7":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m3":                   { input: 0.30,  output: 1.20,  cached: 0.06 },
  "minimax-m2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.5":                 { input: 0.60,  output: 2.40,  cached: 0.30,  reasoning: 3.60,   cache_creation: 0.60  },
```

The regex pattern fallback (`{ pattern: "MiniMax-*", ... }` and `{ pattern: "minimax-*", ... }`) already covers M3, but explicit entries are added for clarity and to match the existing style (M2.1/2.5/2.7 are also explicit).

- [ ] **Step 3: Run pricing tests and verify they PASS**

Run:
```bash
cd /Users/hodtien/sourcecodes/github-code/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/minimax-m3-pricing.test.js --reporter=verbose
```

Expected: All (remaining) tests PASS.

- [ ] **Step 4: Re-run the model-registration tests to make sure nothing regressed**

Run:
```bash
cd /Users/hodtien/sourcecodes/github-code/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/provider-models-minimax-m3.test.js tests/unit/minimax-m3-pricing.test.js --reporter=verbose
```

Expected: All tests in both files PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/hodtien/sourcecodes/github-code/9router && git add src/shared/constants/pricing.js && git commit -m "feat(minimax): add Standard-tier pricing for MiniMax-M3"
```

---

## Task 6: Run the full test suite to confirm no regressions

**Files:** (none — read-only check)

- [ ] **Step 1: Run the full unit test suite**

Run:
```bash
cd /Users/hodtien/sourcecodes/github-code/9router/tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose 2>&1 | tail -60
```

Expected: The full suite reports `passed` (or at least, our 2 new test files all pass and no previously-passing test now fails). If unrelated tests fail due to env issues (e.g. missing `/tmp/node_modules`), that is acceptable — what matters is that our 2 new files pass and provider-validation.test.js (which was the smoke check earlier) still passes.

- [ ] **Step 2: Sanity-check no other test files reference MiniMax-M3 in a way that would break**

Run:
```bash
cd /Users/hodtien/sourcecodes/github-code/9router && grep -rn "MiniMax-M3\|minimax-m3" tests/ 2>/dev/null
```

Expected: Only the 2 files we just created. If any pre-existing test mentions M3, that is unexpected — investigate before committing further.

- [ ] **Step 3: (No commit — verification step only)**

If everything passes, no commit needed. If you found unrelated failures, document them in your report and decide whether to fix or roll back.

---

## Task 7: Manual integration smoke test (test button)

**Files:** (none — manual verification)

This step requires a running 9router instance with at least one `minimax` or `minimax-cn` connection configured. The agent may not have a live instance — if so, mark as **MANUAL** and skip.

- [ ] **Step 1: Start the dev server (if available)**

```bash
cd /Users/hodtien/sourcecodes/github-code/9router && npm run dev
```

- [ ] **Step 2: Call the test endpoint for M3 (international)**

```bash
curl -X POST 'http://127.0.0.1:20128/api/models/test' \
  -H 'Content-Type: application/json' \
  -d '{"model":"minimax/MiniMax-M3"}'
```

Expected:
```json
{ "ok": true, "latencyMs": <number>, "error": null, "status": 200 }
```

Before this change, this would return `{ "ok": false, "error": "Provider returned no completion choices for this model" }`.

- [ ] **Step 3: Call the test endpoint for M3 (China)**

```bash
curl -X POST 'http://127.0.0.1:20128/api/models/test' \
  -H 'Content-Type: application/json' \
  -d '{"model":"minimax-cn/MiniMax-M3"}'
```

Expected:
```json
{ "ok": true, "latencyMs": <number>, "error": null, "status": 200 }
```

- [ ] **Step 4: Verify M3 is in the model list**

```bash
curl 'http://127.0.0.1:20128/api/v1/models' | grep -o '"id":"minimax[^"]*M3"' | sort -u
```

Expected output (order may vary):
```
"id":"minimax-cn/MiniMax-M3"
"id":"minimax/MiniMax-M3"
```

- [ ] **Step 5: (No commit — manual verification step only)**

Report results in your handoff. If the upstream is unreachable or no connection is configured, the test will return ok:false with a network error — that is acceptable, the important thing is that the test no longer returns "no completion choices" (which was the original symptom of M3 being missing from the registry).

---

## Self-Review Checklist

After completing all tasks, verify:

- [ ] All 4 model-registration tests pass
- [ ] All 2 (or 3) pricing tests pass
- [ ] No previously-passing test now fails
- [ ] `PROVIDER_MODELS.minimax` contains MiniMax-M3 with `targetFormat: "claude"` as first entry
- [ ] `PROVIDER_MODELS["minimax-cn"]` contains MiniMax-M3 with `targetFormat: "claude"` as first entry
- [ ] `pricing.js` contains both `MiniMax-M3` and `minimax-m3` entries with input 0.30, output 1.20, cached 0.06
- [ ] M2.7/M2.5/M2.1 entries still present in both providers (no regression)
- [ ] All commits follow conventional commit format (`feat:`, `test:`)
- [ ] Git log shows: failing test → fix international → fix China → failing pricing test → fix pricing

## Rollback

If something goes wrong, revert all 3 implementation commits (keep the failing-test commits if you want a clean revert story, or revert them too):

```bash
cd /Users/hodtien/sourcecodes/github-code/9router && git revert --no-commit HEAD~3..HEAD
```

This produces 3 revert commits you can drop with `git revert --abort` if you change your mind.
