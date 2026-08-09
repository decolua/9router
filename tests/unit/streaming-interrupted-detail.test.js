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
});
