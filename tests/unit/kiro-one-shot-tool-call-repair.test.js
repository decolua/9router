import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");

function encodeHeader(name, value) {
  const nameBytes = new TextEncoder().encode(name);
  const valueBytes = new TextEncoder().encode(value);
  const out = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length);
  let offset = 0;
  out[offset++] = nameBytes.length;
  out.set(nameBytes, offset);
  offset += nameBytes.length;
  out[offset++] = 7;
  out[offset++] = (valueBytes.length >> 8) & 0xff;
  out[offset++] = valueBytes.length & 0xff;
  out.set(valueBytes, offset);
  return out;
}

function encodeEventFrame(eventType, payload) {
  const headers = encodeHeader(":event-type", eventType);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const totalLength = 12 + headers.length + payloadBytes.length + 4;
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headers.length, false);
  view.setUint32(8, 0, false);
  frame.set(headers, 12);
  frame.set(payloadBytes, 12 + headers.length);
  view.setUint32(totalLength - 4, 0, false);
  return frame;
}

function eventStreamResponse(frames, status = 200) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    }
  }), { status, statusText: status === 200 ? "OK" : "Bad Gateway" });
}

function controlledEventStreamResponse(initialFrames = []) {
  let controllerRef;
  const response = new Response(new ReadableStream({
    start(controller) {
      controllerRef = controller;
      for (const frame of initialFrames) controller.enqueue(frame);
    }
  }), { status: 200, statusText: "OK" });

  return {
    response,
    enqueue(frame) {
      controllerRef.enqueue(frame);
    },
    close() {
      controllerRef.close();
    }
  };
}

