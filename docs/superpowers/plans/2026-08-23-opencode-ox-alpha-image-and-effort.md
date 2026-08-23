# Ox Alpha Image and Effort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable image input and correct `reasoning_effort` mapping for Ox Alpha (`x-preview-f-free` / `ox-alpha-free`) under `opencode`/`oc`/`opencode-go`/`ocg`, plus suffix-proof capability lookup.

**Architecture:** Single shared `OX_ALPHA_CAPABILITIES` referenced from four provider keys; `getCapabilitiesForModel` strips trailing `(suffix)` before every lookup; new `openai-low-high-max` format isolates Ox Alpha effort mapping from generic OpenAI.

**Tech Stack:** Plain JS ESM, `open-sse` capabilities/thinking, Vitest, GitNexus CLI, SQLite (no DB change)

---

## File Map

- Modify: `open-sse/providers/capabilities.js` — add `OX_ALPHA_CAPABILITIES`, delete global `MODEL_CAPABILITIES["x-preview-f-free"]`, add 4 provider entries, add suffix normalization in `getCapabilitiesForModel`
- Modify: `open-sse/providers/thinkingLevels.js` — add `"openai-low-high-max": ["low","high","max"]` to `FORMAT_LEVELS`
- Modify: `open-sse/translator/concerns/thinkingUnified.js` — add `toLowHighMaxLevel` helper + `case "openai-low-high-max"` in `applyFormat`
- Modify: `tests/unit/opencode-ox-alpha-free.test.js` — extend with caps isolation, suffix equality, levels, effort mapping, image pass-through tests

## Constraints

- No live authenticated call, secrets, version bump, pack/install, PR, push.
- Never touch/stage: `CLAUDE.md`, `checkpoint-pr-review-implementation-2026-08-22.md`, `data-dev/`, `tests/unit/probe-dup-endpoints.test.js`, `tree3.json`.
- One source commit after reviews: `feat(opencode): enable Ox Alpha image and effort` — explicit `git add` 4 files only, never `-A`.
- Plan commit via `git add -f docs/superpowers/plans/2026-08-23-opencode-ox-alpha-image-and-effort.md` + `docs(opencode): plan Ox Alpha image and effort`.

---

### Task 0: Preflight — impact + baseline snapshot

**Files:** read-only

- [ ] Step 0.1: Confirm worktree state

```bash
git rev-parse HEAD
git branch --show-current
git status --porcelain
git diff --check
```

- [ ] Step 0.2: GitNexus impact before edits (upstream direction, absolute repo)

```bash
cmd.exe /d /s /c "gitnexus impact --target getCapabilitiesForModel --direction upstream --repo D:\Code\9router"
cmd.exe /d /s /c "gitnexus impact --target stripUnsupportedModalities --direction upstream --repo D:\Code\9router"
cmd.exe /d /s /c "gitnexus impact --target applyThinking --direction upstream --repo D:\Code\9router"
cmd.exe /d /s /c "gitnexus impact --target getThinkingLevels --direction upstream --repo D:\Code\9router"
```

Expected: `getCapabilitiesForModel` CRITICAL ~61, `applyThinking` CRITICAL 9, `getThinkingLevels` CRITICAL 13; warn user if HIGH/CRITICAL.

- [ ] Step 0.3: Baseline snapshot (record pass/fail counts)

```bash
node tests/__baseline__/verify-no-regression.mjs
node tests/__baseline__/verify-providers.mjs
node tests/__baseline__/verify-alias.mjs
node tests/__baseline__/verify-oauth-urls.mjs
```

- [ ] Step 0.4: Read current source for exact context

Read `open-sse/providers/capabilities.js:73-114`, `:331-357`, `open-sse/providers/thinkingLevels.js:8-32`, `open-sse/translator/concerns/thinkingUnified.js:1-15,132-237,334-353`, `tests/unit/opencode-ox-alpha-free.test.js` full, `open-sse/translator/concerns/thinking.js:35-45`, `tests/translator/thinking-unified.test.js:1-20`.

