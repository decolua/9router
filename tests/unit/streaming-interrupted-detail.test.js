import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestDetail: vi.fn(),
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: mocks.saveRequestDetail,
  saveRequestUsage: mocks.saveRequestUsage,
  appendRequestLog: mocks.appendRequestLog,
}));

import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

const ctx = {
  provider: "testprov",
  model: "test-model",
  connectionId: "conn-12345678",
  apiKey: "client-key",
  requestStartTime: Date.now() - 1000,
  body: { messages: [{ role: "user", content: "hi" }] },
  stream: true,
  finalBody: null,
  translatedBody: null,
  clientRawRequest: { endpoint: "/v1/chat/completions" },
  pxpipe: undefined,
  reqTag: "T1",
  log: null,
};

describe("interrupted streaming request detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveRequestDetail.mockResolvedValue(undefined);
    mocks.saveRequestUsage.mockResolvedValue(undefined);
  });

  it("finalizes the placeholder row as cancelled with the same streamDetailId", () => {
    const { onStreamAbandoned, streamDetailId } = buildOnStreamComplete({ ...ctx });
    onStreamAbandoned("client_disconnected");

    expect(mocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    const detail = mocks.saveRequestDetail.mock.calls[0][0];
    expect(detail.id).toBe(streamDetailId);
    expect(detail.status).toBe("cancelled");
    expect(detail.response.content).toContain("interrupted");
    expect(detail.response.content).toContain("client_disconnected");
    expect(detail.tokens).toEqual({ prompt_tokens: 0, completion_tokens: 0 });
  });

  it("does not overwrite after normal completion", () => {
    const { onStreamComplete, onStreamAbandoned } = buildOnStreamComplete({ ...ctx });
    onStreamComplete({ content: "done" }, { prompt_tokens: 5, completion_tokens: 7 }, Date.now());
    onStreamAbandoned("client_disconnected");

    expect(mocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestDetail.mock.calls[0][0].status).toBe("success");
  });

  it("keeps normal completion behavior intact (success row + usage save)", () => {
    const { onStreamComplete, streamDetailId } = buildOnStreamComplete({ ...ctx });
    onStreamComplete({ content: "ok" }, { prompt_tokens: 3, completion_tokens: 4 }, null);

    const detail = mocks.saveRequestDetail.mock.calls[0][0];
    expect(detail.id).toBe(streamDetailId);
    expect(detail.status).toBe("success");
    expect(detail.response.content).toBe("ok");
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
  });

  it("abandons only once even if both disconnect and error fire", () => {
    const { onStreamAbandoned } = buildOnStreamComplete({ ...ctx });
    onStreamAbandoned("stall_timeout");
    onStreamAbandoned("client_disconnected");

    expect(mocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestDetail.mock.calls[0][0].providerResponse).toContain("stall_timeout");
  });

  it("recovers partial provider usage from streamState when abandon fires after chunks", () => {
    const { onStreamAbandoned, streamState } = buildOnStreamComplete({ ...ctx });
    // Simulate transform stream having populated partial usage
    streamState.usage = { prompt_tokens: 100, completion_tokens: 42 };
    streamState.content = "partial response so far";
    onStreamAbandoned("client_disconnected");

    const detail = mocks.saveRequestDetail.mock.calls[0][0];
    expect(detail.tokens.prompt_tokens).toBe(100);
    expect(detail.tokens.completion_tokens).toBe(42);
    expect(detail.status).toBe("cancelled");
    // usage writer must also be called when we have valid tokens
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
  });

  it("uses input estimate when provider usage missing but output content available", () => {
    const { onStreamAbandoned, streamState } = buildOnStreamComplete({ ...ctx });
    // No provider usage but content was streaming
    streamState.usage = null;
    streamState.content = "hello world this is partial";
    onStreamAbandoned("stall_timeout");

    const detail = mocks.saveRequestDetail.mock.calls[0][0];
    // prompt_tokens should come from body estimate (non-zero)
    expect(detail.tokens.prompt_tokens).toBeGreaterThan(0);
    expect(detail.status).toBe("cancelled");
  });

  it("returns streamState object from buildOnStreamComplete", () => {
    const { streamState } = buildOnStreamComplete({ ...ctx });
    expect(streamState).toBeDefined();
    expect(streamState).toHaveProperty("usage");
    expect(streamState).toHaveProperty("content");
    expect(streamState).toHaveProperty("thinking");
    expect(streamState).toHaveProperty("ttftAt");
  });

  it("does not double-finalize when a late completion races after abandon", () => {
    const { onStreamComplete, onStreamAbandoned } = buildOnStreamComplete({ ...ctx });
    onStreamAbandoned("client_disconnected");
    onStreamComplete({ content: "late eof" }, { prompt_tokens: 9, completion_tokens: 9 }, Date.now());

    expect(mocks.saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestDetail.mock.calls[0][0].status).toBe("cancelled");
  });

  it("populates streamState from live SSE chunks (passthrough)", async () => {
    const streamState = { usage: null, content: "", thinking: "", ttftAt: null };
    const ts = createPassthroughStreamWithLogger(
      "testprov", null, "test-model", "conn-x",
      { messages: [{ role: "user", content: "hi" }] }, null, "key", streamState
    );
    const writer = ts.writable.getWriter();
    const reader = ts.readable.getReader();
    const chunk = { choices: [{ delta: { content: "hello world" } }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } };
    // Start the read first: Node 22 TransformStream does not run transform()
    // until the readable side has demand.
    const readPromise = reader.read();
    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
    await readPromise;

    expect(streamState.content).toBe("hello world");
    expect(streamState.usage).toBeTruthy();
    expect(streamState.ttftAt).toBeTruthy();

    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
  });
});
