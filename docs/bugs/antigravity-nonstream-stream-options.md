# Antigravity non-streaming request rejected by `stream_options`

## Status

Fixed in source and covered by regression tests. Not deployed to production as of 2026-07-28.

## Symptom

A non-streaming request routed to Antigravity could fail upstream with HTTP 400:

```text
stream_options can only be set if stream is true
```

The issue was observed with `antigravity/gpt-oss-120b-medium`. Combo fallback kept the overall request available, but added an avoidable provider error and extra latency.

## Root cause

OpenAI-compatible clients may include:

```json
{
  "stream": false,
  "stream_options": { "include_usage": true }
}
```

`AntigravityExecutor.transformRequest()` preserved the top-level `stream_options` field while selecting Google's non-streaming `generateContent` endpoint. That upstream endpoint rejects `stream_options` when streaming is disabled.

## Fix

`AntigravityExecutor.transformRequest()` now removes top-level `stream_options` whenever the effective `stream` argument is not exactly `true`. Streaming requests retain their existing `stream_options` value.

## Regression coverage

`tests/unit/antigravity-stream-options.test.js` verifies both boundaries:

1. `stream=false` removes `stream_options`.
2. `stream=true` preserves `stream_options`.

## Verification

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/antigravity-stream-options.test.js
```

Expected result: two tests pass.

Full unit suite and application build must also pass before release.

## Deployment

No production container, database, service, or routing configuration was changed by this source fix. Production activation requires a separately approved image build, container replacement, restart, and smoke test with rollback available.