---

### Task 1: RED — extend `opencode-ox-alpha-free.test.js` (no commit)

**Files:**
- Modify: `tests/unit/opencode-ox-alpha-free.test.js`

- [ ] Step 1.1: Replace file content with extended RED suite (exact imports, exact cases)

```js
import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelTargetFormat, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel, DEFAULT_CAPABILITIES } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import opencodeRegistry from "../../open-sse/providers/registry/opencode.js";

const OX_ID = "x-preview-f-free";
const GO_ID = "ox-alpha-free";

describe("OpenCode Free Ox Alpha Free (oc/x-preview-f-free)", () => {
  it("exposes Ox Alpha Free as static OpenAI Chat Completions model", () => {
    const ids = (PROVIDER_MODELS.oc || []).map((m) => m.id);
    expect(ids).toContain(OX_ID);
    const entry = (PROVIDER_MODELS.oc || []).find((m) => m.id === OX_ID);
    expect(entry?.name).toBe("Ox Alpha Free");
    expect(getModelTargetFormat("oc", OX_ID)).toBe("openai");
    expect(getModelSupportedFormats("oc", OX_ID)).toEqual(["openai"]);
  });

  it("keeps dynamic fetcher + passthrough and does not require explicit transports on base", () => {
    expect(opencodeRegistry.modelsFetcher).toEqual({ url: "https://opencode.ai/zen/v1/models", type: "opencode-free" });
    expect(opencodeRegistry.passthroughModels).toBe(true);
    expect(PROVIDERS.opencode.format).toBe("openai");
    expect(PROVIDERS.opencode.baseUrl).toBe("https://opencode.ai");
  });

  it("OpenCodeExecutor.buildUrl routes Ox Alpha Free to Zen Chat Completions", () => {
    const url = new OpenCodeExecutor().buildUrl(OX_ID);
    expect(url).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("Claude-source request still targets openai (no extra transport needed on base)", () => {
    expect(getModelTargetFormat("oc", OX_ID)).toBe("openai");
    expect(getModelSupportedFormats("oc", OX_ID)).toEqual(["openai"]);
    expect(new OpenCodeExecutor().buildUrl(OX_ID)).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("resolves image input + reasoning capability deltas from models.dev metadata", () => {
    const caps = getCapabilitiesForModel("opencode", OX_ID);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai-low-high-max");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(131072);
    expect(caps.imageOutput).toBe(false);
    expect(caps.audioInput).toBe(false);
    expect(caps.videoInput).toBe(false);
    expect(caps.pdf).toBe(false);
  });

  it("keeps an OpenAI image_url block for Ox Alpha Free (vision declared -> no strip)", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "what is in this picture?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
    ] }] };
    const caps = getCapabilitiesForModel("opencode", OX_ID);
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    const blocks = body.messages[0].content;
    expect(blocks.some((b) => b.type === "image_url")).toBe(true);
    expect(blocks.some((b) => /image omitted/.test(b.text || ""))).toBe(false);
  });
});

describe("Ox Alpha capabilities — 4 provider/id pairs + isolation", () => {
  it.each([
    ["opencode", OX_ID],
    ["oc", OX_ID],
    ["opencode-go", GO_ID],
    ["ocg", GO_ID],
  ])("caps %s/%s equals OX_ALPHA_CAPABILITIES", (provider, model) => {
    const caps = getCapabilitiesForModel(provider, model);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("openai-low-high-max");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(131072);
    expect(caps.videoInput).toBe(false);
  });

  it("bare ids without provider do not pick up Ox Alpha caps", () => {
    expect(getCapabilitiesForModel(null, OX_ID).vision).toBe(false);
    expect(getCapabilitiesForModel(null, GO_ID).vision).toBe(false);
    expect(getCapabilitiesForModel(undefined, OX_ID).vision).toBe(false);
  });

  it("cross-provider isolation: nvidia and other provider do not pick up Ox Alpha caps", () => {
    expect(getCapabilitiesForModel("nvidia", OX_ID).vision).toBe(false);
    expect(getCapabilitiesForModel("nvidia", GO_ID).vision).toBe(false);
    expect(getCapabilitiesForModel("openai", OX_ID).thinkingFormat).not.toBe("openai-low-high-max");
  });

  it("suffix deep equality for 4 Ox pairs", () => {
    expect(getCapabilitiesForModel("opencode", `${OX_ID}(max)`)).toEqual(getCapabilitiesForModel("opencode", OX_ID));
    expect(getCapabilitiesForModel("oc", `${OX_ID}(max)`)).toEqual(getCapabilitiesForModel("oc", OX_ID));
    expect(getCapabilitiesForModel("opencode-go", `${GO_ID}(max)`)).toEqual(getCapabilitiesForModel("opencode-go", GO_ID));
    expect(getCapabilitiesForModel("ocg", `${GO_ID}(max)`)).toEqual(getCapabilitiesForModel("ocg", GO_ID));
    expect(getCapabilitiesForModel("ocg", `${GO_ID}(8192)`)).toEqual(getCapabilitiesForModel("ocg", GO_ID));
  });

  it("suffix deep equality for generic Claude family (existing pattern)", () => {
    expect(getCapabilitiesForModel(null, "claude-sonnet-4.6(max)")).toEqual(getCapabilitiesForModel(null, "claude-sonnet-4.6"));
  });

  it("getThinkingLevels for Ox Alpha returns low/high/max only", () => {
    expect(getThinkingLevels("opencode", OX_ID)).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("oc", OX_ID)).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("opencode-go", GO_ID)).toEqual(["low", "high", "max"]);
    expect(getThinkingLevels("ocg", GO_ID)).toEqual(["low", "high", "max"]);
  });

  it("getThinkingLevels bare/other returns null or without exact Ox set", () => {
    const bare = getThinkingLevels(null, OX_ID);
    // bare id has no provider cap -> reasoning false or default floor, never Ox set
    expect(bare === null || JSON.stringify(bare) !== JSON.stringify(["low", "high", "max"])).toBe(true);
  });
});

describe("Ox Alpha effort mapping (openai-low-high-max)", () => {
  const apply = (body, provider, model) => {
    const b = JSON.parse(JSON.stringify(body));
    applyThinking(FORMATS.OPENAI, model, b, provider);
    return b;
  };
  it.each([
    ["low", "low"],
    ["minimal", "low"],
    ["none", "low"],
    ["medium", "high"],
    ["high", "high"],
    ["xhigh", "max"],
    ["max", "max"],
    ["ultra", "max"],
  ])("opencode Ox %s -> %s", (input, expected) => {
    const out = apply({ reasoning_effort: input }, "opencode", OX_ID);
    expect(out.reasoning_effort).toBe(expected);
  });

  it("auto omits reasoning_effort", () => {
    const out = apply({ reasoning_effort: "auto" }, "oc", OX_ID);
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("unknown omits reasoning_effort", () => {
    const out = apply({ reasoning_effort: "unknown" }, "opencode", OX_ID);
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("numeric 8192 -> high via budgetToLevel", () => {
    const out = apply({ reasoning_effort: "8192" }, "opencode", OX_ID);
    // also via suffix form: model(8192) extracts budget already, but explicit effort 8192 also routes budget path
    const out2 = apply({}, "opencode", `${OX_ID}(8192)`);
    expect(out.reasoning_effort === "high" || out2.reasoning_effort === "high").toBe(true);
    expect(out2.reasoning_effort).toBe("high");
  });

  it("generic OpenAI max still clamps to xhigh", () => {
    const out = apply({ reasoning_effort: "max" }, "openai", "gpt-5");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("suffixed ocg image_url preservation and videoInput false", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
    ] }] };
    const caps = getCapabilitiesForModel("ocg", `${GO_ID}(max)`);
    expect(caps.videoInput).toBe(false);
    expect(caps.vision).toBe(true);
    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    expect(body.messages[0].content.some((b) => b.type === "image_url")).toBe(true);
  });
});
```

