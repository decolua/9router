# OpenCode — Ox Alpha Image and Effort Design

Date: 2026-08-23
Branch: `local/opencode-go-all-endpoints-v2`

## Goal

Two atomic fixes under one spec (user-approved):

- **(image)** Enable image (vision) input for `ocg/ox-alpha-free` (`ox-alpha-free` on `opencode-go`) so the existing modality guard stops stripping `image_url` blocks.
- **(effort)** Fix `reasoning_effort` clamping for the Ox Alpha always-thinking model exposed under two provider aliases and two IDs: `oc/x-preview-f-free` (`opencode/x-preview-f-free`) and `ocg/ox-alpha-free` (`opencode-go/ox-alpha-free`). Today `x-preview-f-free(max)` pure-probes/final egress produce `reasoning_effort:xhigh` because the generic `FORMAT_LEVELS.openai` has no `max`; the official `models.dev` entry for both IDs lists `reasoning_options: [low, high, max]` with always-thinking. Any generic upstream change would break other OpenAI models (`max→xhigh` is intentional there). Do not edit `getCapabilitiesForModel` or `stripUnsupportedModalities`.

## Root Cause

- `open-sse/providers/capabilities.js` — no `opencode-go` entry, and a global `MODEL_CAPABILITIES["x-preview-f-free"]` entry with `thinkingFormat: "openai"`. Result: `ox-alpha-free` on Go has no capability at all, and `x-preview-f-free` routes through `openai` (levels without `max`).
- `open-sse/providers/thinkingLevels.js` — `FORMAT_LEVELS.openai = ["none","minimal","low","medium","high","xhigh"]` (no `max`). `getThinkingLevels("opencode", "x-preview-f-free")` therefore returns the base OpenAI set without `max`, and `normalizeOpenAILevel("max", …)` clamps to `xhigh`. `opencode-go/ox-alpha-free` never reaches this path at all before the image fix; even after, it would inherit the same clamp without a format change.
- `open-sse/translator/concerns/thinkingUnified.js:applyFormat("openai", …)` → `normalizeOpenAILevel` → clamp `max`→`xhigh`. `OpenCodeExecutor` never rewrites `reasoning_effort` afterwards.

## Design

All three files are edited; no other runtime files change.

### 1. Shared capability object (`open-sse/providers/capabilities.js`)

Introduce one constant (placed with other exact-capability constants):

```js
const OX_ALPHA_CAPABILITIES = {
  vision: true,
  reasoning: true,
  thinkingFormat: "openai-low-high-max",
  thinkingCanDisable: false, // always-thinking (models.dev: always-thinking)
  contextWindow: 1000000,
  maxOutput: 131072,
};
```

- Delete the old global `MODEL_CAPABILITIES["x-preview-f-free"]` entry (the `vision:true` / `thinkingFormat:"openai"` exact-id override).
- Under `PROVIDER_CAPABILITIES`, add four provider-scoped aliases that all reference the same object:

  ```js
  "opencode":   { "x-preview-f-free": OX_ALPHA_CAPABILITIES },
  "oc":         { "x-preview-f-free": OX_ALPHA_CAPABILITIES },
  "opencode-go":{ "ox-alpha-free":    OX_ALPHA_CAPABILITIES },
  "ocg":        { "ox-alpha-free":    OX_ALPHA_CAPABILITIES },
  ```

  Both the full provider IDs (`opencode`/`opencode-go`) and the routed aliases (`oc`/`ocg`) are required: runtime/API request handling sees the full provider id (e.g. `getCapabilitiesForModel("opencode", "x-preview-f-free")` and `("opencode-go", "ox-alpha-free")`), while combo's `reorderByCapabilities` reads the raw `oc:`/`ocg:` prefix and therefore calls `getCapabilitiesForModel("oc", "x-preview-f-free")` or `("ocg", "ox-alpha-free")`. Define under the four keys so every path resolves the same caps.

- All other modality flags omitted from the object (`videoInput`, `audioInput`, `pdf`, `imageOutput`, `audioOutput`, `search`) inherit `DEFAULT_CAPABILITIES:false` via the provider merge path. Video is explicitly out of scope.
- Non-Ox-Alpha providers keep their existing resolution: a bare `ox-alpha-free` or `x-preview-f-free` without one of the four prefixes, or under any other provider (e.g. `opencode` with the Go id vice-versa), falls through to pattern/default and observes `vision:false`.

No edit to `getCapabilitiesForModel` (CRITICAL, 61 dependents) or `stripUnsupportedModalities` (HIGH, 5 dependents). Both are consumed unchanged by the existing code path.

### 2. New thinking level set (`open-sse/providers/thinkingLevels.js`)

- Add one isolated format entry: `FORMAT_LEVELS["openai-low-high-max"] = ["low","high","max"]`. Exact `models.dev` enumeration. No change to `L.openai`, any other `L.*` set, or `FORMAT_LEVELS.openai`.
- No new entries in `PATTERN_THINKING`. All matching flows through `caps.thinkingFormat` alone.

After this, `getThinkingLevels("opencode", "x-preview-f-free")`, `getThinkingLevels("oc", "x-preview-f-free")`, `getThinkingLevels("opencode-go", "ox-alpha-free")`, and `getThinkingLevels("ocg", "ox-alpha-free")` all return `["low","high","max"]`.

### 3. Isolated format branch (`open-sse/translator/concerns/thinkingUnified.js`)

Add a small isolated helper/case for the new format only (do not touch the generic `openai` path):

```
Mapping for "openai-low-high-max" (approved):
  none|minimal|low   → low
  medium|high        → high
  xhigh|max|ultra    → max
  auto               → omit reasoning_effort (upstream default applies)
  numeric budget     → reuse existing toLevel(budget) then map through the
                       same level rule (e.g. capped "none" after
                       thinkingCanDisable turns into minimal→low)
  unknown level      → omit (same as generic: stripAll already ran, emit nothing)
```

