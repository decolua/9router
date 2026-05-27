import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/debugLog.js", () => ({
  dbg: vi.fn(),
  isDebugEnabled: false,
}));

describe("pipeWithDisconnect timing markers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures upstream first byte and client first chunk timings", async () => {
    const { pipeWithDisconnect } = await import(
      "../../open-sse/utils/streamHandler.js"
    );

    const timing = {};
    const providerResponse = {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: hello\\n\\n"));
          controller.close();
        },
      }),
    };

    const passthroughTransform = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    });

    const stream = pipeWithDisconnect(
      providerResponse,
      passthroughTransform,
      {
        signal: undefined,
        startTime: Date.now(),
        isConnected: () => true,
        handleComplete: vi.fn(),
        handleError: vi.fn(),
        handleDisconnect: vi.fn(),
        abort: vi.fn(),
      },
      null,
      null,
      timing,
    );

    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toContain("data: hello");

    const second = await reader.read();
    expect(second.done).toBe(true);
    expect(typeof timing.upstreamFirstByteAt).toBe("number");
    expect(typeof timing.clientFirstChunkAt).toBe("number");
    expect(timing.clientFirstChunkAt).toBeGreaterThanOrEqual(
      timing.upstreamFirstByteAt,
    );
  });
});
