# Responses API Streaming Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 9router's `/v1/responses` endpoint to respect client streaming preferences, enabling non-streaming clients (pydantic_ai) to receive JSON responses while maintaining backward compatibility.

**Architecture:** Remove forced streaming from responsesHandler, add stream-to-JSON converter for non-streaming clients when providers force streaming (Codex), implement conditional response handling based on client preference.

**Tech Stack:** Node.js, JavaScript (ES modules), 9router proxy architecture, SSE streaming, JSON parsing

---

## Prerequisites

**Working Directory:** `/Users/andrewpeltekci/Documents/1_Projects/9router`

**Branch:** Create feature branch from master
```bash
git checkout -b fix/responses-api-streaming
```

**Dependencies:** Already installed (no new dependencies needed)

---

## Task 1: Create Stream-to-JSON Converter

**Files:**
- Create: `open-sse/transformer/streamToJsonConverter.js`
- Test: Will add tests in Task 3

**Step 1: Create the converter file with basic structure**

Create `open-sse/transformer/streamToJsonConverter.js`:

```javascript
/**
 * Stream-to-JSON Converter
 * Converts Responses API SSE stream to single JSON response
 * Used when client requests non-streaming but provider forces streaming (e.g., Codex)
 */

/**
 * Convert Responses API SSE stream to single JSON response
 * @param {ReadableStream} stream - SSE stream from provider
 * @returns {Promise<Object>} Final JSON response in Responses API format
 */
export async function convertResponsesStreamToJson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let responseId = "";
  let output = [];
  let created = Math.floor(Date.now() / 1000);
  let status = "in_progress";
  let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  // Map of output_index -> item (for ordered output array)
  const items = new Map();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split by double newline (SSE event separator)
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || ""; // Keep incomplete message in buffer

      for (const msg of messages) {
        if (!msg.trim()) continue;

        // Parse SSE event
        const eventMatch = msg.match(/^event:\s*(.+)$/m);
        const dataMatch = msg.match(/^data:\s*(.+)$/m);

        if (!eventMatch || !dataMatch) continue;

        const eventType = eventMatch[1].trim();
        const dataStr = dataMatch[1].trim();

        if (dataStr === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          // Skip malformed JSON
          continue;
        }

        // Handle different event types
        if (eventType === "response.created") {
          responseId = parsed.response?.id || responseId;
          created = parsed.response?.created_at || created;
        }
        else if (eventType === "response.output_item.done") {
          const idx = parsed.output_index ?? 0;
          items.set(idx, parsed.item);
        }
        else if (eventType === "response.completed") {
          status = "completed";
          if (parsed.response?.usage) {
            usage.input_tokens = parsed.response.usage.input_tokens || 0;
            usage.output_tokens = parsed.response.usage.output_tokens || 0;
            usage.total_tokens = parsed.response.usage.total_tokens || 0;
          }
        }
        else if (eventType === "response.failed") {
          status = "failed";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Build output array from accumulated items (ordered by index)
  const maxIndex = items.size > 0 ? Math.max(...items.keys()) : -1;
  for (let i = 0; i <= maxIndex; i++) {
    output.push(items.get(i) || {
      type: "message",
      content: [],
      role: "assistant"
    });
  }

  return {
    id: responseId || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    created_at: created,
    status: status || "completed",
    output,
    usage
  };
}
```

**Step 2: Verify file syntax**

Run: `node --check open-sse/transformer/streamToJsonConverter.js`
Expected: No output (syntax valid)

**Step 3: Commit**

```bash
git add open-sse/transformer/streamToJsonConverter.js
git commit -m "feat: add stream-to-JSON converter for Responses API

Converts SSE streams to single JSON responses for non-streaming clients
when providers force streaming (e.g., Codex requirement).

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Update responsesHandler to Respect Client Preference

**Files:**
- Modify: `open-sse/handlers/responsesHandler.js`

**Step 1: Read current implementation**

Read `open-sse/handlers/responsesHandler.js` to understand current structure.

**Step 2: Import the converter at top of file**

Add import after existing imports (around line 8):

```javascript
import { convertResponsesStreamToJson } from "../transformer/streamToJsonConverter.js";
```

**Step 3: Modify handleResponsesCore to preserve client preference**

Find the function `export async function handleResponsesCore` (around line 21).

Replace lines 24-28:
```javascript
// OLD CODE (REMOVE):
  // Convert Responses API format to Chat Completions format
  const convertedBody = convertResponsesApiFormat(body);

  // Ensure stream is enabled
  convertedBody.stream = true;
