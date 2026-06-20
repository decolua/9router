# OpenCode Setup Metadata Enrichment

> Bead: 9r-ocmr.e1.05 — PRD: REQ-001..005, VAL-001..005, DOC-001

## Overview

When 9router configures OpenCode as an `@ai-sdk/openai-compatible` provider,
the setup route (`POST /api/cli-tools/opencode-settings`) now writes enriched
model metadata including context limits, capability flags, and reasoning
variants.  Re-running setup preserves user-edited fields via controlled merge
(ADR-001).

## Before / After

### Before (pre-e1)

```json
{
  "name": "claude-opus-4.6",
  "modalities": { "input": ["text", "image"], "output": ["text"] }
}
```

Missing: `limit`, `reasoning`, `tool_call`, `attachment`, `variants`.
Existing user fields lost on re-run.

### After (post-e1)

```json
{
  "name": "claude-opus-4.6",
  "modalities": { "input": ["text", "image"], "output": ["text"] },
  "reasoning": true,
  "tool_call": true,
  "attachment": true,
  "limit": { "context": 1000000, "input": 1000000, "output": 128000 },
  "variants": {
    "low":    { "reasoningEffort": "low" },
    "medium": { "reasoningEffort": "medium" },
    "high":   { "reasoningEffort": "high" },
    "max":    { "reasoningEffort": "max" }
  }
}
```

## Field Meanings

| Field | Source | Description |
|---|---|---|
| `name` | Request | Model identifier as sent by the client. |
| `modalities.input` | Capability resolver | `"text"`, `"image"`, `"pdf"`, `"audio"`, `"video"` |
| `modalities.output` | Capability resolver | `"text"`, `"image"`, `"audio"` |
| `reasoning` | Capability resolver | `true` if model supports thinking/reasoning. |
| `tool_call` | Capability resolver | `true` if model supports function/tool calling (default: `true`). |
| `attachment` | Capability resolver | `true` if any non-text input modality is present. |
| `limit.context` | Capability resolver | Context window in tokens. |
| `limit.input` | Capability resolver | Input token limit (falls back to `context` when unknown). |
| `limit.output` | Capability resolver | Max output tokens. |
| `variants` | Reasoning variants | Selectable reasoning levels (only for `reasoning: true` models). |

## Merge Behavior (ADR-001)

When setup is re-run, existing user config is preserved via controlled merge:

- **Scalars** (`name`, `reasoning`, `tool_call`, `attachment`): existing wins.
- **Objects** (`limit`, `options`, `headers`, `variants`): merged, existing keys win on conflict, generated fills blanks.
- **`modalities`**: existing wins if present; otherwise generated.
- **Unknown fields**: preserved as-is.

Example: if a user manually set `limit.context: 500000`, re-running setup
keeps that value while filling in `limit.input` and `limit.output` from
the resolver.

## Reasoning Variants (ADR-003)

Models with `reasoning: true` receive four selectable variants:

| Level | `reasoningEffort` | Behavior |
|---|---|---|
| `low` | `"low"` | Minimal reasoning effort. |
| `medium` | `"medium"` | Moderate reasoning. |
| `high` | `"high"` | Heavy reasoning. |
| `max` | `"max"` | Maximum reasoning effort. |

Variants use the OpenCode/AI SDK-compatible `reasoningEffort` key.  The
runtime translator (Epic 3) maps these to provider-native formats at
request time.  No variant globally forces high/max thinking by default.

## Unknown Models

Models not found in the capability resolver receive safe defaults:

```
contextWindow: 200000
maxOutput: 64000
reasoning: false
tools: true (tool_call: true)
```

Setup does not crash for unknown models.

## Test Commands

```bash
cd tests && npx vitest run \
  unit/opencode-converter.test.js \
  unit/opencode-setup-characterization.test.js \
  --reporter=verbose
```

All 21 tests pass (6 converter + 7 merge + 5 variants + 3 route characterization).

## Files Changed (Epic 1)

| File | Change |
|---|---|
| `src/app/api/cli-tools/opencode-settings/converter.js` | New — `buildOpenCodeModelConfig`, `mergeOpenCodeModelConfig`, `buildOpenCodeReasoningVariants` |
| `src/app/api/cli-tools/opencode-settings/route.js` | Wired converter + merge into POST handler |
| `tests/unit/opencode-converter.test.js` | New — 18 tests (converter + merge + variants) |
| `tests/unit/opencode-setup-characterization.test.js` | New — 3 route-level characterization tests |
| `docs/opencode-setup-metadata.md` | This file |
