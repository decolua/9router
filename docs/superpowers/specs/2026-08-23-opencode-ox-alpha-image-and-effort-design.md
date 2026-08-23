# OpenCode — Ox Alpha Image and Effort Design

Date: 2026-08-23
Branch: `local/opencode-go-all-endpoints-v2`

## Goal

Two atomic fixes under one spec (user-approved):

- **(image)** Enable image (vision) input for `ocg/ox-alpha-free` (`ox-alpha-free` on `opencode-go`) so the existing modality guard stops stripping `image_url` blocks.
- **(effort)** Fix `reasoning_effort` clamping for the Ox Alpha always-thinking model exposed under two provider aliases and two IDs: `oc/x-preview-f-free` (`opencode/x-preview-f-free`) and `ocg/ox-alpha-free` (`opencode-go/ox-alpha-free`). Today `x-preview-f-free(max)` pure-probes/final egress produce `reasoning_effort:xhigh` because the generic `FORMAT_LEVELS.openai` has no `max`; the official `models.dev` entry for both IDs lists `reasoning_options: [low, high, max]` with always-thinking. Any generic upstream change would break other OpenAI models (`max→xhigh` is intentional there).
- **(suffix)** Make capability lookup suffix-proof: `getCapabilitiesForModel(provider, "model(xxx)")` must resolve identically to `getCapabilitiesForModel(provider, "model")`. This requires editing `getCapabilitiesForModel` (user-approved despite CRITICAL blast radius); `stripUnsupportedModalities` stays untouched.

## Root Cause

- `open-sse/providers/capabilities.js` — no `opencode-go` entry, and a global `MODEL_CAPABILITIES["x-preview-f-free"]` entry with `thinkingFormat: "openai"`. Result: `ox-alpha-free` on Go has no capability at all, and `x-preview-f-free` routes through `openai` (levels without `max`).
- **Second root cause (suffix):** the resolver matches raw model strings. `getCapabilitiesForModel("opencode", "x-preview-f-free(max)")` falls past provider exact → canonical exact → pattern and lands on `DEFAULT_CAPABILITIES`. `chatCore.js` resolves caps with the still-suffixed model (`const caps = getCapabilitiesForModel(provider, model)` at line ~153) before translation, so a suffixed request strips images even for a vision-capable model; the same failure hits `ocg/…(max)` once image caps land.
- `open-sse/providers/thinkingLevels.js` — `FORMAT_LEVELS.openai = ["none","minimal","low","medium","high","xhigh"]` (no `max`). `getThinkingLevels("opencode", "x-preview-f-free")` therefore returns the base OpenAI set without `max`, and `normalizeOpenAILevel("max", …)` clamps to `xhigh`. `opencode-go/ox-alpha-free` never reaches this path at all before the image fix; even after, it would inherit the same clamp without a format change.
- `open-sse/translator/concerns/thinkingUnified.js:applyFormat("openai", …)` → `normalizeOpenAILevel` → clamp `max`→`xhigh`. `OpenCodeExecutor` never rewrites `reasoning_effort` afterwards.

## Design