async function collectText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function collectDataChunks(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim())
    .filter((data) => data && data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

const credentials = {
  accessToken: "test-token",
  providerSpecificData: {
    kiroToolCallRepair: true
  }
};

beforeEach(() => {
  fetchMock.mockReset();
  delete process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES;
});

afterEach(() => {
  delete process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES;
  delete process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS;
  delete process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS;
});

describe("Kiro one-shot tool_call repair", () => {
  it("preserves happy-path streaming and returns the first chunk before upstream completion", async () => {
    const executor = new KiroExecutor();
    const upstream = controlledEventStreamResponse([
      encodeEventFrame("assistantResponseEvent", { content: "hello" })
    ]);
    fetchMock.mockResolvedValueOnce(upstream.response);

    const result = await executor.execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials
    });
    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    const firstRead = await reader.read();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstRead.done).toBe(false);
    expect(decoder.decode(firstRead.value)).toContain("hello");

    upstream.enqueue(encodeEventFrame("messageStopEvent", {}));
    upstream.close();
    await reader.cancel("test complete").catch(() => {});
  });

  it("retries once on pre-output malformed wrapper output and does not leak fake tool calls", async () => {
    const executor = new KiroExecutor();
    fetchMock
      .mockResolvedValueOnce(eventStreamResponse([
        encodeEventFrame("toolUseEvent", {
          toolUseId: "call_1",
          name: "tool_call",
          input: { arguments: { q: "router" } }
        }),
        encodeEventFrame("messageStopEvent", {})
      ]))
      .mockResolvedValueOnce(eventStreamResponse([
        encodeEventFrame("toolUseEvent", {
          toolUseId: "call_2",
          name: "tool_call",
          input: { name: "mcp_search", arguments: { q: "router" } }
        }),
        encodeEventFrame("messageStopEvent", {})
      ]));

    const result = await executor.execute({
      model: "kr/claude-opus-4.8",
      body: { systemPrompt: "base", conversationState: {} },
      stream: true,
      credentials
    });
    const text = await collectText(result.response.body);
    const chunks = collectDataChunks(text);
    const toolChunks = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
    const args = toolChunks.map((toolCall) => toolCall.function?.arguments || "").join("");
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text).not.toContain("invalid_kiro_tool_call");
    expect(JSON.parse(args)).toEqual({ name: "mcp_search", arguments: { q: "router" } });
    expect(retryBody.systemPrompt).toContain("Previous validation error");
  });

  it("emits repair retry failure code when the single repair retry is still malformed", async () => {
    const executor = new KiroExecutor();
    fetchMock
      .mockResolvedValueOnce(eventStreamResponse([
        encodeEventFrame("toolUseEvent", {
          toolUseId: "call_1",
          name: "tool_call",
          input: { arguments: { q: "router" } }
        }),
        encodeEventFrame("messageStopEvent", {})
      ]))
      .mockResolvedValueOnce(eventStreamResponse([
        encodeEventFrame("toolUseEvent", {
          toolUseId: "call_2",
          name: "tool_call",
          input: { arguments: { q: "router" } }
        }),
        encodeEventFrame("messageStopEvent", {})
      ]));

    const result = await executor.execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials
    });
    const text = await collectText(result.response.body);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text).toContain("kiro_tool_call_repair_retry_failed");
    expect(text).not.toContain("invalid_kiro_tool_call");
    expect(text).toContain("missing nested MCP tool name");
    expect(text).not.toContain("\"tool_calls\"");
  });

  it("propagates retry HTTP 429 instead of hiding it in a 200 SSE error", async () => {
    const executor = new KiroExecutor();
    executor.config = { ...executor.config, baseUrls: [executor.config.baseUrls[0]] };
    fetchMock
      .mockResolvedValueOnce(eventStreamResponse([
        encodeEventFrame("toolUseEvent", {
          toolUseId: "call_1",
          name: "tool_call",
          input: { arguments: { q: "router" } }
        }),
        encodeEventFrame("messageStopEvent", {})
      ]))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, statusText: "Too Many Requests" }));

    const result = await executor.execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.response.status).toBe(429);
    expect(await result.response.text()).toBe("rate limited");
  });

  it("does not retry unless repair is explicitly enabled", async () => {
    const executor = new KiroExecutor();
    fetchMock.mockResolvedValueOnce(eventStreamResponse([
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: { arguments: { q: "router" } }
      }),
      encodeEventFrame("messageStopEvent", {})
    ]));

    const result = await executor.execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} }
    });
    const text = await collectText(result.response.body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).toContain("invalid_kiro_tool_call");
    expect(text).not.toContain("\"tool_calls\"");
  });

  it("fails cleanly if the private repair gate buffer exceeds its configured cap", async () => {
    process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES = "8";
    const executor = new KiroExecutor();
    fetchMock.mockResolvedValueOnce(eventStreamResponse([
      encodeEventFrame("toolUseEvent", { toolUseId: "call_1", name: "tool_call" }),
      encodeEventFrame("toolUseEvent", { toolUseId: "call_1", name: "tool_call" })
    ]));

    const result = await executor.execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials
    });
    const text = await collectText(result.response.body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).toContain("kiro_tool_call_repair_buffer_exceeded");
  });

  it("aborts a gated first attempt and cancels its upstream reader", async () => {
    process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS = "1000";
    const executor = new KiroExecutor();
    let cancelReason;
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encodeEventFrame("toolUseEvent", { toolUseId: "call_1", name: "tool_call" }));
      },
      cancel(reason) {
        cancelReason = reason;
      }
    }), { status: 200, statusText: "OK" }));
    const abortController = new AbortController();

    const executePromise = executor.execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials,
      signal: abortController.signal
    });
    abortController.abort("client aborted");

    await expect(executePromise).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelReason).toBeDefined();
  });

  it("uses separate TTFT and inter-chunk stall timeouts for the repair gate", async () => {
    process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS = "1000";
    process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS = "1";
    const executor = new KiroExecutor();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encodeEventFrame("toolUseEvent", { toolUseId: "call_1", name: "tool_call" }));
      }
    }), { status: 200, statusText: "OK" }));

    const result = await executor.execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials
    });
    const text = await collectText(result.response.body);

    expect(text).toContain("Kiro tool_call repair stalled");
  });

  it("does not retry valid wrapper output and calls upstream exactly once", async () => {
    const executor = new KiroExecutor();
    fetchMock.mockResolvedValueOnce(eventStreamResponse([
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: { name: "mcp_search", arguments: { q: "router" } }
      }),
      encodeEventFrame("messageStopEvent", {})
    ]));

    const result = await executor.execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials
    });
    const text = await collectText(result.response.body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).not.toContain("kiro_tool_call_repair");
    expect(text).toContain("\"tool_calls\"");
  });
});
