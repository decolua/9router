# GPT-5.6 Codex Reasoning Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Codex-advertised Max and Ultra overrides for GPT-5.6 Sol and Terra, preserve Max for Luna, and convert Luna Ultra to Max without changing Kiro or generic OpenAI-format behavior.

**Architecture:** Keep the supported reasoning matrix in the existing `getThinkingLevels(provider, model)` resolver and reuse that result in both translation and Codex executor normalization. The dashboard already consumes this resolver, so no UI component change is required. Unsupported top-end levels remain safely normalized, with Luna Ultra selecting Luna's supported Max level.

**Tech Stack:** JavaScript ES modules, Next.js, Vitest, Codex Responses transport.

## Global Constraints

- Apply the new overrides only to the OpenAI Codex provider (`codex`, exposed as `cx/`).
- Sol and Terra support `max` and `ultra`; Luna supports `max` but not `ultra`.
- Convert Luna `ultra` requests to `max` in both translated and native passthrough request paths.
- Preserve existing Kiro and generic OpenAI-compatible normalization.
- Do not add runtime model-catalog fetching, dependencies, pricing changes, or unrelated refactors.
- Write each behavior test first and observe the expected failure before changing production code.

---

### Task 1: Provider-scoped GPT-5.6 level matrix

**Files:**
- Modify: `tests/unit/thinking-levels-gpt56-sol.test.js`
- Modify: `open-sse/providers/thinkingLevels.js`

**Interfaces:**
- Consumes: `getThinkingLevels(provider, model)` and existing capability metadata.
- Produces: `getThinkingLevels(provider, model): string[] | null` with Codex-only GPT-5.6 level overrides.

- [ ] **Step 1: Replace the Sol-only assertions with the complete behavior matrix**

Use literal expected arrays so each model/provider contract is independently checked:

```js
it.each([
  ["gpt-5.6-sol", ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-5.6-terra", ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-5.6-luna", ["none", "minimal", "low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.6-sol-review", ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-5.6-terra-review", ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]],
  ["gpt-5.6-luna-review", ["none", "minimal", "low", "medium", "high", "xhigh", "max"]],
])("returns Codex levels for %s", (model, expected) => {
  expect(getThinkingLevels("codex", model)).toEqual(expected);
});

it("does not expose Codex-only GPT-5.6 overrides on Kiro", () => {
  expect(getThinkingLevels("kiro", "gpt-5.6-sol")).toEqual([
    "none", "minimal", "low", "medium", "high", "xhigh",
  ]);
});
```

Keep the older Codex-model assertion to protect the existing `gpt-5.3-codex` behavior.

- [ ] **Step 2: Run the level test and verify it fails for the missing matrix/provider scoping**

Run:

```bash
npx vitest run tests/unit/thinking-levels-gpt56-sol.test.js
```

Expected: FAIL because Sol lacks Ultra, Terra/Luna lack Max, and Kiro currently inherits Sol Max.

- [ ] **Step 3: Add provider-aware pattern matching and the three Codex model rules**

Update `PATTERN_THINKING` entries to accept an optional `provider` field and match it in `getThinkingLevels`:

```js
const CODEX_GPT_5_6_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const PATTERN_THINKING = [
  { provider: "codex", pattern: "*gpt-5.6-sol*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-terra*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-luna*", levels: CODEX_GPT_5_6_LEVELS },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] },
];

const hit = PATTERN_THINKING.find((entry) =>
  (!entry.provider || entry.provider === provider) && matchPattern(entry.pattern, model)
);
```

- [ ] **Step 4: Re-run the level test and verify it passes**

Run:

```bash
npx vitest run tests/unit/thinking-levels-gpt56-sol.test.js
```

Expected: 1 test file passed with no failures.

- [ ] **Step 5: Commit the capability matrix**

```bash
git add open-sse/providers/thinkingLevels.js tests/unit/thinking-levels-gpt56-sol.test.js
git commit -m "feat(codex): expose GPT-5.6 reasoning overrides"
```

### Task 2: Model-aware shared thinking translation

