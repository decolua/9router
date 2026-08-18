import { describe, it, expect, vi } from "vitest";
import { handleStreamingResponse } from "open-sse/handlers/chatCore/streamingHandler.js";

describe("Streaming first-valid-event gate (Issue 2951 Finding 3)", () => {
  const baseParams = {
    provider: "nvidia",
    model: "meta/llama-3.1-70b-instruct",
    sourceFormat: "openai",
    targetFormat: "openai",
    userAgent: "test-agent",
    body: { stream: true },
    translatedBody: {},
    finalBody: {},
    requestStartTime: Date.now(),
    connectionId: "conn-nv-1",
    apiKey: "nv-key",
    clientRawRequest: null,
    reqLogger: { logTargetRequest: () => {}, logError: () => {} },
    toolNameMap: null,
    customToolNames: null,
    streamController: {
      signal: new AbortController().signal,
      isConnected: () => true,
      handleComplete: vi.fn(),
      handleError: vi.fn(),
      handleDisconnect: vi.fn(),
      abort: vi.fn(),
    },
    onStreamComplete: vi.fn(),
    streamDetailId: "detail-test",
    pxpipe: null,
    reqTag: "REQ_TEST",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), errorLine: vi.fn(), line: vi.fn() },
  };

  it("Case 1: Empty stream (0 bytes) returns success=false and does NOT call onRequestSuccess", async () => {
    const onRequestSuccess = vi.fn();
    const mockProviderResponse = {
      status: 200,
      headers: new Map([["content-type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    };
    mockProviderResponse.headers.get = (k) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null);

    const res = await handleStreamingResponse({
      ...baseParams,
      providerResponse: mockProviderResponse,
      onRequestSuccess,
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe(502);
    expect(res.error).toMatch(/empty stream/i);
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("Case 2: JSON error disguised in 200 stream returns success=false and does NOT call onRequestSuccess", async () => {
    const onRequestSuccess = vi.fn();
    const errorJson = JSON.stringify({ error: { message: "Model overloaded", status: 503 } });
    const mockProviderResponse = {
      status: 200,
      headers: new Map([["content-type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(errorJson));
          controller.close();
        },
      }),
    };
    mockProviderResponse.headers.get = (k) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null);

    const res = await handleStreamingResponse({
      ...baseParams,
      providerResponse: mockProviderResponse,
      onRequestSuccess,
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe(503);
    expect(res.error).toMatch(/Model overloaded/i);
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("Case 3: Non-SSE HTML response returns success=false and does NOT call onRequestSuccess", async () => {
    const onRequestSuccess = vi.fn();
    const mockProviderResponse = {
      status: 500,
      headers: new Map([["content-type", "text/html"]]),
      text: async () => "<html><head><title>Internal Cloudflare Error</title></head><body>500</body></html>",
    };
    mockProviderResponse.headers.get = (k) => (k.toLowerCase() === "content-type" ? "text/html" : null);

    const res = await handleStreamingResponse({
      ...baseParams,
      providerResponse: mockProviderResponse,
      onRequestSuccess,
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe(500);
    expect(res.error).toMatch(/Internal Cloudflare Error/i);
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("Case 4: Valid stream with data returns success=true and calls onRequestSuccess", async () => {
    const onRequestSuccess = vi.fn();
    const sseChunk = 'data: {"id":"1","choices":[{"delta":{"content":"Hi"}}]}\n\n';
    const sseDone = "data: [DONE]\n\n";

    const mockProviderResponse = {
      status: 200,
      headers: new Map([["content-type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseChunk));
          controller.enqueue(new TextEncoder().encode(sseDone));
          controller.close();
        },
      }),
    };
    mockProviderResponse.headers.get = (k) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null);

    const res = await handleStreamingResponse({
      ...baseParams,
      providerResponse: mockProviderResponse,
      onRequestSuccess,
    });

    expect(res.success).toBe(true);
    expect(res.response).toBeDefined();

    // Verify onRequestSuccess was triggered
    await new Promise((r) => setTimeout(r, 10));
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);

    // Verify response body can be read and contains the original stream data
    const reader = res.response.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("data:");
  });
});