- [ ] Step 1.2: Run RED — record exact expected failures (do not commit)

```bash
D:/Code/9router/tests/node_modules/.bin/vitest.cmd --config D:/Code/9router/tests/vitest.config.js --dir D:/Code/9router/tests run unit/opencode-ox-alpha-free.test.js
```

Expected RED (before source edits): failures on `thinkingFormat` expecting `openai-low-high-max` but got `openai`, `vision` false for Go pairs, `suffix deep equality` mismatched (suffixed returns DEFAULT), `getThinkingLevels` not equal `["low","high","max"]`, effort mapping `max->max` got `xhigh`.

---

### Task 2: Implement `open-sse/providers/capabilities.js`

**Files:**
- Modify: `open-sse/providers/capabilities.js`

- [ ] Step 2.1: Add shared constant before `MODEL_CAPABILITIES` (delete old global entry)

Remove:

```js
  // OpenCode Zen Ox Alpha Free (image input + reasoning per models.dev; input-only until transport verified)
  "x-preview-f-free":  { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 131072 },
```

Add directly above `export const MODEL_CAPABILITIES = {`:

```js
const OX_ALPHA_CAPABILITIES = {
  vision: true,
  reasoning: true,
  thinkingFormat: "openai-low-high-max",
  thinkingCanDisable: false,
  contextWindow: 1000000,
  maxOutput: 131072,
};
```