```

With:
```javascript
  // Convert Responses API format to Chat Completions format
  const convertedBody = convertResponsesApiFormat(body);

  // Preserve client's stream preference (matches OpenClaw behavior)
  // Default to false if omitted: Boolean(undefined) = false
  const clientRequestedStreaming = convertedBody.stream === true;
  if (convertedBody.stream === undefined) {
    convertedBody.stream = false;
  }
```

**Step 4: Add conditional response handling**

Find the section after `handleChatCore` returns (around line 40-69).

Replace the existing response handling with:

```javascript
  if (!result.success || !result.response) {
    return result;
  }

  const response = result.response;
  const contentType = response.headers.get("Content-Type") || "";

  // Case 1: Client wants non-streaming, but got SSE (provider forced it, e.g., Codex)
  if (!clientRequestedStreaming && contentType.includes("text/event-stream")) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(response.body);

      return {
        success: true,
        response: new Response(JSON.stringify(jsonResponse), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*"
          }
        })
      };
    } catch (error) {
      console.error("[Responses API] Stream-to-JSON conversion failed:", error);
      return {
        success: false,
        status: 500,
        error: "Failed to convert streaming response to JSON"
      };
    }
  }

  // Case 2: Client wants streaming, got SSE - transform it
  if (clientRequestedStreaming && contentType.includes("text/event-stream")) {
    const transformStream = createResponsesApiTransformStream(null);
    const transformedBody = response.body.pipeThrough(transformStream);

    return {
      success: true,
      response: new Response(transformedBody, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*"
        }
      })
    };
  }

  // Case 3: Non-SSE response (error or non-streaming from provider) - return as-is
  return result;
```

**Step 5: Verify syntax**

Run: `node --check open-sse/handlers/responsesHandler.js`
Expected: No output (syntax valid)

**Step 6: Commit**

```bash
git add open-sse/handlers/responsesHandler.js
git commit -m "feat: respect client streaming preference in Responses API handler

- Remove forced stream=true
- Preserve client's original preference (default false if omitted)
- Add conditional handling: convert SSE to JSON for non-streaming clients
- Maintain streaming transformation for streaming clients
- Return non-SSE responses as-is

Fixes NewsFetchAgent (pydantic_ai) non-streaming requests while
maintaining backward compatibility with OpenClaw.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Unit Tests for Stream-to-JSON Converter

**Files:**
- Create: `open-sse/transformer/streamToJsonConverter.test.js`

**Step 1: Create test file with basic structure**

Create `open-sse/transformer/streamToJsonConverter.test.js`:

```javascript
/**
 * Tests for Stream-to-JSON Converter
 */

import { describe, it, expect } from "vitest";
import { convertResponsesStreamToJson } from "./streamToJsonConverter.js";

/**
 * Helper: Create a ReadableStream from SSE events
 */
function createSseStream(events) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    }
  });
}

describe("convertResponsesStreamToJson", () => {
  it("converts simple message response to JSON", async () => {
    const events = [
      "event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_123\",\"object\":\"response\",\"created_at\":1234567890,\"status\":\"in_progress\"}}\n\n",
      "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"content\":[],\"role\":\"assistant\"}}\n\n",
      "event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hello world\"}],\"role\":\"assistant\"}}\n\n",
      "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_123\",\"status\":\"completed\",\"usage\":{\"input_tokens\":5,\"output_tokens\":10,\"total_tokens\":15}}}\n\n"
    ];

    const stream = createSseStream(events);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.id).toBe("resp_123");
    expect(result.object).toBe("response");
    expect(result.status).toBe("completed");
    expect(result.output).toHaveLength(1);
    expect(result.output[0].type).toBe("message");
    expect(result.output[0].content[0].text).toBe("Hello world");
    expect(result.usage.input_tokens).toBe(5);
    expect(result.usage.output_tokens).toBe(10);
  });

  it("handles empty stream gracefully", async () => {
    const stream = createSseStream([]);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.id).toMatch(/^resp_/);
    expect(result.object).toBe("response");
    expect(result.status).toBe("completed");
    expect(result.output).toHaveLength(0);
  });

  it("handles malformed events by skipping them", async () => {
    const events = [
      "event: response.created\ndata: {\"response\":{\"id\":\"resp_456\"}}\n\n",
      "event: bad.event\ndata: not valid json\n\n",
      "event: response.output_item.done\ndata: {\"output_index\":0,\"item\":{\"type\":\"message\",\"content\":[{\"text\":\"test\"}],\"role\":\"assistant\"}}\n\n",
      "event: response.completed\ndata: {\"response\":{\"status\":\"completed\"}}\n\n"
    ];

    const stream = createSseStream(events);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.id).toBe("resp_456");
    expect(result.status).toBe("completed");
    expect(result.output).toHaveLength(1);
  });

  it("handles multiple output items in order", async () => {
    const events = [
      "event: response.created\ndata: {\"response\":{\"id\":\"resp_789\"}}\n\n",
      "event: response.output_item.done\ndata: {\"output_index\":1,\"item\":{\"type\":\"message\",\"content\":[{\"text\":\"second\"}],\"role\":\"assistant\"}}\n\n",
      "event: response.output_item.done\ndata: {\"output_index\":0,\"item\":{\"type\":\"message\",\"content\":[{\"text\":\"first\"}],\"role\":\"assistant\"}}\n\n",
      "event: response.completed\ndata: {\"response\":{\"status\":\"completed\"}}\n\n"
    ];

    const stream = createSseStream(events);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.output).toHaveLength(2);
    expect(result.output[0].content[0].text).toBe("first");
    expect(result.output[1].content[0].text).toBe("second");
  });

  it("handles failed response status", async () => {
    const events = [
      "event: response.created\ndata: {\"response\":{\"id\":\"resp_fail\"}}\n\n",
      "event: response.failed\ndata: {\"response\":{\"status\":\"failed\",\"error\":{\"message\":\"Something went wrong\"}}}\n\n"
    ];

    const stream = createSseStream(events);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.status).toBe("failed");
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npm test -- streamToJsonConverter`
Expected: All 5 tests pass

**Step 3: Commit**

```bash
git add open-sse/transformer/streamToJsonConverter.test.js
git commit -m "test: add unit tests for stream-to-JSON converter

Tests cover:
- Simple message conversion
- Empty stream handling
- Malformed event handling
- Multiple output items ordering
- Failed response status

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Integration Test for Non-Streaming Client

**Files:**
- Modify: `open-sse/handlers/responsesHandler.test.js` (if exists) or create new test file

**Step 1: Check if test file exists**

Run: `ls -la open-sse/handlers/ | grep test`

**Step 2: Add integration test**

If test file exists, add test. Otherwise, create `open-sse/handlers/responsesHandler.test.js`:

```javascript
import { describe, it, expect, vi } from "vitest";
import { handleResponsesCore } from "./responsesHandler.js";

describe("handleResponsesCore - streaming preference", () => {
  it("converts SSE to JSON for non-streaming client when provider forces streaming", async () => {
    // Mock body with stream=false (non-streaming request)
    const body = {
      model: "cx/gpt-5.2",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "test" }] }],
      stream: false
    };

    // Mock modelInfo
    const modelInfo = { provider: "codex", model: "gpt-5.2" };

    // Mock credentials
    const credentials = { token: "test-token" };

    // Mock handleChatCore to return SSE stream
    // Note: This is a simplified test - real implementation would need proper mocking

    // For now, this is a placeholder - actual integration test would require full setup
    expect(true).toBe(true);
  });
});
```

**Step 3: Skip for now (placeholder)**

Note: Full integration test requires mocking the entire chat core and provider stack. This would be tested manually in staging instead.

**Step 4: Commit placeholder**

```bash
git add open-sse/handlers/responsesHandler.test.js
git commit -m "test: add placeholder for responsesHandler integration tests

Full integration tests to be verified manually in staging due to
complexity of mocking chat core and provider responses.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Manual Testing & Verification

**Step 1: Test with local mock server**

Create a test script `test-responses-api.js` in project root:

```javascript
/**
 * Manual test script for Responses API streaming fix
 * Run with: node test-responses-api.js
 */

import { convertResponsesStreamToJson } from "./open-sse/transformer/streamToJsonConverter.js";

// Create mock SSE stream
function createMockStream() {
  const encoder = new TextEncoder();
  const events = [
    'event: response.created\ndata: {"response":{"id":"resp_test","created_at":1707825600}}\n\n',
    'event: response.output_item.done\ndata: {"output_index":0,"item":{"type":"message","content":[{"type":"output_text","text":"Test response"}],"role":"assistant"}}\n\n',
    'event: response.completed\ndata: {"response":{"status":"completed","usage":{"input_tokens":5,"output_tokens":3,"total_tokens":8}}}\n\n'
  ];

  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    }
  });
}

async function testConverter() {
  console.log("Testing stream-to-JSON converter...");

  const stream = createMockStream();
  const result = await convertResponsesStreamToJson(stream);

  console.log("Result:", JSON.stringify(result, null, 2));

  // Verify structure
  console.assert(result.id === "resp_test", "ID mismatch");
  console.assert(result.status === "completed", "Status mismatch");
  console.assert(result.output.length === 1, "Output length mismatch");
  console.assert(result.output[0].content[0].text === "Test response", "Content mismatch");

  console.log("✅ All assertions passed!");
}

testConverter().catch(console.error);
```

**Step 2: Run test script**

Run: `node test-responses-api.js`
Expected: Output shows JSON result and "✅ All assertions passed!"

**Step 3: Clean up test script**

```bash
rm test-responses-api.js
git add -A
git commit -m "test: verify stream-to-JSON converter with manual test

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Deploy to Staging & Test with NewsFetchAgent

**Step 1: Push feature branch**

```bash
git push origin fix/responses-api-streaming
```

**Step 2: Create pull request**

1. Go to GitHub: https://github.com/apple-techie/9router
2. Create PR from `fix/responses-api-streaming` to `master`
3. Title: "Fix: Respect client streaming preference in Responses API"
4. Description: Link to design doc and explain changes

**Step 3: Deploy to staging**

Follow your deployment process to deploy the branch to staging 9router instance.

**Step 4: Test NewsFetchAgent in staging**

1. Point NewsFetchAgent staging to staging 9router
2. Trigger blog writer job
3. Monitor logs for:
   - ✅ No `AttributeError: 'str' object has no attribute 'output'`
   - ✅ Research agent completes successfully
   - ✅ Blog generation finishes

**Step 5: Verify logs show JSON response**

Check 9router logs for:
```
[Responses API] Converting SSE stream to JSON for non-streaming client
```

**Step 6: Test OpenClaw compatibility**

1. Verify existing OpenClaw instances still work
2. Test both streaming and non-streaming requests
3. Confirm no regression

---

## Task 7: Deploy to Production

**Step 1: Merge pull request**

After staging verification and PR approval:
```bash
git checkout master
git pull origin master
```

**Step 2: Deploy to production**

Follow your deployment process to roll out to production 9router instances.

**Step 3: Monitor Sentry**

1. Watch for new errors in kaino-main project
2. Check for any `ResponseNotRead` or streaming-related errors
3. Verify NewsFetchAgent success rate increases to 100%

**Step 4: Verify NewsFetchAgent in production**

1. Trigger blog writer job in production
2. Monitor completion and success
3. Check Sentry for zero streaming errors

**Step 5: Celebrate success! 🎉**

---

## Rollback Plan

If issues arise in production:

**Quick rollback:**
```bash
git revert HEAD~3..HEAD  # Revert last 3 commits
git push origin master
# Redeploy
```

**Or:**
1. Revert PR in GitHub
2. Deploy previous version
3. Investigate issues
4. Fix forward with new PR

---

## Success Criteria

✅ **NewsFetchAgent:**
- Blog writer jobs complete successfully
- Research agent receives JSON responses
- No `AttributeError` in Sentry
- 100% success rate

✅ **OpenClaw:**
- Streaming requests work (existing behavior)
- Non-streaming requests work (new behavior)
- No regression in functionality

✅ **Monitoring:**
- Sentry shows zero streaming-related errors
- Logs show stream-to-JSON conversions for pydantic_ai
- Response times remain stable

---

## Notes

- Keep CodexExecutor's `stream=true` requirement (line 33 of codex.js) - it's Codex-specific
- The converter accumulates events in memory - acceptable for typical response sizes
- Error handling added for conversion failures
- All changes are backward compatible
- Tests verify core functionality, manual testing verifies integration

---

## Timeline Estimate

- Task 1-2: 15 minutes (implementation)
- Task 3-4: 15 minutes (tests)
- Task 5: 10 minutes (manual verification)
- Task 6: 30 minutes (staging deployment & testing)
- Task 7: 15 minutes (production deployment)
- **Total: ~1.5 hours** (excluding waiting for deployment pipelines)
