# Custom model token limits

Refs: [#3854](https://github.com/decolua/9router/issues/3854), [#1294](https://github.com/decolua/9router/issues/1294), [PR #1347](https://github.com/decolua/9router/pull/1347), [#3032](https://github.com/decolua/9router/issues/3032), [#3750](https://github.com/decolua/9router/issues/3750), [#3812](https://github.com/decolua/9router/issues/3812).

## Goal

Carry provider-reported or manually entered context-window and maximum-output token limits through custom-model discovery, storage, dashboard metadata, `/v1/models`, and `/v1/models/info`.

## Design

- Normalize common upstream names into `caps.contextWindow` and `caps.maxOutput`. Keep missing values absent. Reject supplied values unless they are positive safe integers.
- Save limits with the existing custom-model `caps` object. Re-adding a model updates supplied metadata and retains omitted metadata.
- Add optional context-window and max-output fields to the LLM custom-model modal. Suggested-model and account-catalog imports pass through limits returned by upstream.
- Resolve custom metadata by provider plus model ID. A custom model's explicit values override static/name fallback values, including when its ID matches a built-in model. Never borrow custom limits from another provider with the same model ID.
- Preserve static fallback limits for built-in and live catalog models. Do not publish fallback token limits as known metadata for a custom model whose limits were not supplied.
- Expose known limits consistently as dashboard `caps.contextWindow` / `caps.maxOutput` and OpenAI-style top-level fields on `/v1/models` and `/v1/models/info`.

## Verification

Add focused tests for normalization and validation, persistence updates, provider isolation, custom-over-static precedence, unknown omission, discovery import metadata, list metadata, and info metadata. Run those tests and a bounded production build.
