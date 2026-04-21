# Issue 705 Design — Ensure `response.completed` includes `response.output`

## Summary

9router’s `/v1/responses` streaming path currently emits valid incremental Responses API SSE events, including `response.output_item.done`, but its terminal `response.completed` event omits `response.output`. Hermes-Agent consumes the streamed assistant text successfully, then crashes while parsing the final response object because it expects `response.output` to be present and iterable.

The approved fix remains a narrowly scoped parity fix:

1. fix the live streaming transformer used by `/v1/responses`
2. fix the parallel translator implementation that mirrors the same event contract
3. add focused regression tests for both paths
4. make dense ordering, collision policy, and verification steps explicit

## Problem Statement

### Observed behaviour

In the live streaming path:

- `response.created` contains `response.output: []`
- one or more `response.output_item.done` events are emitted with fully formed output items
- `response.completed` is emitted without `response.output`

This produces a terminal payload that is internally inconsistent with the earlier stream state.

### Affected code paths

Primary runtime call chain:

- `src/app/api/v1/responses/route.js`
- `open-sse/handlers/responsesHandler.js`
- `open-sse/transformer/responsesTransformer.js`

Parallel translator path with the same omission:

- `open-sse/translator/response/openai-responses.js`

Expected code changes in this PR are confined to the two response-producing implementations:

- `open-sse/transformer/responsesTransformer.js`
- `open-sse/translator/response/openai-responses.js`

`route.js` and `responsesHandler.js` are listed for call-chain clarity only. They should not require code changes unless implementation reveals a state-threading dependency.

### Why this matters

9router documents `/v1/responses` as part of its OpenAI-compatible translation surface. Clients that parse the final `response.completed.response` object strictly are entitled to expect `response.output` to exist, even if it is empty.

## Goals

- Ensure `response.completed.response.output` is always present in the streaming Responses API output.
- Preserve the output items already emitted during the stream.
- Keep event ordering and intermediate event behaviour unchanged.
- Maintain parity between the live transformer and the parallel translator implementation.
- Add regression coverage for the exact failure mode reported in issue #705.
- Preserve terminal `response.usage` if it is already available in the existing completion path; do not regress it while fixing `output`.

## Non-Goals

- No broad refactor of the Responses translation architecture.
- No changes to request translation semantics.
- No changes to finish reasons, tool-call semantics, or reasoning semantics beyond what is required to construct the final `output` array correctly.
- No speculative Hermes-side workaround in this PR.
- No synthetic invention of `usage` values where current code does not already expose them.

## Design

### 1. Accumulate final output items by `output_index`

Both implementations already construct completed output items when they emit `response.output_item.done`. The fix will persist those completed items in state, keyed by `output_index`.

State addition in both implementations:

- use a `Map<number, object>` for completed output items
- update it whenever `response.output_item.done` is emitted for:
  - assistant messages
  - reasoning items
  - function calls

This is a hard constraint, not an implementation preference: deterministic dense ordering is required.

### 2. Define sparse-index and collision behaviour explicitly

The implementation must not assume upstream indexes are perfectly dense.

Rules:

- collect completed items in a `Map<number, object>` keyed by `output_index`
- sort keys ascending before constructing the terminal array
- emit a dense final `output` array with no `undefined` holes
- if indexes are sparse (for example `0, 2`), collapse them into dense output order rather than filling missing positions with placeholders or holes
- if the same `output_index` is finalized more than once, last-write-wins and a warning should be logged

This is a defensive posture against malformed or retried upstream event sequences. It is not a user-visible feature.

### 3. Construct terminal `response.output`

When `sendCompleted()` runs:

- build an ordered dense `output` array from the accumulated completed items
- sort by ascending numeric `output_index`
- collapse sparse indexes into a dense array
- if no items were completed, emit `output: []`

Resulting terminal event shape:

```json
{
  "type": "response.completed",
  "response": {
    "id": "resp_...",
    "object": "response",
    "created_at": 1776628502,
    "status": "completed",
    "background": false,
    "error": null,
    "output": [ ... ]
  }
}
```

### 4. Preserve current event ordering

