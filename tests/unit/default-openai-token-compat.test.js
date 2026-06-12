import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DefaultExecutor OpenAI token parameter compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps max_tokens to max_completion_tokens for GPT-5 family", () => {
    const executor = new DefaultExecutor("openai");
    const out = executor.transformRequest("gpt-5.4", {
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 64,
    });

    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBe(64);
  });

  it("keeps max_tokens for models that still support it", () => {
    const executor = new DefaultExecutor("openai");
    const out = executor.transformRequest("gpt-4.1", {
      model: "gpt-4.1",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 32,
    });

    expect(out.max_tokens).toBe(32);
    expect(out.max_completion_tokens).toBeUndefined();
  });

  it("retries once with max_completion_tokens after unsupported max_tokens 400", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        error: {
          message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
          type: "invalid_request_error",
          param: "max_tokens",
          code: "unsupported_parameter",
        },
      }, 400))
      .mockResolvedValueOnce(jsonResponse({
        id: "chatcmpl_test",
        object: "chat.completion",
      }, 200));

    const executor = new DefaultExecutor("openai");
    const result = await executor.execute({
      model: "gpt-4.1",
      body: {
        model: "gpt-4.1",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 24,
      },
      stream: false,
      credentials: { apiKey: "test-key" },
      signal: undefined,
      log: null,
      proxyOptions: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);

    const secondCall = proxyAwareFetch.mock.calls[1];
    const secondBody = JSON.parse(secondCall[1].body);
    expect(secondBody.max_tokens).toBeUndefined();
    expect(secondBody.max_completion_tokens).toBe(24);
    expect(result.response.status).toBe(200);
  });

  it("falls back to /responses when model is not supported by /chat/completions", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        error: {
          message: "This is not a chat model and thus not supported in the v1/chat/completions endpoint.",
          type: "invalid_request_error",
          param: "model",
          code: null,
        },
      }, 404))
      .mockResolvedValueOnce(jsonResponse({
        id: "resp_test",
        object: "response",
      }, 200));

    const executor = new DefaultExecutor("openai");
    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body: {
        model: "gpt-5.3-codex",
        messages: [{ role: "user", content: "hi" }],
      },
      stream: true,
      credentials: { apiKey: "test-key" },
      signal: undefined,
      log: null,
      proxyOptions: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch.mock.calls[1][0]).toContain("/responses");

    const secondBody = JSON.parse(proxyAwareFetch.mock.calls[1][1].body);
    expect(secondBody.input).toBeDefined();
    expect(result.response.status).toBe(200);
  });

  it("handles gpt-5.3-codex sequence: unknown max_tokens then non-chat fallback", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        error: {
          message: "Unknown parameter: 'max_tokens'.",
          type: "invalid_request_error",
          param: "max_tokens",
          code: "unknown_parameter",
        },
      }, 400))
      .mockResolvedValueOnce(jsonResponse({
        error: {
          message: "This is not a chat model and thus not supported in the v1/chat/completions endpoint.",
          type: "invalid_request_error",
          param: "model",
          code: null,
        },
      }, 404))
      .mockResolvedValueOnce(jsonResponse({
        id: "resp_codex",
        object: "response",
      }, 200));

    const executor = new DefaultExecutor("openai");
    const result = await executor.execute({
      model: "gpt-5.3-codex",
      body: {
        model: "gpt-5.3-codex",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 16,
      },
      stream: true,
      credentials: { apiKey: "test-key" },
      signal: undefined,
      log: null,
      proxyOptions: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);

    const secondBody = JSON.parse(proxyAwareFetch.mock.calls[1][1].body);
    expect(secondBody.max_tokens).toBeUndefined();
    expect(secondBody.max_completion_tokens).toBe(16);

    expect(proxyAwareFetch.mock.calls[2][0]).toContain("/responses");
    const thirdBody = JSON.parse(proxyAwareFetch.mock.calls[2][1].body);
    expect(thirdBody.max_tokens).toBeUndefined();
    expect(thirdBody.max_output_tokens).toBe(16);
    expect(result.response.status).toBe(200);
  });

  it("falls back to /responses when chat endpoint says use /v1/responses", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        error: {
          message: "Function tools with reasoning_effort are not supported for gpt-5.4 in /v1/chat/completions. Please use /v1/responses instead.",
          type: "invalid_request_error",
          param: "reasoning_effort",
          code: null,
        },
      }, 400))
      .mockResolvedValueOnce(jsonResponse({
        id: "resp_gpt54",
        object: "response",
      }, 200));

    const executor = new DefaultExecutor("openai");
    const result = await executor.execute({
      model: "gpt-5.4",
      body: {
        model: "gpt-5.4",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "medium",
        tools: [{ type: "function", function: { name: "x", parameters: { type: "object", properties: {} } } }],
      },
      stream: true,
      credentials: { apiKey: "test-key" },
      signal: undefined,
      log: null,
      proxyOptions: null,
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(proxyAwareFetch.mock.calls[1][0]).toContain("/responses");
    expect(result.response.status).toBe(200);
  });
});
