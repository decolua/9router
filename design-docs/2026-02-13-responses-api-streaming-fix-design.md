# Responses API Streaming Fix - Design Document

**Date**: February 13, 2026
**Status**: Approved
**Author**: Claude Sonnet 4.5

## Executive Summary

Fix 9router's `/v1/responses` endpoint to respect client streaming preferences, enabling NewsFetchAgent (pydantic_ai) to receive non-streaming JSON responses while maintaining backward compatibility with OpenClaw and other clients.

## Problem Statement

### Current Issue

NewsFetchAgent agents use pydantic_ai's `run_sync()` (non-streaming mode) but receive SSE streams from 9router, causing parsing failures:

```
AttributeError: 'str' object has no attribute 'output'
```

### Root Cause

1. **responsesHandler.js:28** forces `stream=true` for ALL clients
2. **codex.js:33** also forces `stream=true` (Codex requirement)
3. pydantic_ai expects non-streaming JSON, gets SSE stream instead

### Impact

- ❌ All 9 NewsFetchAgent agents fail (blog writer, research, etc.)
- ❌ 100% failure rate for blog generation workflow
- ✅ OpenClaw instances work (happen to expect streaming)

## Solution Architecture

### Design Principles

1. **Respect client intent**: Don't override client's `stream` parameter
2. **Backward compatible**: OpenClaw and existing clients continue working
3. **Standards compliant**: Match OpenAI/OpenClaw Responses API behavior
4. **Provider flexible**: Handle providers that require streaming (Codex)

### Component Changes

#### 1. responsesHandler.js - Remove Forced Streaming

**Current (line 24-28):**
```javascript
export async function handleResponsesCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, connectionId }) {
  const convertedBody = convertResponsesApiFormat(body);

  // Ensure stream is enabled
  convertedBody.stream = true;  // ❌ FORCES STREAMING
```

**New:**
```javascript
export async function handleResponsesCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, connectionId }) {
  const convertedBody = convertResponsesApiFormat(body);

  // Preserve client's stream preference
  // Default to false if omitted (matches OpenClaw behavior: Boolean(undefined) = false)
  const clientRequestedStreaming = convertedBody.stream === true;
  if (convertedBody.stream === undefined) {
    convertedBody.stream = false;
  }
```

#### 2. streamToJsonConverter.js - New Stream-to-JSON Converter

**Purpose**: Convert SSE stream to single JSON response when client requests non-streaming but provider (Codex) forces streaming.

**Key Functions:**
- `convertResponsesStreamToJson(stream)`: Main converter
- Accumulates SSE events (`response.output_item.done`, etc.)
- Builds final JSON: `{ id, object, created_at, status, output, usage }`

**Location**: `open-sse/transformer/streamToJsonConverter.js`

#### 3. responsesHandler.js - Conditional Response Handling

**Logic:**
```javascript
const response = result.response;
const contentType = response.headers.get("Content-Type") || "";

// Case 1: Client wants non-streaming, but got SSE (Codex forced it)
if (!clientRequestedStreaming && contentType.includes("text/event-stream")) {
  const jsonResponse = await convertResponsesStreamToJson(response.body);
  return { success: true, response: new Response(JSON.stringify(jsonResponse), {
    status: 200,
    headers: { "Content-Type": "application/json", ... }
  })};
}

// Case 2: Client wants streaming, got SSE
if (clientRequestedStreaming && contentType.includes("text/event-stream")) {
  const transformStream = createResponsesApiTransformStream(null);
  const transformedBody = response.body.pipeThrough(transformStream);
  return { success: true, response: new Response(transformedBody, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ... }
  })};
}

// Case 3: Non-SSE response, return as-is
return result;
```

## Data Flow

### NewsFetchAgent (Non-Streaming) - Fixed Flow

```
pydantic_ai: run_sync(prompt)
  ↓ POST /v1/responses { input: [...], stream: undefined }
9router responsesHandler:
  ↓ clientRequestedStreaming = false (undefined → false)
  ↓ convertedBody.stream = false
9router CodexExecutor.transformRequest():
  ↓ body.stream = true (Codex requirement)
Codex API:
  ↓ Returns: SSE stream (text/event-stream)
9router responsesHandler (NEW):
  ↓ Detects: client wanted non-streaming, got SSE
  ↓ Converts: SSE → JSON via convertResponsesStreamToJson()
  ↓ Returns: application/json
pydantic_ai:
  ✅ Receives: { id: "resp_...", output: [...], status: "completed" }
  ✅ Parses successfully!
```

### OpenClaw (Streaming) - Unchanged Flow

```
OpenClaw: fetch("/v1/responses", { body: { stream: true } })
  ↓
9router responsesHandler:
  ↓ clientRequestedStreaming = true
  ↓ convertedBody.stream = true
9router CodexExecutor:
  ↓ body.stream = true
Codex API:
  ↓ Returns: SSE stream
9router responsesHandler:
  ↓ Transforms: Chat Completions SSE → Responses API SSE
  ↓ Returns: text/event-stream
OpenClaw:
  ✅ Receives: SSE events
  ✅ Works as before!
```

## Implementation Plan

### Phase 1: Core Changes (9router)

1. **Create streamToJsonConverter.js**
   - Implement `convertResponsesStreamToJson()`
   - Handle all Responses API event types
   - Accumulate `output_item.done` events
   - Build final JSON response

2. **Update responsesHandler.js**
   - Remove forced `stream=true` (line 28)
   - Track client's original preference
   - Add conditional response handling
   - Route to converter when needed