The fix must not alter the established streaming order:

1. `response.created`
2. `response.in_progress`
3. per-item incremental events
4. per-item `response.output_item.done`
5. terminal `response.completed`
6. `[DONE]`

Only the content of `response.completed.response` changes, not its position in the stream.

### 5. Maintain parity across both implementations

Two implementations currently generate Responses-format completion events:

- `open-sse/transformer/responsesTransformer.js`
- `open-sse/translator/response/openai-responses.js`

Both currently omit `response.output` in their respective `sendCompleted()` helpers. The PR will update both to prevent behavioural drift between code paths that are intended to represent the same protocol contract.

### 6. Error and abort path audit

Current code audit shows:

- no dedicated `response.failed` emitter exists in the two response-producing implementations targeted by this PR
- no `response.incomplete` emitter is currently present in this tree
- the reverse translator path (`openaiResponsesToOpenAIResponse`) does consume upstream `response.failed`, but that is a Responses-to-chat compatibility path rather than the response-producing path implicated in issue #705

Therefore, this PR remains focused on `response.completed` for the two response-producing emitters.

However, if implementation discovers or introduces terminal `response.failed` or `response.incomplete` emitters in either touched response-producing path, they must follow the same dense-output contract: include accumulated `response.output` when present, and `output: []` otherwise.

### 7. Secondary contract note — `usage`

Audit of the current tree shows that terminal `response.usage` is treated inconsistently:

- downstream utilities such as `open-sse/utils/usageTracking.js` already look for `chunk.response.usage` on `response.completed`
- the current response-producing transformer does not visibly populate `response.usage` on its terminal event
- the reverse translator does consume `response.completed.response.usage` when it exists

This indicates a separate contract gap adjacent to issue #705.

To keep this PR scoped:

- the required fix is `response.output`
- implementation must not regress any existing `usage` passthrough behaviour
- if terminal `usage` is already available in the touched completion path without additional architectural work, it may be carried through in the same PR
- do not synthesize or estimate usage in `sendCompleted()` as part of this fix

If `usage` remains absent after the `output` fix, that should be captured as a follow-up issue rather than silently ignored.

## Behavioural Rules

### Rule 0 — dense deterministic ordering

Terminal `response.output` must be dense, deterministic, and free of `undefined` holes.

- items are ordered by ascending numeric `output_index`
- sparse upstream indexes are collapsed into dense array order
- duplicate indexes resolve by last-write-wins, with a warning log

### Rule A — message output

If assistant text was produced and finalized into a message item, the terminal `response.output` must include that message item.

### Rule B — reasoning output

If reasoning output was finalized into a reasoning item, the terminal `response.output` must include that reasoning item.

### Rule C — function-call output

If a tool/function call was finalized into a function-call item, the terminal `response.output` must include that item.

### Rule D — empty completion

If the stream completes without any finalized output items, `response.completed.response.output` must still be present as an empty array.

### Rule E — no divergence from emitted final items

The terminal `output` array must reuse the exact finalized item objects already emitted in `response.output_item.done`, rather than reconstructing new copies from partial buffers during completion if avoidable.

## Testing Plan

Add focused regression coverage that validates protocol shape rather than broad integration behaviour.

### Test 1 — transformer includes final message output

Target:

- `open-sse/transformer/responsesTransformer.js`

Method:

- feed a minimal chat-completions SSE stream containing assistant text and a final `finish_reason`
- assert that:
  - `response.output_item.done` is emitted for the assistant message
  - terminal `response.completed.response.output` exists
  - the final `output` array contains the completed assistant message item

### Test 2 — transformer emits empty output array when no items finalize

Target:

- `open-sse/transformer/responsesTransformer.js`

Method:

- feed a minimal stream that reaches completion without finalized output items
- assert terminal `response.completed.response.output` is exactly `[]`

### Test 3 — translator path includes final output

Target:

- `open-sse/translator/response/openai-responses.js`

Method:

- drive the translator with minimal chunks that produce a finalized assistant message
- assert the returned `response.completed` event includes `response.output` with the finalized item

### Test 4 — translator path also emits empty array safely

