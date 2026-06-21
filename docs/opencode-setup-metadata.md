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

## Metadata Overrides (Epic 2)

Users can override per-model metadata via the dashboard or API.  Overrides
are stored in the `modelOverrides` KV scope in SQLite and take precedence
over hardcoded capabilities.

### Precedence chain (highest priority wins)

1. **Manual override** — user-set via dashboard or `PUT /api/models/overrides`
2. **Hardcoded capabilities** — source-of-truth in `open-sse/providers/capabilities.js`

### Affected consumers

- **`/v1/models`** — each model entry now includes a `metadata` field with
  resolved capabilities (contextWindow, maxOutput, reasoning, tools, vision,
  etc.).  Manual overrides are reflected.
- **`POST /api/cli-tools/opencode-settings`** — setup route uses the resolver
  to produce enriched model configs.  Re-running setup picks up overrides.
- **`resolveModelMetadata(provider, model)`** — the central resolver function.
  All consumers should use this for consistent precedence.

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/models/overrides?provider=<alias>` | List all overrides for a provider |
| `PUT` | `/api/models/overrides` | Set/update an override (body: `{ provider, model, override }`) |
| `DELETE` | `/api/models/overrides?provider=<alias>&model=<id>` | Delete override (reverts to defaults) |

### Valid override fields

| Field | Type | Description |
|-------|------|-------------|
| `contextWindow` | `integer ≥ 0` | Total token context window |
| `maxOutput` | `integer ≥ 0` | Max completion tokens |
| `reasoning` | `boolean` | Model supports reasoning/chain-of-thought |
| `tools` | `boolean` | Model supports tool/function calling |
| `vision` | `boolean` | Model accepts image input |
| `pdf` | `boolean` | Model accepts PDF input |
| `audioInput` | `boolean` | Model accepts audio input |
| `videoInput` | `boolean` | Model accepts video input |
| `imageOutput` | `boolean` | Model can generate images |
| `audioOutput` | `boolean` | Model can generate audio |
| `search` | `boolean` | Model supports web search |
| `thinkingFormat` | `string \| null` | Thinking format (e.g., "x-internal") |
| `thinkingCanDisable` | `boolean` | User can disable thinking |
| `thinkingRange` | `{ min?, max? } \| null` | Thinking token bounds |

### Reset to defaults

Deleting an override via `DELETE /api/models/overrides` or clicking
"Reset to Default" in the dashboard reverts the model to its hardcoded
capabilities.

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
  unit/model-metadata-resolver.test.js \
  unit/v1-models-metadata.test.js \
  unit/e2e-metadata-override-flow.test.js \
  --reporter=verbose
```

All 41 tests pass (6 converter + 7 merge + 5 variants + 3 route characterization + 10 resolver + 5 API metadata + 5 e2e override flow).

## Files Changed (Epic 1 + Epic 2)

| File | Change |
|---|---|
| `src/app/api/cli-tools/opencode-settings/converter.js` | New — `buildOpenCodeModelConfig`, `mergeOpenCodeModelConfig`, `buildOpenCodeReasoningVariants` |
| `src/app/api/cli-tools/opencode-settings/route.js` | Wired converter + merge into POST handler |
| `src/lib/db/repos/modelOverridesRepo.js` | New — KV-based CRUD for model metadata overrides |
| `src/sse/services/modelMetadataResolver.js` | New — resolver with override > hardcoded precedence |
| `src/app/api/models/overrides/route.js` | New — API route for GET/PUT/DELETE overrides |
| `src/app/api/v1/models/route.js` | Added `metadata` field to each model entry |
| `src/app/(dashboard)/dashboard/providers/[id]/ModelMetadataEditor.js` | New — dashboard UI for editing overrides |
| `src/app/(dashboard)/dashboard/providers/[id]/page.js` | Integrated `ModelMetadataEditor` |
| `src/shared/utils/modelOverridesApi.js` | New — fetch helpers for override API |
| `tests/unit/opencode-converter.test.js` | 18 tests (converter + merge + variants) |
| `tests/unit/opencode-setup-characterization.test.js` | 3 route-level characterization tests |
| `tests/unit/model-metadata-resolver.test.js` | 10 resolver tests |
| `tests/unit/v1-models-metadata.test.js` | 5 API metadata tests |
| `tests/unit/e2e-metadata-override-flow.test.js` | 5 e2e override flow tests |
| `docs/opencode-setup-metadata.md` | This file |
