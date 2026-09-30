# GPT-5.6 Codex Reasoning Overrides Design

## Goal

Expose and preserve the reasoning levels currently advertised by the OpenAI
Codex model catalog for GPT-5.6 Sol, Terra, and Luna when they are routed
through the `codex` provider (`cx/`).

The supported override matrix is:

| Model family | Max | Ultra |
| --- | --- | --- |
| GPT-5.6 Sol | Yes | Yes |
| GPT-5.6 Terra | Yes | Yes |
| GPT-5.6 Luna | Yes | No |

The same matrix applies to 9router's virtual `-review` variants because they
resolve to the corresponding upstream base model.

## Scope

This change is limited to OpenAI Codex (`cx/`) routes. Kiro (`kr/`) and other
OpenAI-format providers retain their existing reasoning-level behavior even
when they expose models with the same GPT-5.6 names.

The change covers the complete local request path:

1. The provider page advertises only the levels supported by each Codex model.
2. A copied model suffix such as `gpt-5.6-sol(ultra)` is parsed as a reasoning
   override.
3. The shared thinking translator preserves a supported Codex override while
   retaining the existing `xhigh` fallback for unsupported OpenAI levels.
4. The Codex executor sends supported `max` and `ultra` values unchanged to the
   upstream Codex Responses endpoint.

## Current Behavior

`gpt-5.6-luna` and the other GPT-5.6 models already exist in the Codex model
registry. The capability picker has a global Sol-only `max` pattern, which also
affects providers such as Kiro unintentionally. The shared OpenAI translator
and Codex executor then convert `max` to `xhigh`, so the advertised override is
not preserved end to end. `ultra` is not recognized as a model suffix.

## Design

### Provider-scoped level resolution

Extend the existing model-pattern overrides in
`open-sse/providers/thinkingLevels.js` with an optional provider constraint.
Add three Codex-only GPT-5.6 patterns in most-specific order:

- Sol: existing levels plus `max` and `ultra`.
- Terra: existing levels plus `max` and `ultra`.
- Luna: existing levels plus `max`.

Matching remains wildcard-based so virtual `-review` variants inherit the
base model's levels. Provider matching prevents these overrides from changing
Kiro or other providers.

### Shared translation

Teach the suffix parser to recognize `ultra` as a discrete level without
assigning it a synthetic token budget. When applying the OpenAI wire format,
reuse the resolved per-provider model levels:

- Preserve `max` or `ultra` when the target provider/model explicitly supports
  the requested level.
- Convert `ultra` to `max` for GPT-5.6 Luna, preserving the highest level Luna
  supports.
- Convert other unsupported `max` or `ultra` requests to `xhigh`, preserving
  the existing safe fallback for generic OpenAI-compatible providers.
- Leave all existing lower levels and `none` handling unchanged.

This keeps one capability source for the dashboard and translation behavior
instead of duplicating the GPT-5.6 matrix.

### Codex executor

Make Codex reasoning normalization model-aware. After virtual review models
are resolved to their upstream base model, preserve a requested level when
the Codex capability resolver lists it. Continue converting unsupported
`max` or `ultra` values to `xhigh`, except that Luna converts `ultra` to its
supported `max` level.

Do not add `max` to the executor's legacy hyphen-suffix parser because
`gpt-5.1-codex-max` is an actual model identifier. Dashboard overrides use the
existing parenthesized suffix and the shared translator removes that suffix
before executor dispatch.

## Error and Compatibility Behavior

- `cx/gpt-5.6-luna(ultra)` becomes `max` rather than sending an unsupported
  level upstream.
- Non-GPT-5.6 Codex models retain their current supported levels and fallback
  behavior.
- Kiro GPT-5.6 routes no longer inherit the Codex Sol-only picker override and
  continue using Kiro's existing effort normalization.
- Direct request fields and parenthesized model overrides follow the same
  model-aware rules.

## Testing

Use test-driven development with focused unit coverage:

1. Level resolver tests for Sol, Terra, Luna, their review variants, an older
   Codex model, and Kiro isolation.
2. Shared translator tests proving `max` and `ultra` survive only for supported
   Codex model/provider combinations, Luna `ultra` becomes `max`, and other
   unsupported combinations become `xhigh`.
3. Codex executor tests proving native and translated request shapes preserve
   supported values after upstream model resolution.
4. Existing thinking translation and Codex executor suites to guard generic
   OpenAI clamping and fast-tier behavior.
5. Project lint/build checks in proportion to the changed JavaScript modules.

## Non-goals

- Runtime fetching or caching of the Codex model catalog.
- Adding these levels to Kiro or another provider.
- Changing model pricing, quotas, defaults, or service tiers.
- Adding Codex Ultra's multi-agent orchestration behavior inside 9router;
  9router only forwards the catalog-advertised reasoning override.
