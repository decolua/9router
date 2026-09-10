import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");

function build(onRequestSuccess) {
  return buildOnStreamComplete({
    provider: "anthropic",
    model: "claude-test",
    connectionId: "connection-test",
    apiKey: null,
    requestStartTime: Date.now(),
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    clientRawRequest: { endpoint: "/v1/messages" },
    onRequestSuccess,
  }).onStreamComplete;
}

describe("stream success boundary", () => {
  it("does not clear account on incomplete/synthetic-error terminal", async () => {
    const onRequestSuccess = vi.fn(async () => {});
    build(onRequestSuccess)({ content: "partial" }, null, Date.now(), {
      genuineTerminal: false,
    });
    await Promise.resolve();
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("clears account exactly once after genuine terminal completion", async () => {
    const onRequestSuccess = vi.fn(async () => {});
    build(onRequestSuccess)({ content: "done" }, null, Date.now(), {
      genuineTerminal: true,
    });
    await Promise.resolve();
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
  });

  it("swallows synchronous account-clear failures", () => {
    const onRequestSuccess = vi.fn(() => { throw new Error("db unavailable"); });
    expect(() => build(onRequestSuccess)({}, null, Date.now(), {
      genuineTerminal: true,
    })).not.toThrow();
  });
});