Keep `MODEL_CAPABILITIES` without `x-preview-f-free` key.

- [ ] Step 2.2: Add four provider-scoped entries under `PROVIDER_CAPABILITIES`

Insert inside `export const PROVIDER_CAPABILITIES = {` (after `poolside` block, before closing `};`):

```js
  "opencode": {
    "x-preview-f-free": OX_ALPHA_CAPABILITIES,
  },
  "oc": {
    "x-preview-f-free": OX_ALPHA_CAPABILITIES,
  },
  "opencode-go": {
    "ox-alpha-free": OX_ALPHA_CAPABILITIES,
  },
  "ocg": {
    "ox-alpha-free": OX_ALPHA_CAPABILITIES,
  },
```

- [ ] Step 2.3: Replace `getCapabilitiesForModel` with suffix-normalized version (no new imports, no cycle)

Replace entire function `export function getCapabilitiesForModel(provider, model) { ... }` with:

```js
export function getCapabilitiesForModel(provider, model) {
  if (!model) return { ...DEFAULT_CAPABILITIES };
  const normalizedModel = model.replace(/\([^()]+\)\s*$/, "").trim();
  const baseModel = normalizedModel.includes("/") ? normalizedModel.split("/").pop() : normalizedModel;

  // 1. Provider-specific override
  if (provider) {
    const providerCaps = PROVIDER_CAPABILITIES[provider];
    if (providerCaps?.[normalizedModel]) return { ...DEFAULT_CAPABILITIES, ...providerCaps[normalizedModel] };
    if (providerCaps?.[baseModel]) return { ...DEFAULT_CAPABILITIES, ...providerCaps[baseModel] };
  }

  // 2. Canonical exact
  if (MODEL_CAPABILITIES[baseModel]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[baseModel] };
  if (MODEL_CAPABILITIES[normalizedModel]) return { ...DEFAULT_CAPABILITIES, ...MODEL_CAPABILITIES[normalizedModel] };

  // 3. Pattern match (first match wins)
  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, normalizedModel)) {
      return { ...DEFAULT_CAPABILITIES, ...caps };
    }
  }

  // 4. Floor
  return { ...DEFAULT_CAPABILITIES };
}
```

No import of `thinkingUnified` — use single regex line.