**Files:**
- Modify: `tests/translator/thinking-unified.test.js`
- Modify: `open-sse/translator/concerns/thinkingUnified.js`

**Interfaces:**
- Consumes: `getThinkingLevels(provider, cleanModel): string[] | null` from Task 1.
- Produces: `parseSuffix(model)` support for `ultra` and `applyThinking(...)` output that preserves supported Codex levels.

- [ ] **Step 1: Add failing suffix and translation tests**

Add a literal parser assertion:

```js
expect(parseSuffix("gpt-5.6-sol(ultra)")).toEqual({
  cleanModel: "gpt-5.6-sol",
  override: { mode: "level", level: "ultra" },
});
```

Add table-driven Codex assertions using direct request fields:

```js
it.each([
  ["gpt-5.6-sol", "max", "max"],
  ["gpt-5.6-sol", "ultra", "ultra"],
  ["gpt-5.6-terra", "max", "max"],
  ["gpt-5.6-terra", "ultra", "ultra"],
  ["gpt-5.6-luna", "max", "max"],
  ["gpt-5.6-luna", "ultra", "max"],
])("normalizes Codex %s effort %s to %s", (model, effort, expected) => {
  const out = apply("openai-responses", model, { reasoning: { effort } }, "codex");
  expect(out.reasoning_effort).toBe(expected);
});
```

Add a parenthesized override assertion and Kiro isolation assertion:

```js
expect(apply("openai-responses", "gpt-5.6-sol(ultra)", {}, "codex").reasoning_effort).toBe("ultra");
expect(apply("openai", "gpt-5.6-sol", { reasoning_effort: "max" }, "kiro").reasoning_effort).toBe("xhigh");
```

- [ ] **Step 2: Run the translator test and verify it fails for Ultra parsing and preserved Max/Ultra**

Run:

```bash
npx vitest run tests/translator/thinking-unified.test.js
```

Expected: FAIL because Ultra suffixes are ignored and OpenAI translation clamps Max to XHigh.

- [ ] **Step 3: Implement supported-level normalization in the shared translator**

Import `getThinkingLevels`. Recognize `ultra` explicitly in `parseSuffix` without adding it to the budget map. Resolve supported levels once in `applyThinking` and pass them to `applyFormat`.

Use this normalization rule for the OpenAI format:

```js
function normalizeOpenAILevel(level, supportedLevels) {
  if (level !== "max" && level !== "ultra") return level;
  if (supportedLevels?.includes(level)) return level;
  if (level === "ultra" && supportedLevels?.includes("max")) return "max";
  return "xhigh";
}
```

Keep `none`, automatic effort, budget conversion, and every non-OpenAI format unchanged.

- [ ] **Step 4: Re-run the translator and generic OpenAI clamp tests**

Run:

```bash
npx vitest run tests/translator/thinking-unified.test.js tests/unit/thinking-effort-openai-max-clamp.test.js
```

Expected: 2 test files passed; generic OpenAI Max still becomes XHigh.

- [ ] **Step 5: Commit shared translation support**

```bash
git add open-sse/translator/concerns/thinkingUnified.js tests/translator/thinking-unified.test.js
git commit -m "feat(codex): preserve supported reasoning efforts"
```

### Task 3: Codex native passthrough normalization

**Files:**
- Modify: `tests/unit/codex-fast-capacity.test.js`
- Modify: `open-sse/executors/codex.js`

**Interfaces:**
- Consumes: `getThinkingLevels("codex", upstreamModel): string[] | null` from Task 1.
- Produces: `CodexExecutor.transformRequest(...)` payloads with model-supported upstream `reasoning.effort` values.

- [ ] **Step 1: Add failing Codex executor behavior tests**

Add a separate `describe("Codex reasoning normalization", ...)` block with real `transformRequest` calls:

