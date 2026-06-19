# Plan 005: Fix stale `open-sse/AGENTS.md` after engine refactor

> **Executor instructions**: Follow step by step. STOP on mismatch.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: NONE (doc-only)
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `1271db0`, 2026-06-19 (target file is clean at HEAD)

## Why this matters

`open-sse/AGENTS.md` describes the model fallback engine as "one fallback model... One hop only — no chaining, no recursion." The engine was refactored to support ordered chains of multiple fallbacks with strategies (ordered/random/roundrobin), per-fallback deterministic-error stops, and all-fail-returns-last behavior. Future contributors will misunderstand the engine's capabilities and constraints based on the stale doc.

## Current state

`open-sse/AGENTS.md` — stale passages:

**Line 1-5** (file-level JSDoc):
```
Per-model fallback: a primary model string may name one fallback model.
On a fallback-eligible failure of the primary, the whole request is retried
once against the fallback. One hop only — no chaining, no recursion.
```

**Line 16** (services list):
```
`modelFallback.js` (per-model primary→fallback hop)
```

**Line 35** (pitfalls):
```
Per-model fallback (`runWithModelFallback` in `services/modelFallback.js`) wraps
ONLY the direct single-model dispatch at each handler's entry ... The wrapper
skips the hop on 2xx (streaming-safe) and on deterministic payload errors ...
One hop only — no chaining.
```

The actual engine (`open-sse/services/modelFallback.js`) now:
- Reads `entry.fallbacks` (array) or legacy `entry.fallback` (single)
- Supports `strategy` field: `"ordered"` (default), `"random"` (Fisher-Yates), `"roundrobin"` (cursor rotation)
- Tries each fallback in order until one succeeds (2xx)
- Stops the chain on deterministic payload errors from any fallback
- Returns the last fallback's response when all fail (not the stale primary error)

## Scope

**In scope**:
- `open-sse/AGENTS.md`

**Out of scope**:
- `tests/translator/AGENTS.md` — separate doc, not stale.
- `docs/ARCHITECTURE.md` — separate, if it mentions fallback it should be updated separately.

## Steps

### Step 1: Update lines 1-5 (file-level description)

Replace with:
```
Per-model fallback: a primary model string may have an ordered list of fallback
models with a selection strategy (ordered / random / round-robin). On a
fallback-eligible failure of the primary, the request is retried against each
fallback in resolved order until one succeeds. The chain stops early on
deterministic payload errors (context-length / too-many-tokens).
```

### Step 2: Update line 16 (services list)

Replace `(per-model primary→fallback hop)` with:
```
(per-model primary→ordered fallback chain, strategy-aware)
```

### Step 3: Update line 35 (pitfalls paragraph)

Replace the full paragraph with:
```
Per-model fallback (`runWithModelFallback` in `services/modelFallback.js`) wraps
ONLY the direct single-model dispatch at each handler's entry (`handleChat`,
`handleFetch`, `handleSearch`, `handleImageGeneration`, `handleTts`, `handleStt`,
`handleEmbeddings`). Combos call the handler's `handleSingleModel*` directly and
bypass per-model fallback by design — combos already have their own fallback
semantics. The wrapper skips the chain on 2xx (streaming-safe) and stops on
deterministic payload errors (`isDeterministicPayloadError`: context-length /
too-many-tokens) from any fallback in the chain. Strategy: "ordered" (try in
configured order), "random" (shuffle per resolve), "roundrobin" (rotate starting
index). When all fallbacks fail, the LAST fallback's response is returned (not
the stale primary error). Combos bypass this entirely.
```

**Verify**: Read the full file. No "One hop only" or "no chaining" language remains.

## Done criteria

- [ ] No occurrence of "one hop" or "no chaining" in `open-sse/AGENTS.md`
- [ ] `ordered`, `random`, `roundrobin` strategies are mentioned
- [ ] `isDeterministicPayloadError` behavior per-fallback is documented
- [ ] "last fallback's response" all-fail behavior is documented
- [ ] No other files modified

## STOP conditions

- The line numbers don't match (the file was edited since the plan was written). Search by content, not line number.

## Maintenance notes

- Update this doc again if the engine gains a new strategy or changes its all-fail return policy.