Four runtime files are edited: `open-sse/providers/capabilities.js`, `open-sse/providers/thinkingLevels.js`, `open-sse/translator/concerns/thinkingUnified.js`, and (within the first file's scope) the `getCapabilitiesForModel` resolver itself. No other runtime files change.

### 1. Shared capability object + suffix normalization (`open-sse/providers/capabilities.js`)

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

#### Suffix normalization inside `getCapabilitiesForModel`

At the top of the function, immediately after the `if (!model)` guard, define a `normalized` string by stripping any trailing `(anything)` (same `(value)` convention used by `getModelSupportedFormats` in `open-sse/config/providerModels.js` and by `stripThinkingSuffix/parseSuffix` in `thinkingUnified.js`) and trimming — one local pure regex line, no import of `thinkingUnified` (which itself imports `capabilities` → cycle). Example contract:

```js
const normalized = model.replace(/\([^()]+\)\s*$/, "").trim();
```

All subsequent lookups then use `normalized` instead of the raw `model`: the two `PROVIDER_CAPABILITIES` tests, the two `MODEL_CAPABILITIES` tests, and both arms of each `matchPattern(pattern, …)` in the `PATTERN_CAPABILITIES` loop (so suffix variations of a suffixed-capability model, and of any existing generic pattern family, map to the same behavior). `getCapabilitiesForModel(provider, base)` and `getCapabilitiesForModel(provider, base + "(max)")` (and any `"(xxx)"` suffix) must `deepEqual`. Original `model` may be retained alongside `normalized` if the caller still needs it, but every branch used for return values reads `normalized`.

Do NOT import `stripThinkingSuffix` or `parseSuffix` from `thinkingUnified` — direct `capabilities → thinkingUnified → capabilities` edge would introduce a circular dependency. Use the single regex line (the file has no other helpers that strip suffices today).

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

Suggested shape (implementation detail is one `case` plus one 10-line helper; keep the smallest diff):

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

Video wording (corrected): `caps.videoInput === false`. Raw video blocks are **not** supported end-to-end and may be filtered downstream by the OpenAI request normalizer; do **not** claim that `stripUnsupportedModalities` inserts a placeholder for video — it has no `videoInput` placeholder branch today.

## Error and Compatibility Behavior

- Images use the standard OpenAI `image_url` block; 9router does not re-encode or convert them. Upstream rejections surface through the existing executor error path; the capability flag only gates local stripping. If upstream rejects an image despite `vision:true`, that is an upstream response.
- Audio/PDF remain stripped with existing placeholder text; raw video blocks are not supported end-to-end and may be filtered by the OpenAI request normalizer instead (spec does not claim a `stripUnsupportedModalities` video placeholder). Non-Ox-Alpha providers/models are unaffected (the override matches only the four exact `provider+id` pairs).
- Always-thinking clamping: `none→low` for this format, which is the specified "clamp to minimal instead of disable." Generic OpenAI's `none` and disable logic is untouched; GPT `max→xhigh` and other providers' `auto` handling remain.

## Testing

Extend only `tests/unit/opencode-ox-alpha-free.test.js` if sufficient (smallest diff); suffix-equality cases may alternatively live in the existing `unit/capabilities.test.js`:

1. Caps — `getCapabilitiesForModel("opencode", "x-preview-f-free")`, `("oc", …)`, `("opencode-go", "ox-alpha-free")`, `("ocg", …)` each resolve `vision:true, reasoning:true, thinkingFormat:"openai-low-high-max", thinkingCanDisable:false, contextWindow:1000000, maxOutput:131072`. Also isolate: bare `x-preview-f-free`/`ox-alpha-free` without provider, and under `nvidia`/other provider, do not pick up these values (pattern/default floor, `vision:false`).
2. **Suffix equivalence** — for each of the four Ox pairs AND at least one existing generic family (e.g. `getCapabilitiesForModel(null, "claude-sonnet-4.6(max)")` deepEquals `getCapabilitiesForModel(null, "claude-sonnet-4.6")`): `expect(caps(provider, base)).toEqual(caps(provider, base + "(max)"))`.
3. Levels — `getThinkingLevels` for each of the four provider/id pairs equals `["low","high","max"]`; bare/other provider returns `null` or default without those exact levels.
4. Unified — `translateRequest` or `applyThinking` for the Ox Alpha format:
   - `max→max`, `xhigh→max`, `ultra→max`, `medium→high`, `high→high`, `low→low`, `none→low`, `auto` writes no `reasoning_effort`, numeric budget maps via the same rule, unknown omits. All assert body `reasoning_effort` directly after apply; regression: generic `openai` provider/model's `max→xhigh` still holds.
5. Image pass-through on Go — OpenAI body with `image_url` survives `stripUnsupportedModalities` for suffixed `ocg/ox-alpha-free(max)` caps resolved via the normalizer path (image block intact); `videoInput` stays false in caps. `tests/unit/opencode-go-models.test.js` already covers registry endpoint mapping and `providerModels` supportedFormats; do not duplicate here.

Resolver edit is CRITICAL (61 dependents), so nearby capability/combo/API suites are mandatory alongside the targeted files above (`unit/capabilities.test.js`, `unit/combo-autoswitch.test.js`, plus the `/v1/models` route tests that read capabilities).

Verification before any source commit (doc-only branch skips live runs):

- Targeted Vitest (exact files, run from `tests/`): `unit/opencode-ox-alpha-free.test.js`, `translator/thinking-unified.test.js`, `unit/thinking-effort-openai-max-clamp.test.js`, `unit/capabilities.test.js`, `unit/combo-autoswitch.test.js`. Full suite is not expected all-green on checkout (~938 pass, ~64 known red; see `tests/__baseline__/known-fails.txt`).
- Baseline verifiers (exact scripts in `tests/__baseline__/`): `verify-no-regression.mjs`, `verify-providers.mjs`, `verify-alias.mjs`, `verify-oauth-urls.mjs`.
- GitNexus change detection via CLI before any source commit:

  ```
  cmd.exe /d /s /c "gitnexus detect-changes --scope compare --base-ref master --repo D:\Code\9router"
  ```

  (`--repo` takes the absolute path because the registry has multiple same-named worktree entries.) Blast radius warnings (GitNexus): `getCapabilitiesForModel` **edited**, CRITICAL 61 — resolver normalization touches all fallback-chain lookups; `stripUnsupportedModalities` untouched (HIGH 5). `applyThinking` CRITICAL 9 and `getThinkingLevels` CRITICAL 13 only gain an additional match on the new format string; existing generic `openai` behavior is otherwise untouched.

## Non-goals

- No registry/executor/dashboard edits.
- No video enablement (deferred until the common video transport is end-to-end).
- No live upstream credential call, version bump, `npm pack`, or install steps.
- No change to `stripUnsupportedModalities` (caller is now passed normalized caps instead) or to generic `openai` mapping (`max→xhigh` preserved).