```js
it.each([
  ["gpt-5.6-sol", "max", "max"],
  ["gpt-5.6-sol", "ultra", "ultra"],
  ["gpt-5.6-terra", "max", "max"],
  ["gpt-5.6-terra", "ultra", "ultra"],
  ["gpt-5.6-luna", "max", "max"],
  ["gpt-5.6-luna", "ultra", "max"],
])("normalizes %s effort %s to %s", (model, effort, expected) => {
  const body = new CodexExecutor().transformRequest(model, {
    model,
    input: "hi",
    reasoning: { effort },
  }, true, {});
  expect(body.reasoning.effort).toBe(expected);
});

it("resolves review models before applying the reasoning matrix", () => {
  const body = new CodexExecutor().transformRequest("gpt-5.6-terra-review", {
    model: "gpt-5.6-terra-review",
    input: "hi",
    reasoning_effort: "ultra",
  }, true, {});
  expect(body.model).toBe("gpt-5.6-terra");
  expect(body.reasoning.effort).toBe("ultra");
});
```

Keep the existing GPT-5.5 Max-to-XHigh fast-tier test.

- [ ] **Step 2: Run the executor test and verify supported values fail by being clamped**

Run:

```bash
npx vitest run tests/unit/codex-fast-capacity.test.js
```

Expected: FAIL because current normalization maps supported Max to XHigh and does not map Luna Ultra to Max.

- [ ] **Step 3: Make Codex normalization model-aware**

Import `getThinkingLevels` and replace the global Max clamp with:

```js
function normalizeReasoningEffort(model, value) {
  const supportedLevels = getThinkingLevels("codex", model);
  if (supportedLevels?.includes(value)) return value;
  if (value === "ultra" && supportedLevels?.includes("max")) return "max";
  if (value === "max" || value === "ultra") return "xhigh";
  return value;
}
```

Call it only after `body.model` has resolved review aliases to their upstream base model. Pass `body.model` for both `reasoning_effort` and existing `reasoning.effort` request shapes.

- [ ] **Step 4: Re-run the executor and focused feature suites**

Run:

```bash
npx vitest run tests/unit/codex-fast-capacity.test.js tests/unit/thinking-levels-gpt56-sol.test.js tests/translator/thinking-unified.test.js tests/unit/thinking-effort-openai-max-clamp.test.js
```

Expected: 4 test files passed with no failures.

- [ ] **Step 5: Commit native Codex normalization**

```bash
git add open-sse/executors/codex.js tests/unit/codex-fast-capacity.test.js
git commit -m "feat(codex): forward GPT-5.6 max and ultra efforts"
```

### Task 4: Full verification and pull request

**Files:**
- Verify all changed production, test, design, and plan files.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified branch pushed to `origin` and a pull request targeting `decolua/9router:master`.

- [ ] **Step 1: Run all focused regression tests**

```bash
npx vitest run tests/unit/thinking-levels-gpt56-sol.test.js tests/translator/thinking-unified.test.js tests/unit/thinking-effort-openai-max-clamp.test.js tests/unit/codex-fast-capacity.test.js
```

Expected: all selected test files and tests pass.

- [ ] **Step 2: Run the complete unit test suite**

```bash
npx vitest run tests/unit tests/translator
```

Expected: all test files pass with zero failed tests.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: Next.js production build exits with status 0.

- [ ] **Step 4: Verify repository hygiene and requirement coverage**

```bash
git diff --check upstream/master...HEAD
git status --short --branch
git log --oneline upstream/master..HEAD
```

Expected: no whitespace errors, no uncommitted source changes, and only scoped feature commits.

- [ ] **Step 5: Push the feature branch and open the pull request**

```bash
git push -u origin codex/gpt-5-6-reasoning-overrides
gh pr create --repo decolua/9router --base master --head seakleangnhak:codex/gpt-5-6-reasoning-overrides --title "feat(codex): support GPT-5.6 Max and Ultra overrides" --body $'## Summary\n- expose Max and Ultra for Codex GPT-5.6 Sol and Terra\n- expose Max for Codex GPT-5.6 Luna and normalize Luna Ultra to Max\n- keep Kiro and generic OpenAI-compatible reasoning behavior unchanged\n\n## Verification\n- `npx vitest run tests/unit tests/translator`\n- `npm run build`'
```

The pull request body must summarize the Codex-only support matrix, Luna Ultra-to-Max fallback, Kiro isolation, and fresh test/build evidence.