---

### Task 3: Implement `open-sse/providers/thinkingLevels.js`

**Files:**
- Modify: `open-sse/providers/thinkingLevels.js`

- [ ] Step 3.1: Add single format entry to `FORMAT_LEVELS` only

Replace:

```js
const FORMAT_LEVELS = {
  openai: L.openai,
  "claude-adaptive": L.levelMax,
```

With:

```js
const FORMAT_LEVELS = {
  openai: L.openai,
  "openai-low-high-max": ["low", "high", "max"],
  "claude-adaptive": L.levelMax,
```

No change to `L.openai`, `L.*`, or `PATTERN_THINKING`.

- [ ] Step 3.2: Verify `getThinkingLevels` logic unchanged (filter `none` when `thinkingCanDisable===false`)

No code change — existing line `if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");` already covers new format (which has no `none`).

---

### Task 4: Implement `open-sse/translator/concerns/thinkingUnified.js`

**Files:**
- Modify: `open-sse/translator/concerns/thinkingUnified.js`

- [ ] Step 4.1: Add helper `toLowHighMaxLevel` near `toGeminiThinkingLevel`/`toKimiReasoningEffort`

Insert after `function toKimiReasoningEffort(cfg) { ... }` (before `const GEMINI_LEVEL_OUTPUT_FLOOR`):

```js
function toLowHighMaxLevel(cfg) {
  const level = toLevel(cfg);
  if (level === "none" || level === "minimal" || level === "low") return "low";
  if (level === "medium" || level === "high") return "high";
  if (level === "xhigh" || level === "max" || level === "ultra") return "max";
  return null;
}
```

Uses existing `toLevel` (which handles `budget->level` via `budgetToLevel`). `auto`/`unknown` returns `null` -> caller omits field. No hardcode on model name.

- [ ] Step 4.2: Add isolated case in `applyFormat` switch (after `case "openai"` block)

Replace `switch (fmt) { case "openai": { ... }` tail with:

```js
  switch (fmt) {
    case "openai": {
      if (none && canDisable) { body.reasoning_effort = "none"; break; }
      const level = toLevel(eff);
      if (level) body.reasoning_effort = normalizeOpenAILevel(level, supportedLevels);
      break;
    }
    case "openai-low-high-max": {
      const level = toLowHighMaxLevel(eff);
      if (level) body.reasoning_effort = level;
      break;
    }
    case "claude-adaptive": {
```

Keep pre-switch clamp untouched: `const eff = none && !canDisable ? { mode: "level", level: "minimal" } : cfg;` — this maps `none` -> `minimal` -> `low` for Ox Alpha (always-thinking). Numeric budget flows via `toLevel` -> collapsed.

Do not modify generic `openai` path, `normalizeOpenAILevel`, or `budgetToLevel`.

---

### Task 5: GREEN — targeted Vitest

**Files:** none (verify only)

- [ ] Step 5.1: Run targeted suite (exact established command; `--config`/`--dir` before `run`, filters after)

```bash
D:/Code/9router/tests/node_modules/.bin/vitest.cmd --config D:/Code/9router/tests/vitest.config.js --dir D:/Code/9router/tests run unit/opencode-ox-alpha-free.test.js translator/thinking-unified.test.js unit/thinking-effort-openai-max-clamp.test.js unit/capabilities.test.js unit/combo-autoswitch.test.js
```

If CLI rejects ordering, fallback: `npx vitest run --config D:/Code/9router/tests/vitest.config.js --dir D:/Code/9router/tests unit/opencode-ox-alpha-free.test.js translator/thinking-unified.test.js unit/thinking-effort-openai-max-clamp.test.js unit/capabilities.test.js unit/combo-autoswitch.test.js`.

Expected: all 5 files PASS. Specifically: `unit/opencode-ox-alpha-free.test.js` all new cases green, `unit/thinking-effort-openai-max-clamp.test.js` still asserts `max->xhigh` for generic OpenAI, `translator/thinking-unified.test.js` unchanged.

