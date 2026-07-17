# Combo pre-action streaming fallback proposal

Status: proposal only. Production changes are intentionally deferred because
active pull requests overlap the same control point.

## Upstream overlap checked

- [#1395](https://github.com/decolua/9router/pull/1395) inspects successful
  tool-heavy SSE responses through `Response.clone()`. It has no first-action
  deadline or byte bound, and the tee can buffer one branch while the inspector
  consumes the other.
- [#576](https://github.com/decolua/9router/pull/576) adds account-level TTFT
  timeout handling. It does not define the Combo commit point or exact prefix
  replay contract.
- [#2646](https://github.com/decolua/9router/pull/2646) adds a per-model Combo
  timeout around the model call. Its `Promise.race` does not own the returned
  response stream or its reader.
- [#1996](https://github.com/decolua/9router/issues/1996) reports HTTP 200 SSE
  error payloads. Provider-name regexes are not a generic stream contract.

## Proposed contract

For a successful LLM response in a fallback Combo, 9Router should own exactly
one reader until it sees the first client-visible action:

1. Acquire one upstream reader without `Response.clone()`/tee, then buffer a
   bounded prefix while parsing complete WHATWG SSE frames.
2. Treat visible text, refusal, function/custom-tool input, or another typed
   output item as the commit point.
3. On EOF, a first-action deadline, a byte cap, or an upstream read error before
   that point, cancel the reader and try the next member.
4. At the commit point, return a backpressure-aware stream that replays every
   buffered byte exactly once and then continues from the same reader.
5. Forward downstream cancellation after commit to that same reader.
6. Never fall back after committed bytes have been released; later errors belong
   to the selected stream.
7. Leave non-LLM response types untouched.

The contract is provider-neutral. It does not encode provider names, Combo
names, deployment endpoints, or route-attribution policy.

## Suggested integration seam

Keep pre-action inspection as a small service beside `open-sse/services/combo.js`
and inject it into `handleComboChat`. This lets active timeout work converge on
one cancellation owner instead of layering `clone()` and `Promise.race` around
the same stream.

`tests/unit/combo-preaction-streaming.contract.test.js` records the desired
behavior, including pre-action read errors and text/refusal/function/custom-tool
commit fixtures. The `it.fails` cases are executable evidence of gaps on current
`upstream/master`; remove `.fails` only as each production behavior lands.

## Merge strategy

Coordinate with #1395, #576, and #2646 before implementation. Prefer one focused
stream-ownership PR, or have those authors reuse the shared pre-action helper.
Do not merge parallel readers or independent timers at different layers.
