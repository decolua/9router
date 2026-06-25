import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

import { saveRequestDetail, saveRequestUsage } from "@/lib/usageDb.js";
import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";

function makeComplete(overrides = {}) {
  return buildOnStreamComplete({
    provider: "codex",
    model: "gpt-5.5",
    connectionId: "conn_1",
    apiKey: "sk-test",
    requestStartTime: Date.now(),
    body: { input: [{ role: "user", content: "hello" }], stream: true },
    stream: true,
    finalBody: null,
    translatedBody: { input: [{ role: "user", content: "hello" }] },
    clientRawRequest: { endpoint: "/v1/responses" },
    ...overrides,
  }).onStreamComplete;
}

describe("stream completion callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs success bookkeeping only on terminal stream success", async () => {
    const onRequestSuccess = vi.fn(async () => {});
    const onRequestFailure = vi.fn(async () => {});
    const onStreamComplete = makeComplete({ onRequestSuccess, onRequestFailure });

    onStreamComplete(
      { content: "done", thinking: null },
      { prompt_tokens: 10, completion_tokens: 2 },
      Date.now(),
      { status: "success" },
    );
    await vi.waitFor(() => expect(onRequestSuccess).toHaveBeenCalledTimes(1));

    expect(onRequestFailure).not.toHaveBeenCalled();
    expect(saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
      response: expect.objectContaining({ content: "done" }),
    }));
  });

  it("runs failure bookkeeping and skips success on terminal stream failure", async () => {
    const onRequestSuccess = vi.fn(async () => {});
    const onRequestFailure = vi.fn(async () => {});
    const onStreamComplete = makeComplete({ onRequestSuccess, onRequestFailure });
    const outcome = {
      status: "failure",
      errorStatus: 503,
      code: "model_at_capacity",
      message: "Selected model is at capacity. Please try a different model.",
    };

    onStreamComplete(
      { content: "partial", thinking: null },
      { prompt_tokens: 10, completion_tokens: 2 },
      Date.now(),
      outcome,
    );
    await vi.waitFor(() => expect(onRequestFailure).toHaveBeenCalledTimes(1));

    expect(onRequestFailure).toHaveBeenCalledWith(outcome);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(saveRequestUsage).not.toHaveBeenCalled();
    expect(saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
      status: "error",
      response: expect.objectContaining({
        error: "Selected model is at capacity. Please try a different model.",
        status: 503,
      }),
    }));
  });
});
