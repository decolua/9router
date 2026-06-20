# Runtime Reasoning Request Shapes and Forwarding

> Bead: 9r-ocmr.e3.05 — PRD: REQ-010..015, VAL-010..016

## Overview

9router normalizes reasoning/thinking parameters from multiple client formats into provider-native formats. The normalizer lives in `open-sse/translator/concerns/thinkingUnified.js`.

## Accepted Request Shapes

### OpenAI (snake_case)

```json
{ "reasoning_effort": "high" }
{ "reasoning": { "effort": "medium" } }
```

### OpenAI / AI SDK (camelCase)

```json
{ "reasoningEffort": "high" }
```

### Claude

```json
{ "thinking": { "type": "enabled", "budget_tokens": 8192 } }
{ "thinking": { "type": "disabled" } }
{ "output_config": { "effort": "high" } }
```

### Gemini

```json
{ "thinkingConfig": { "thinkingBudget": 8192 } }
{ "thinkingConfig": { "thinkingLevel": "high" } }
```

### Qwen

```json
{ "enable_thinking": true, "thinking_budget": 8192 }
{ "enable_thinking": false }
```

## Model-Name Suffix Override

Append a suffix to the model name to override thinking intent:

| Syntax | Effect |
|--------|--------|
| `gpt-5(high)` | Level override → high |
| `gpt-5(8192)` | Budget override → 8192 tokens |
| `gpt-5(auto)` | Auto mode |
| `gpt-5(none)` | No thinking |

## Provider Output Mapping

| Provider | Input | Output |
|----------|-------|--------|
| OpenAI | `reasoningEffort: "high"` | `reasoning_effort: "high"` |
| OpenAI | `reasoningEffort: "xhigh"` | `reasoning_effort: "high"` (clamped) |
| Claude (adaptive) | `reasoningEffort: "high"` | `output_config.effort: "high"` |
| Claude (budget) | `reasoningEffort: "high"` | `thinking.type: "enabled", budget_tokens: 24576` |
| Gemini (level) | `reasoningEffort: "medium"` | `thinkingConfig.thinkingLevel: "medium"` |
| Gemini (budget) | `reasoningEffort: "high"` | `thinkingConfig.thinkingBudget: 24576` |
| Qwen | `reasoningEffort: "medium"` | `enable_thinking: true, thinking_budget: 8192` |
| DeepSeek | `reasoningEffort: "high"` | `thinking.type: "enabled", reasoning_effort: "high"` |
| Kimi | `reasoningEffort: "high"` | `reasoning_effort: "high"` |
| MiniMax | `reasoningEffort: "high"` | `thinking.type: "adaptive"` |

## Precedence Rules

1. **Model-name suffix** (highest) — `gpt-5(high)`
2. **Provider-native shape** — Claude `thinking`, Gemini `thinkingConfig`
3. **OpenAI camelCase** — `reasoningEffort`
4. **OpenAI snake_case** — `reasoning_effort`
5. **No thinking intent** → no change

## Budget Clamping

Budgets are clamped to respect model metadata:

- **thinkingRange.min/max** — explicit bounds from model capabilities
- **maxOutput reserve** — budget cannot exceed 80% of `maxOutput` (leaves room for response)

Example: a model with `maxOutput: 16000` clamps `budget_tokens: 20000` to `12800`.

## Non-Disableable Thinking

Models with `thinkingCanDisable: false` in their capabilities cannot fully disable thinking. When "none"/"off" is requested, the normalizer clamps to "minimal" effort instead.

Known non-disableable models: MiniMax M2.x.

## Non-Reasoning Models

Models with `reasoning: false` in their capabilities have **all** thinking fields stripped from the request body, regardless of input. This prevents sending unsupported parameters to providers.

## Limitations

- Not every provider supports every option
- Some providers have limited level mappings (e.g., DeepSeek only has low→high, xhigh→max)
- Budget values are approximate; providers may round to their own granularity
- Gemini-3 cannot fully disable thinking (maps "none" to "minimal")

## Cross-References

- Setup metadata: [opencode-setup-metadata.md](./opencode-setup-metadata.md)
- Capability resolver: `open-sse/providers/capabilities.js`
- Thinking normalizer: `open-sse/translator/concerns/thinkingUnified.js`
- Level-to-budget maps: `open-sse/translator/concerns/thinking.js`