3. **Add unit tests**
   - Test stream-to-JSON conversion
   - Test routing logic
   - Test edge cases (empty streams, errors)

### Phase 2: Testing & Deployment

1. **Local testing**
   - Test with mock SSE streams
   - Verify JSON output format
   - Test error scenarios

2. **Staging deployment**
   - Deploy to 9router staging
   - Test NewsFetchAgent blog writer job
   - Verify OpenClaw instances work

3. **Production deployment**
   - Roll out to production 9router instances
   - Monitor Sentry for errors
   - Verify NewsFetchAgent success rate

## Testing Strategy

### Unit Tests

**streamToJsonConverter.test.js:**
- ✅ Convert simple message response
- ✅ Convert response with reasoning
- ✅ Convert response with tool calls
- ✅ Handle empty stream
- ✅ Handle partial stream (connection drops)
- ✅ Handle malformed events

**responsesHandler.test.js:**
- ✅ Non-streaming client + SSE response → JSON
- ✅ Streaming client + SSE response → SSE
- ✅ Non-streaming client + JSON response → JSON
- ✅ Omitted stream parameter → defaults to false

### Integration Tests

1. **NewsFetchAgent workflow**
   - Trigger blog writer job
   - Verify research agent succeeds
   - Check blog generation completes

2. **OpenClaw compatibility**
   - Test streaming requests (existing behavior)
   - Test non-streaming requests (new behavior)
   - Verify both work correctly

### Manual Testing

1. Deploy to staging
2. Run: `curl -X POST https://api.kainotomic.com/v1/responses -H "Authorization: Bearer $TOKEN" -d '{"model":"cx/gpt-5.2","input":"test","stream":false}'`
3. Verify: Returns JSON (not SSE)
4. Trigger NewsFetchAgent job
5. Verify: Job completes successfully

## Backward Compatibility

### OpenClaw Clients

| Scenario | Before | After | Status |
|----------|--------|-------|--------|
| `stream: true` | SSE | SSE | ✅ No change |
| `stream: false` | SSE (wrong) | JSON (correct) | ✅ Fixed |
| `stream` omitted | SSE | JSON | ⚠️ Change (better default) |

### Other Clients

- ✅ Any client using `/v1/responses`: Now respects their preference
- ✅ No breaking changes for explicit streaming requests
- ✅ Non-streaming requests now work as intended

### Risk Assessment

**Low Risk:**
- OpenClaw clients explicitly set `stream: true` (no impact)
- Change only affects clients that want non-streaming
- Codex requirement handled at executor level

**Mitigation:**
- Gradual rollout (staging → production)
- Monitor Sentry for new errors
- Can revert if issues detected

## Performance Impact

### Non-Streaming Clients (NewsFetchAgent)

- **Before**: Receive SSE, fail to parse → 100% error rate
- **After**: Receive JSON, parse successfully → 0% error rate
- **Overhead**: Minimal (stream accumulation in memory)

### Streaming Clients (OpenClaw)

- **Before**: Receive SSE
- **After**: Receive SSE
- **Impact**: None (unchanged flow)

### Memory Usage

- Stream-to-JSON conversion accumulates events in memory
- Typical response: ~10-50 events, ~10KB total
- Max response: Limited by existing `maxBodyBytes` config
- **Impact**: Negligible

## Error Handling

### Scenarios

1. **Empty stream**: Return `{ output: [], status: "completed" }`
2. **Partial stream**: Return what was accumulated, `status: "failed"`
3. **Malformed events**: Skip invalid events, continue processing
4. **Conversion timeout**: Standard timeout handling (no change)
5. **Connection error**: Propagate error to client (no change)

### Logging

- Log when stream-to-JSON conversion occurs
- Log conversion duration for monitoring
- Log any parsing errors (with event data)

## Rollback Plan

If issues arise:

1. **Immediate**: Revert responsesHandler.js changes (restore forced streaming)
2. **Impact**: NewsFetchAgent fails again, but OpenClaw continues working
3. **Fix forward**: Debug conversion logic, deploy fixed version
4. **Timeline**: Can revert in < 5 minutes

## Success Metrics

### Key Performance Indicators

- ✅ NewsFetchAgent success rate: 0% → 100%
- ✅ OpenClaw success rate: 100% → 100% (maintained)
- ✅ Sentry errors: `AttributeError: 'str' object has no attribute 'output'` → 0
- ✅ Response time: No significant change

### Monitoring

- Sentry: Watch for new errors related to Responses API
- Logs: Track conversion frequency and duration
- Metrics: Track success/failure rates per client type

## Future Enhancements

1. **Caching**: Cache converted responses for repeated requests
2. **Optimization**: Stream partial JSON for long responses
3. **Configuration**: Allow per-client streaming defaults
4. **Documentation**: Update API docs with streaming behavior

## References

- [OpenClaw Responses API Source](https://github.com/openclaw/openclaw/blob/main/src/gateway/openresponses-http.ts)
- [OpenAI Responses API Documentation](https://developers.openai.com/docs/api-reference/responses)
- [pydantic_ai Streaming Documentation](https://ai.pydantic.dev/models/overview/)
- [9router Issue #2d84e61](https://github.com/apple-techie/9router/commit/2d84e61) - Codex streaming requirement

## Approval

- ✅ User approved Option A (Fix 9router)
- ✅ Design reviewed and accepted
- ⏳ Implementation plan to follow

---

**Next Steps**: Create detailed implementation plan with step-by-step file changes.