- [ ] Step 5.2: Fix failures with minimum diff (only files listed). Re-run until green.

---

### Task 6: Baselines + GitNexus detect + git checks

- [ ] Step 6.1: Baseline verifiers from repo root

```bash
node tests/__baseline__/verify-no-regression.mjs
node tests/__baseline__/verify-providers.mjs
node tests/__baseline__/verify-alias.mjs
node tests/__baseline__/verify-oauth-urls.mjs
```

Expected: PASS (no regression vs committed snapshots).

- [ ] Step 6.2: GitNexus detect before commit

```bash
cmd.exe /d /s /c "gitnexus detect-changes --scope compare --base-ref master --repo D:\Code\9router"
```

Expected: only 4 files changed, flows limited to thinking/capability paths; no unexpected provider/registry churn.

- [ ] Step 6.3: Git hygiene

```bash
git diff --check
git status
```

Must show exactly 4 modified files: `open-sse/providers/capabilities.js`, `open-sse/providers/thinkingLevels.js`, `open-sse/translator/concerns/thinkingUnified.js`, `tests/unit/opencode-ox-alpha-free.test.js`. No staged `CLAUDE.md`, checkpoint, `data-dev/`, `probe-dup-endpoints`, `tree3.json`.

---

### Task 7: Two-stage review (fresh subagent per review)

**Gate 1 — Spec compliance:** fresh subagent checks every spec requirement maps to code/test, no placeholders, exact helpers/names, suffix regex exact, provider keys exact, no video claim.

**Gate 2 — Code quality:** fresh subagent checks YAGNI/ladder, no new deps, no import cycle, shortest diff, no `ponytail:` unless ceiling named, trivial helpers need no extra test.

- [ ] Step 7.1: Gate 1 review (spec compliance) — dispatch subagent

- [ ] Step 7.2: Gate 2 review (code quality) — dispatch subagent

- [ ] Step 7.3: Address blocking findings only (minimum diff)

---

### Task 8: Source commit (one commit, explicit add)

- [ ] Step 8.1: Stage exactly 4 files

```bash
git add open-sse/providers/capabilities.js open-sse/providers/thinkingLevels.js open-sse/translator/concerns/thinkingUnified.js tests/unit/opencode-ox-alpha-free.test.js
git status
```

- [ ] Step 8.2: Commit

```bash
git commit -m "feat(opencode): enable Ox Alpha image and effort"
```

Do not amend, do not push, no version bump/pack/install.

---

### Task 9: Plan self-review + plan commit

- [ ] Step 9.1: Self-review checklist

1. Spec coverage: image caps (4 pairs), suffix norm (4 Ox + 1 Claude), thinkingLevels entry, toLowHighMaxLevel mapping, image pass-through, isolation, numeric budget, unknown/auto omission, GPT max->xhigh preserved — all have tasks.
2. Placeholder scan: no `TBD`/`TODO`/`similar to`/placeholder — all steps have literal code.
3. Type/signature consistency: `getCapabilitiesForModel(provider, model)` string args, `applyThinking(targetFormat, model, body, provider)` shape, `getThinkingLevels(provider, model)` array return — consistent across tasks.
4. Exact paths/commands: vitest cmd ordering, baseline scripts, GitNexus CLI with `--repo D:\Code\9router`.

- [ ] Step 9.2: Commit plan (docs/* is ignored)

```bash
git add -f docs/superpowers/plans/2026-08-23-opencode-ox-alpha-image-and-effort.md
git commit -m "docs(opencode): plan Ox Alpha image and effort"
```

No amend/push. Worktree may be detached — report SHA/path/status/history.

---

## Execution Handoff

Main agent coordinates; fresh subagent per self-contained task. Two-stage review Gate 1 spec compliance, Gate 2 code quality. TDD: RED → expected failure recorded → implementation → GREEN → baselines → detect → commit.

