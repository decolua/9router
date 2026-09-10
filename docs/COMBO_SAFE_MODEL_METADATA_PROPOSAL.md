# Safe logical Combo metadata proposal

Status: implemented as the conservative projection and conditional-cache gap
around [PR #2242](https://github.com/decolua/9router/pull/2242). That PR remains
the owner of physical-model capability discovery.

## Upstream overlap checked

PR #2242 adds physical-model capabilities and nested Combo aggregation. Its
current aggregation is optimistic for fallback routing:

- input modalities use union, so a Combo can advertise vision when a fallback
  member cannot accept an image;
- `maxOutput` uses maximum, so a later member can receive a request beyond its
  safe output limit;
- reasoning metadata follows the first member even though fallback can select a
  different member;
- a missing or cyclic nested Combo falls through to model-name pattern matching;
- `/v1/models` has no `ETag` or `If-None-Match` handling.

## Proposed public contract

A Combo remains one logical OpenAI model entry:

```json
{
  "id": "coding-pro",
  "object": "model",
  "owned_by": "combo",
  "contextWindow": 120000,
  "capabilities": {
    "vision": false,
    "tools": true,
    "reasoning": false
  }
}
```

The response must not expose members, a representative physical model, provider
credentials, route order, or operator policy names.

## Conservative aggregation

Resolve nested Combos to physical leaves with cycle and missing-member checks.
If resolution is incomplete, omit the aggregate metadata for that Combo rather
than guessing from its name.

- input modalities and request features: intersection across every leaf;
- `contextWindow`: minimum verified window across every leaf;
- `maxOutput`: minimum verified output limit across every leaf;
- reasoning format/range: omit until an exact-agreement projection is defined;
- unknown capability values: fail closed and omit the aggregate.

This matches fallback semantics: advertised input must remain valid whichever
member ultimately handles the request.

## Context-aware dispatch

The public minimum is the portable client contract. Runtime preflight adds a
second layer for requests that can still reach 9Router above that contract:

- estimate input tokens with the existing format-neutral estimator;
- add the largest requested output limit, or a conservative default allowance;
- add a small context-error buffer;
- preserve routing order while skipping members whose known window is smaller
  than the estimated request budget;
- keep members with unknown runtime capability metadata eligible for backward
  compatibility, but never let unknown metadata contribute to the public
  aggregate;
- return `combo_context_window_exceeded` without provider dispatch when every
  known member is undersized.

This preflight is deliberately described as an estimate, not exact tokenizer
proof. Providers use different tokenizers, so callers should still size and
compact conversations against the logical Combo's advertised minimum window.

## Validator contract

Return a strong standard `ETag` and expose it through CORS. Honor `If-None-Match`
lists, weak comparison, and `*` with an empty `304` response.

Hash a canonical public representation plus an opaque HMAC revision of private
Combo membership. Keep the HMAC key process-local (injectable in tests), and
never expose the membership input. This invalidates clients when routing order
changes even if the conservative public aggregate is unchanged, without leaking
physical member identities.

Expose small pure helpers for tests: aggregation accepts a nested-Combo lookup
and capability resolver, while validator creation accepts an explicit 32-byte
revision key. Runtime supplies a random process-local key. Tests must prove that
equivalent public ordering is byte/ETag stable, membership changes invalidate,
and neither raw membership hashes nor a small model-name dictionary reproduce
the HMAC-backed validator.

`tests/unit/combo-safe-model-metadata.contract.test.js` and
`tests/unit/combo-context-window.test.js` record the behavior and pass without
expected-failure markers.

## Merge strategy

Keep physical-model capability discovery in #2242. This change owns recursive
conservative aggregation, context-aware eligibility, public projection,
canonical response ordering, and privacy-preserving conditional ETags. It
addresses the Combo context-routing requirement in #1089.

Provider catalog freshness remains a separate source-of-truth concern. In
particular, #2760 owns Claude Opus 5 and current Claude 4.6+ catalog limits; this
change consumes capability metadata and does not duplicate that catalog work.
