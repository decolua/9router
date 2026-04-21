# Issue 705 Design — Ensure `response.completed` includes `response.output`

## Summary

9router’s `/v1/responses` streaming path currently emits valid incremental Responses API SSE events, including `response.output_item.done`, but its terminal `response.completed` event omits `response.output`. Hermes-Agent consumes the streamed assistant text successfully, then crashes while parsing the final response object because it expects `response.output` to be present and iterable.

The approved fix is a narrowly scoped parity fix:

1. fix the live streaming transformer used by `/v1/responses`
2. fix the parallel translator implementation that mirrors the same event contract
3. add focused regression tests for both paths

## Problem Statement

### Observed behaviour

In the live streaming path:

- `response.created` contains `response.output: []`
- one or more `response.output_item.done` events are emitted with fully formed output items
- `response.completed` is emitted without `response.output`

This produces a terminal payload that is internally inconsistent with the earlier stream state.

### Affected code paths

Primary live path:

- `src/app/api/v1/responses/route.js`
- `open-sse/handlers/responsesHandler.js`
- `open-sse/transformer/responsesTransformer.js`

Parallel translator path with the same omission:

- `open-sse/translator/response/openai-responses.js`

### Why this matters

9router documents `/v1/responses` as part of its OpenAI-compatible translation surface. Clients that parse the final `response.completed.response` object strictly are entitled to expect `response.output` to exist, even if it is empty.

## Goals

- Ensure `response.completed.response.output` is always present in the streaming Responses API output.
- Preserve the output items already emitted during the stream.
- Keep event ordering and intermediate event behaviour unchanged.
- Maintain parity between the live transformer and the parallel translator implementation.
- Add regression coverage for the exact failure mode reported in issue #705.

## Non-Goals

- No broad refactor of the Responses translation architecture.
- No changes to request translation semantics.
- No changes to finish reasons, tool-call semantics, or reasoning semantics beyond what is required to construct the final `output` array correctly.
- No speculative Hermes-side workaround in this PR.

## Design

### 1. Accumulate final output items by `output_index`

Both implementations already construct completed output items when they emit `response.output_item.done`. The fix will persist those completed items in transformer state, keyed by `output_index`.

State addition in both implementations:

- add a collection for completed output items, keyed by output index
- update it whenever `response.output_item.done` is emitted for:
  - assistant messages
  - reasoning items
  - function calls

Recommended internal shape:

- `Map<number, object>` if convenient
- or a plain object keyed by numeric index if that matches the surrounding code style better

The implementation detail is flexible; deterministic ordering is not.

### 2. Construct terminal `response.output`

When `sendCompleted()` runs:

- build an ordered `output` array from the accumulated completed items
- fill indexes in ascending numeric order
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

### 3. Preserve current event ordering

The fix must not alter the established streaming order:

1. `response.created`
2. `response.in_progress`
3. per-item incremental events
4. per-item `response.output_item.done`
5. terminal `response.completed`
6. `[DONE]`

Only the content of `response.completed.response` changes, not its position in the stream.

### 4. Maintain parity across both implementations

Two implementations currently generate Responses-format completion events:

- `open-sse/transformer/responsesTransformer.js`
- `open-sse/translator/response/openai-responses.js`

Both currently omit `response.output` in their respective `sendCompleted()` helpers. The PR will update both to prevent behavioural drift between code paths that are intended to represent the same protocol contract.

## Behavioural Rules

### Rule A — message output

If assistant text was produced and finalized into a message item, the terminal `response.output` must include that message item at its corresponding `output_index`.

### Rule B — reasoning output

If reasoning output was finalized into a reasoning item, the terminal `response.output` must include that reasoning item at its corresponding `output_index`.

### Rule C — function-call output

If a tool/function call was finalized into a function-call item, the terminal `response.output` must include that item at its corresponding `output_index`.

### Rule D — empty completion

If the stream completes without any finalized output items, `response.completed.response.output` must still be present as an empty array.

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

## Risks and Mitigations

### Risk: output order drifts from emitted `output_index`

Mitigation:

- build the final array strictly in ascending numeric `output_index` order
- do not rely on object insertion order implicitly

### Risk: completed items diverge from already emitted `response.output_item.done`

Mitigation:

- persist the exact finalized item object that is emitted in `response.output_item.done`
- do not reconstruct a second copy from partial buffers during `sendCompleted()` if avoidable

### Risk: fix only one implementation path

Mitigation:

- patch both current emitters in the same PR
- add regression coverage for both to keep parity explicit

## Acceptance Criteria

The change is complete when all of the following are true:

1. `/v1/responses` streaming still emits the existing incremental events in the same order.
2. Terminal `response.completed.response.output` is always present.
3. When output items were finalized earlier in the stream, they are present in the terminal `output` array.
4. When no items were finalized, terminal `output` is `[]` rather than omitted.
5. Both the live transformer path and the parallel translator path satisfy the same contract.
6. Focused regression tests cover both code paths.

## Recommended Implementation Plan Seed

Implementation should proceed in this order:

1. update `responsesTransformer.js` state and `sendCompleted()`
2. add focused regression coverage for the transformer
3. update `openai-responses.js` state and `sendCompleted()`
4. add focused regression coverage for the translator path
5. run targeted verification plus a production build