Target:

- `open-sse/translator/response/openai-responses.js`

Method:

- drive flush/completion without finalized items
- assert `response.completed.response.output` exists and equals `[]`

### Test 5 — multi-item accumulation preserves ordering

Targets:

- both response-producing implementations

Method:

- create a scenario with at least two finalized output items, preferably reasoning at one index and assistant message at another
- assert terminal `response.output` contains both items in deterministic ascending index order
- assert the final array is dense and has no holes

### Test 6 — function-call output is preserved

Targets:

- both response-producing implementations, if test setup remains straightforward

Method:

- produce a finalized function/tool call item
- assert terminal `response.output` includes that finalized function-call item

### Test 7 — duplicate or sparse indexes are handled defensively

Targets:

- at least one response-producing implementation

Method:

- simulate sparse indexes or duplicate finalization for the same index
- assert the final array contains no holes
- assert collisions resolve deterministically via last-write-wins

## Risks and Mitigations

### Risk: output order drifts from emitted `output_index`

Mitigation:

- build the final array by sorting numeric keys ascending
- promote dense deterministic ordering to an explicit behavioural rule

### Risk: sparse indexes create `undefined` holes that break clients

Mitigation:

- collapse sparse keys into a dense final array
- never emit holes or placeholder `undefined` entries

### Risk: completed items diverge from already emitted `response.output_item.done`

Mitigation:

- persist the exact finalized item object that is emitted in `response.output_item.done`
- do not reconstruct a second copy from partial buffers during `sendCompleted()` if avoidable

### Risk: fix only one implementation path

Mitigation:

- patch both current emitters in the same PR
- add regression coverage for both to keep parity explicit

### Risk: adjacent `usage` omission is mistaken for resolved behaviour

Mitigation:

- state explicitly that `usage` is audited but not fully redesigned in this PR
- preserve passthrough if already available
- open a follow-up issue if terminal `usage` remains absent after implementation

## Verification Plan

Verification should be explicit and repeatable.

### Targeted unit verification

Create a focused test file under:

- `tests/unit/responses-output-contract.test.js`

Run it with:

```bash
cd tests
NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run --reporter=verbose --config ./vitest.config.js tests/unit/responses-output-contract.test.js
```

### Build verification

From the repo root:

```bash
npm run build
```

### Optional protocol smoke verification

If the local environment is available for a manual smoke test, run a minimal transformer or local `/v1/responses` streaming check and confirm that the terminal `response.completed` payload now includes `response.output` and no client-side iteration error occurs.

A Hermes-Agent end-to-end smoke test is desirable if the local operator environment is convenient, but it is not required for the repository-level PR to be valid.

## Rollback Strategy

This change touches two isolated response-producing helpers. If it causes a client compatibility regression:

- revert the fix commit(s) cleanly
- restore the previous terminal event shape
- reopen investigation with captured failing payloads from the affected client

No feature flag is planned because the intended fix is small, local, and reversible at commit granularity.

## Acceptance Criteria

The change is complete when all of the following are true:

1. `/v1/responses` streaming still emits the existing incremental events in the same order.
2. Terminal `response.completed.response.output` is always present.
3. When output items were finalized earlier in the stream, they are present in the terminal `output` array.
4. Terminal `response.output` is dense, ordered deterministically, and free of holes.
5. Duplicate or sparse indexes are handled defensively according to the documented policy.
6. When no items were finalized, terminal `output` is `[]` rather than omitted.
7. Both the live transformer path and the parallel translator path satisfy the same contract.
8. Focused regression tests cover both code paths, including multi-item ordering.
9. Production build verification still passes.

## Recommended Implementation Plan Seed

Implementation should proceed in this order:

1. update `responsesTransformer.js` state and `sendCompleted()` with dense ordering and collision handling
2. add focused regression coverage for the transformer
3. update `openai-responses.js` state and `sendCompleted()` with the same policy
4. add focused regression coverage for the translator path
5. run the targeted Vitest file under `tests/unit/responses-output-contract.test.js`
6. run `npm run build`
7. if convenient, perform a manual local stream smoke check before opening the PR
