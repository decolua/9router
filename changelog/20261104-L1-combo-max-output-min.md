# Combo `maxOutput` aggregates to min instead of max

## Problem

`aggregateComboCapabilities` published `maxOutput` as `Math.max` across a combo's
members while computing `contextWindow` as `Math.min`. `/v1/models` publishes the
output ceiling from a *different* aggregator (`comboSeatLimits`,
`src/app/api/v1/models/route.js`), which uses min. The same response therefore
contradicted itself:

```json
{
  "id": "General_Opencode",
  "capabilities":     { "contextWindow": 128000, "maxOutput": 384000 },
  "context_length":   128000,
  "max_completion_tokens": 32000
}
```

The dashboard combo card renders `capabilities` (`src/app/(dashboard)/dashboard/combos/page.js`),
so it showed `ctx 128k · max 384k` for a combo whose weakest member (`Cheap`,
`oc/big-pickle`) caps output at 32000.

A combo routes each request to a single member (round-robin / fallback), so the
output ceiling it can honour is the weakest member's. Advertising the maximum let
clients request more output than the selected member supports — the dashboard and
any API consumer reading `capabilities.maxOutput` were both misled.

## Change

`open-sse/providers/capabilities.js`

- `maxOutput` aggregation: `Math.max` → `Math.min`, matching `contextWindow` and
  `comboSeatLimits`. Docblock updated: conservative = min for both.

Tests updated to encode the conservative rule:

- `tests/unit/combo-capabilities.test.js` — "maxOutput is the minimum across all
  models" (131072 rather than 262144).
- `tests/unit/combo-caps-resolver.test.js` — fed-member assertion plus a new case
  proving a larger member limit does not raise the aggregate.

## Impact

- Dashboard combo badges now show the deliverable ceiling (`General_Opencode` →
  `max 32k`, not `384k`).
- `/v1/models` `capabilities.maxOutput` now agrees with its `max_completion_tokens`.
- Client-visible behaviour change: consumers that used `capabilities.maxOutput` as
  an upper bound will see a smaller number. That number is the one the router can
  actually serve.

## Testing

```bash
cd tests && npx vitest run --config vitest.config.js \
  unit/combo-capabilities.test.js unit/combo-caps-resolver.test.js \
  unit/v1-models-combo-context.test.js unit/capabilities.test.js \
  unit/capabilities-service-kind.test.js unit/capabilities-opus-context.test.js \
  unit/capabilities-sonnet-5-5.test.js unit/use-model-caps-alias-fallback.test.js
# 8 files, 85 tests passed
```

Live verification after deploy: `GET /v1/models?q=General_Opencode` must report the
same number in `capabilities.maxOutput` and `max_completion_tokens`.
