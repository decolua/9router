import { describe, expect, it } from "vitest";

describe("DefaultExecutor trusted session forwarding", () => {
  it("forwards the captured client session when explicitly configured", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    const DefaultExecutor = mod.DefaultExecutor || mod.default;
    const executor = new DefaultExecutor("openai-compatible-custom");
    const headers = executor.buildHeaders({
      apiKey: "sk-test",
      _clientSessionId: "claude-session-123",
      providerSpecificData: {
        baseUrl: "http://llmrouter:8000/v1",
        sessionHeader: "x-llmrouter-session-id",
      },
    }, true);

    expect(headers["x-llmrouter-session-id"]).toBe("claude-session-123");
  });

  it("does not forward session identity without explicit configuration", async () => {
    const mod = await import("../../open-sse/executors/default.js");
    const DefaultExecutor = mod.DefaultExecutor || mod.default;
    const executor = new DefaultExecutor("openai-compatible-custom");
    const headers = executor.buildHeaders({
      apiKey: "sk-test",
      _clientSessionId: "claude-session-123",
      providerSpecificData: { baseUrl: "http://llmrouter:8000/v1" },
    }, true);

    expect(headers["x-llmrouter-session-id"]).toBeUndefined();
  });
});