Notes that drive the mapping:

- Upstream is always-thinking (`thinkingCanDisable:false`), so `applyFormat`'s existing pre-switch clamp `none && !canDisable → { mode:"level", level:"minimal" }` fires first for a `none` intent, which then flows as `minimal→low` in this format branch.
- Existing generic `openai` logic (`normalizeOpenAILevel`, `toLevel`, budget handling) is not altered; GPT's `max→xhigh` remains. Existing `getThinkingLevels`/`applyThinking` callers (CRITICAL dependents: `getThinkingLevels` 13, `applyThinking` 9) only acquire an additional match on the new format string.
- Budget handling for this format delegates to the same numeric→level ladder used elsewhere (via the existing `toLevel` for a budget config), then reuses the level→`low`/`high`/`max` collapse above.
- `auto` stays "emit nothing after stripAll" (same semantics as `tokenrouter`'s `auto` path: omit the field so the upstream default applies). No `reasoning_effort` field is written for `auto` or `unknown`.

Suggested shape (implementation detall is one `case` plus one 10-line helper; keep the smallest diff):

```js
case "openai-low-high-max": {
  const eff = resolveForNewFormat(...); // uses existing canDisable clamp
  const level = eff.mode === "auto" ? null : mapOxAlphaLevel(eff);
  if (level) body.reasoning_effort = level; // auto/unknown: omit
  break;
}
```

### Image behavior

Once `open-sse/providers/capabilities.js` is applied, `getCapabilitiesForModel(..., "ox-alpha-free")` on Go returns `vision:true`, so `stripUnsupportedModalities(body, sourceFormat, caps)` short-circuit no longer strips `image_url` blocks for an OpenAI/Go Chat Completions request. Images ride the existing OpenAI `image_url` (base64 `data:image/...` or remote `https`) path unchanged. `videoInput`/`audioInput`/`pdf`/`imageOutput`/`audioOutput` stay `false`; video is explicitly out of scope (upstream publishes `text/image/video` on `models.dev`, this release intentionally enables only image because the common video transport is not end-to-end yet).

## Error and Compatibility Behavior

- Images use the standard OpenAI `image_url` block; 9router does not re-encode or convert them. Upstream rejections surface through the existing executor error path; the capability flag only gates local stripping. If upstream rejects an image despite `vision:true`, that is an upstream response.
- Audio/PDF/video remain stripped with existing placeholder text for inputs the model cannot read. Non-Ox-Alpha providers/models are unaffected (the override matches only the four exact `provider+id` pairs).
- Always-thinking clamping: `none→low` for this format, which is the specified "clamp to minimal instead of disable." Generic OpenAI's `none` and disable logic is untouched; GPT `max→xhigh` and other providers' `auto` handling remain.

## Testing

Extend only `tests/unit/opencode-ox-alpha-free.test.js` if sufficient (smallest diff):

1. Caps — `getCapabilitiesForModel("opencode", "x-preview-f-free")`, `("oc", …)`, `("opencode-go", "ox-alpha-free")`, `("ocg", …)` each resolve `vision:true, reasoning:true, thinkingFormat:"openai-low-high-max", thinkingCanDisable:false, contextWindow:1000000, maxOutput:131072`. Also isolate: bare `x-preview-f-free`/`ox-alpha-free` without provider, and under `nvidia`/other provider, do not pick up these values (pattern/default floor, `vision:false`).
2. Levels — `getThinkingLevels` for each of the four provider/id pairs equals `["low","high","max"]`; bare/other provider returns `null` or default without those exact levels.
3. Unified — `translateRequest` or `applyThinking` for the Ox Alpha format:
   - `max→max`, `xhigh→max`, `ultra→max`, `medium→high`, `high→high`, `low→low`, `none→low`, `auto` writes no `reasoning_effort`, numeric budget maps via the same rule, unknown omits. All assert body `reasoning_effort` directly after apply; regression: generic `openai` provider/model's `max→xhigh` still holds.
4. Image pass-through on Go — OpenAI body with `image_url` survives `stripUnsupportedModalities` for `ocg/ox-alpha-free` caps (image block intact); `videoInput` stays false in caps. `tests/unit/opencode-go-models.test.js` already covers registry endpoint mapping and `providerModels` supportedFormats; do not duplicate here.

Verification before any source commit (doc-only branch skips live runs):

- Targeted Vitest: `unit/opencode-ox-alpha-free.test.js`, `unit/thinking-unified.test.js` (or `thinkingLevels`), `unit/openai-max-clamp` equivalent, `unit/capabilities.test.js`, `unit/reorderByCapabilities`/`unit/combos.autoswitch` suites, plus immediate neighbors. Full suite is not expected all-green on checkout (~938 pass, ~64 known red; see `tests/__baseline__/known-fails.txt`).
- Baseline verifiers: `tests/__baseline__/verify-no-regression.mjs` and `verify-providers-baseline.mjs` where applicable.
- GitNexus `detect_changes({scope:"compare", base_ref:"master"})` before any source commit. Blast radius warnings (GitNexus): `getCapabilitiesForModel` CRITICAL 61, `applyThinking` CRITICAL 9, `getThinkingLevels` CRITICAL 13, `stripUnsupportedModalities` HIGH 5. Only the new format string is added; existing generic `openai` behavior is untouched.

## Non-goals

- No registry/executor/dashboard edits.
- No video enablement (deferred until the common video transport is end-to-end).
- No live upstream credential call, version bump, `npm pack`, or install steps.
- No change to `getCapabilitiesForModel`, `stripUnsupportedModalities`, or to generic `openai` mapping (`max→xhigh` preserved).
