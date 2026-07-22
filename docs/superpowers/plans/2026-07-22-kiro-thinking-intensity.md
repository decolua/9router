# Kiro Thinking Intensity Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Kiro `REQUEST_BODY_INVALID` errors when dashboard-generated `model(level)` names are used, while preserving agentic behavior and native effort mapping where supported.

**Architecture:** Add one Kiro-specific model-intent normalization helper that consumes the existing generic `model(level)` suffix semantics, then pass the clean model and parsed override through both OpenAI→Kiro and Claude→Kiro translators. Keep the provider capability source authoritative for dashboard level choices and use translator tests to prove the emitted Kiro envelope.

**Tech Stack:** Node.js 22+, ESM JavaScript, Vitest, Next.js dashboard, Kiro/AWS CodeWhisperer request translators.

## Global Constraints

- Do not change thinking behavior for non-Kiro providers.
- Preserve existing synthetic `-thinking` and `-agentic` model variants.
- Do not add live Kiro credentials or network-dependent tests.
- Use existing `parseSuffix`, Kiro effort-path helpers, and capability metadata; do not create a second generic thinking parser.
- Follow Conventional Commits and the repository's test baseline guidance.

## File Map

- Modify: `open-sse/config/kiroConstants.js` — expose one helper that parses a Kiro model’s optional `(level)` suffix and resolves its clean synthetic/upstream model.
- Modify: `open-sse/translator/request/openai-to-kiro.js` — consume the helper and apply explicit suffix intent before building the Kiro payload.
- Modify: `open-sse/translator/request/claude-to-kiro.js` — apply the same behavior for the direct Claude route.
- Modify: `open-sse/providers/thinkingLevels.js` — prevent unsupported Kiro models from advertising native selectable levels while preserving legacy binary thinking variants.
- Test: `tests/unit/openai-to-kiro.test.js` — OpenAI-shaped regression tests for clean model IDs, agentic preservation, unsupported models, and supported native fields.
- Test: `tests/translator/claude-kiro-direct.test.js` — direct Claude-shaped regression tests for the same boundary.
- Test: `tests/unit/thinking-levels-kiro.test.js` — dashboard capability-level tests if no existing Kiro-level test file can cover the behavior.

### Task 1: Create the Kiro model-intent helper

**Files:**
- Modify: `open-sse/config/kiroConstants.js`
- Test: `tests/unit/openai-to-kiro.test.js`

**Interfaces:**
- Consumes: `parseSuffix` from `open-sse/translator/concerns/thinkingUnified.js`, `resolveKiroModel`, and `resolveKiroEffortPath`.
- Produces: `resolveKiroModelIntent(model)` returning `{ model, upstream, agentic, thinking, thinkingOverride }`, where `model` is the clean synthetic ID, `upstream` is the clean real Kiro ID, and `thinkingOverride` is `null` or the parsed generic thinking config.

- [ ] **Step 1: Write the failing helper-level assertion**

Add a focused test through the existing translator output rather than exporting a test-only API:

```js
it("consumes a parenthesized Kiro thinking level before synthetic suffix resolution", () => {
  const out = openaiToKiroRequest(
    "claude-sonnet-4.5-thinking-agentic(high)",
    { messages: [{ role: "user", content: "hello" }] },
    true,
    {},
  );

  expect(out.conversationState.currentMessage.userInputMessage.modelId)
    .toBe("claude-sonnet-4.5");
  expect(out.systemPrompt).toContain("CHUNKED WRITE PROTOCOL");
});
```

- [ ] **Step 2: Run the focused test and verify the current failure**

Run:

```bash
cd tests && npx vitest run unit/openai-to-kiro.test.js -t "parenthesized Kiro"
```

Expected: FAIL because the current emitted model ID remains `claude-sonnet-4.5-thinking-agentic(high)` and agentic handling is not reached.

- [ ] **Step 3: Implement the smallest helper**

Import `parseSuffix`, parse the trailing value once, and feed `cleanModel` to `resolveKiroModel`. Keep `thinkingOverride` as the parsed `override`; do not mutate the caller body in the helper.

- [ ] **Step 4: Re-run the focused test**

Run the same Vitest command. Expected: PASS with the clean upstream model ID and agentic prompt intact.

- [ ] **Step 5: Commit the helper and its regression**

```bash
git add open-sse/config/kiroConstants.js tests/unit/openai-to-kiro.test.js
git commit -m "fix(kiro): normalize thinking level suffixes before model resolution"
```

### Task 2: Apply the override in both Kiro translators

**Files:**
- Modify: `open-sse/translator/request/openai-to-kiro.js`
- Modify: `open-sse/translator/request/claude-to-kiro.js`
- Test: `tests/unit/openai-to-kiro.test.js`
- Test: `tests/translator/claude-kiro-direct.test.js`

**Interfaces:**
- Consumes: `resolveKiroModelIntent`, existing `resolveKiroThinkingBudget`, `buildKiroAdditionalModelRequestFieldsForModel`, and `usesKiroNativeGptEffort`.
- Produces: Kiro payloads with clean `modelId`; supported models receive native effort fields from the suffix; unsupported models receive no native effort fields but retain agentic/legacy behavior.

- [ ] **Step 1: Add failing OpenAI→Kiro cases**

Cover the two issue models and one supported model:

```js
it.each([
  ["claude-sonnet-4.5-thinking-agentic(high)", "claude-sonnet-4.5"],
  ["glm-5-thinking-agentic(medium)", "glm-5"],
])("does not send unsupported Kiro effort fields for %s", (model, upstream) => {
  const out = openaiToKiroRequest(model, {
    messages: [{ role: "user", content: "hello" }],
  }, true, {});

  expect(out.conversationState.currentMessage.userInputMessage.modelId).toBe(upstream);
  expect(out.additionalModelRequestFields).toBeUndefined();
  expect(out.systemPrompt).toContain("CHUNKED WRITE PROTOCOL");
});

it("maps a supported Kiro Claude suffix to native effort fields", () => {
  const out = openaiToKiroRequest("claude-sonnet-5-thinking-agentic(high)", {
    messages: [{ role: "user", content: "hello" }],
  }, true, {});

  expect(out.conversationState.currentMessage.userInputMessage.modelId).toBe("claude-sonnet-5");
  expect(out.additionalModelRequestFields).toEqual({
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: "high" },
  });
});
```

- [ ] **Step 2: Run the OpenAI-focused tests and verify RED**

```bash
cd tests && npx vitest run unit/openai-to-kiro.test.js -t "unsupported Kiro|supported Kiro Claude"
```

Expected: FAIL because both translators currently receive the preserved parenthesized suffix and do not consume it.

- [ ] **Step 3: Add the matching direct Claude→Kiro regression**

Use the existing `C2K` helper in `tests/translator/claude-kiro-direct.test.js` and assert the same clean model ID, no native fields for `claude-sonnet-4.5-thinking-agentic(high)`, and preserved chunked-write prompt.

- [ ] **Step 4: Implement minimal override precedence**

In each translator, use `resolveKiroModelIntent(model)` and derive an effective body for effort mapping only when `thinkingOverride` exists. Preserve explicit body fields when no suffix override exists. Pass the clean resolved upstream model to all Kiro model/capability helpers.

- [ ] **Step 5: Re-run focused OpenAI and Claude tests**

```bash
cd tests && npx vitest run unit/openai-to-kiro.test.js tests/translator/claude-kiro-direct.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 6: Commit translator changes**

```bash
git add open-sse/translator/request/openai-to-kiro.js open-sse/translator/request/claude-to-kiro.js tests/unit/openai-to-kiro.test.js tests/translator/claude-kiro-direct.test.js
git commit -m "fix(kiro): preserve agentic requests with unsupported thinking levels"
```

### Task 3: Align the dashboard’s selectable Kiro levels

**Files:**
- Modify: `open-sse/providers/thinkingLevels.js`
- Test: `tests/unit/thinking-levels-kiro.test.js`

**Interfaces:**
- Consumes: Kiro’s existing `resolveKiroEffortPath` and `resolveKiroModel` semantics.
- Produces: `getThinkingLevels("kiro", model)` returns native levels only for models accepted by Kiro’s effort-path resolver; legacy Kiro thinking variants remain available as model variants.

- [ ] **Step 1: Add the failing capability assertions**

```js
it("does not advertise native intensity for legacy Kiro models", () => {
  expect(getThinkingLevels("kiro", "claude-sonnet-4.5")).toBeNull();
  expect(getThinkingLevels("kiro", "glm-5")).toEqual(["none", "thinking"]);
});

it("advertises native levels for supported Kiro models", () => {
  expect(getThinkingLevels("kiro", "claude-sonnet-5")).toContain("high");
  expect(getThinkingLevels("kiro", "gpt-5.6-sol")).toContain("xhigh");
});
```

- [ ] **Step 2: Run the capability test and verify RED**

```bash
cd tests && npx vitest run unit/thinking-levels-kiro.test.js
```

Expected: FAIL because the current generic capability resolver advertises reasoning levels for legacy Kiro catalog entries.

- [ ] **Step 3: Implement the capability guard**

For provider `kiro`, resolve the clean model and return `null` when `resolveKiroEffortPath(cleanModel)` is `null`; keep the existing binary legacy behavior in the translator rather than advertising parenthesized levels.

- [ ] **Step 4: Run the capability and focused translator tests**

Expected: all tests PASS.

- [ ] **Step 5: Commit capability alignment**

```bash
git add open-sse/providers/thinkingLevels.js tests/unit/thinking-levels-kiro.test.js
git commit -m "fix(kiro): expose thinking levels only for supported models"
```

### Task 4: Fork, integrate, and verify the contribution

**Files:**
- Modify: none beyond Tasks 1–3

- [ ] **Step 1: Configure fork remotes and branch from upstream**

```bash
gh repo fork decolua/9router --remote
git remote rename origin upstream
git remote rename fork origin
git fetch upstream main
git checkout -b fix/kiro-thinking-intensity upstream/main
```

- [ ] **Step 2: Reapply the committed spec and implementation commits if the branch was created after spec work**

```bash
git cherry-pick b4ca749
```

- [ ] **Step 3: Run all independent translator tests**

```bash
cd tests && npx vitest run translator unit
```

Expected: the repository’s documented known failures remain the only failures; compare with `tests/__baseline__/verify-no-regression.mjs`.

- [ ] **Step 4: Run root lint on changed JavaScript**

```bash
cd ..
npx eslint open-sse/config/kiroConstants.js open-sse/translator/request/openai-to-kiro.js open-sse/translator/request/claude-to-kiro.js open-sse/providers/thinkingLevels.js
```

- [ ] **Step 5: Run diff hygiene checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended source/test/spec files present.

- [ ] **Step 6: Push the fork branch and open the upstream PR**

```bash
git push -u origin fix/kiro-thinking-intensity
gh pr create --repo decolua/9router \
  --head ankit1324:fix/kiro-thinking-intensity \
  --title "fix(kiro): normalize dashboard thinking intensity models" \
  --body "Fixes #2716\n\nPreserves agentic behavior while preventing unsupported Kiro thinking levels from producing invalid upstream model IDs or effort fields. Includes regression coverage for Claude Sonnet 4.5 and GLM-5 thinking-agentic models."
```
