import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { buildErrorBody } from "../../open-sse/utils/error.js";

function streamFromText(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function streamFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("Codex fast tier and capacity handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps Codex fast tier to priority and max reasoning to xhigh", () => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest("gpt-5.5", {
      model: "gpt-5.5",
      input: "hi",
      reasoning_effort: "max",
      service_tier: "fast",
    }, true, {});

    expect(body.service_tier).toBe("priority");
    expect(body.reasoning.effort).toBe("xhigh");
  });

  it("uses ChatGPT workspace header fallback", () => {
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders({
      accessToken: "token",
      connectionId: "conn_1",
      providerSpecificData: { chatgptAccountId: "acct_1" },
    });

    expect(headers["ChatGPT-Account-ID"]).toBe("acct_1");
  });

  it("classifies 200-SSE model capacity as account fallback", async () => {
    const executor = new CodexExecutor();
    const response = new Response(streamFromText([
      "event: error",
      'data: {"error":{"message":"Selected model is at capacity. Please try a different model."}}',
      "",
    ].join("\n")), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.accountFallback).toBe(true);
    expect(peek.message).toBe("Selected model is at capacity. Please try a different model.");
  });

  it("preserves non-JSON SSE capacity and retry detection", async () => {
    const executor = new CodexExecutor();
    const capacity = new Response(streamFromText("data: Selected model is at capacity\n\n"), { status: 200 });
    const retry = new Response(streamFromText("data: server_is_overloaded\n\n"), { status: 200 });

    await expect(executor._peekSseTransientError(capacity)).resolves.toMatchObject({
      matched: "selected model is at capacity",
      accountFallback: true,
      contextOverflow: false,
    });
    await expect(executor._peekSseTransientError(retry)).resolves.toMatchObject({
      matched: "server_is_overloaded",
      accountFallback: false,
      contextOverflow: false,
    });
  });

  it("classifies 200-SSE context overflow as a terminal client error", async () => {
    const executor = new CodexExecutor();
    const response = new Response(streamFromText([
      "event: response.failed",
      'data: {"type":"response.failed","response":{"error":{"message":"Your input exceeds the context window of this model."}}}',
      "",
    ].join("\n")), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.contextOverflow).toBe(true);
    expect(peek.accountFallback).toBe(false);
    expect(peek.message).toBe("Your input exceeds the context window of this model.");
  });

  it("detects a structured context overflow split across stream chunks", async () => {
    const response = new Response(streamFromChunks([
      "event: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"context_",
      "length_exceeded\",\"message\":\"Prompt is too long\"}}}\n\n",
    ]), { status: 200 });

    await expect(new CodexExecutor()._peekSseTransientError(response)).resolves.toMatchObject({
      matched: "context_length_exceeded",
      message: "Prompt is too long",
      contextOverflow: true,
      accountFallback: false,
    });
  });

  it("treats a non-overflow error code as authoritative", async () => {
    const response = new Response(streamFromText([
      "event: response.failed",
      'data: {"type":"response.failed","response":{"error":{"code":"invalid_request_error","message":"exceeds the context window"}}}',
      "",
    ].join("\n")), { status: 200 });

    const peek = await new CodexExecutor()._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    expect(peek.contextOverflow).toBe(false);
  });

  it("does not inspect non-2xx upstream responses as SSE", async () => {
    const response = new Response(streamFromText([
      "event: response.failed",
      'data: {"type":"response.failed","response":{"error":{"code":"context_length_exceeded"}}}',
      "",
    ].join("\n")), { status: 400 });

    await expect(new CodexExecutor()._peekSseTransientError(response)).resolves.toEqual({
      matched: null,
      message: null,
      accountFallback: false,
      contextOverflow: false,
      replacementBody: null,
    });
  });

  it("returns context overflow as HTTP 413 without retrying", async () => {
    const upstream = new Response(streamFromText([
      "event: response.failed",
      'data: {"type":"response.failed","response":{"error":{"message":"Your input exceeds the context window of this model."}}}',
      "",
    ].join("\n")), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
    const execute = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({ response: upstream });

    const result = await new CodexExecutor().execute({ body: {}, log: {} });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.response.status).toBe(413);
    await expect(result.response.json()).resolves.toEqual({
      error: {
        message: "Your input exceeds the context window of this model.",
        type: "invalid_request_error",
        code: "context_length_exceeded",
      },
    });
  });

  it("keeps HTTP 413 terminal through shared error and fallback handling", () => {
    expect(buildErrorBody(413, "Prompt is too long")).toEqual({
      error: {
        message: "Prompt is too long",
        type: "invalid_request_error",
        code: "context_length_exceeded",
      },
    });
    expect(checkFallbackError(413, "Rate limit capacity exceeded", 4)).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
      newBackoffLevel: 4,
    });
  });

  it("does not rotate combo models after a context overflow", async () => {
    const terminal = new Response(JSON.stringify(buildErrorBody(413, "Prompt is too long")), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
    const handleSingleModel = vi.fn()
      .mockResolvedValueOnce(terminal)
      .mockResolvedValueOnce(new Response("ok"));
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = await handleComboChat({
      body: {},
      models: ["first", "second"],
      handleSingleModel,
      log,
      comboStrategy: "fallback",
      autoSwitch: false,
    });

    expect(result).toBe(terminal);
    expect(result.status).toBe(413);
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel).toHaveBeenCalledWith({}, "first");
  });

  it("does not carry a failure event type into a later output event", async () => {
    const executor = new CodexExecutor();
    const text = [
      "event: response.failed",
      'data: {"type":"response.failed","response":{}}',
      "",
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","error":{"message":"exceeds the context window"}}',
      "",
    ].join("\n");
    const response = new Response(streamFromText(text), { status: 200 });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    expect(peek.contextOverflow).toBe(false);
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(text);
  });

  it.each([
    "This explains what exceeds the context window.",
    "The request used too many tokens in the example.",
  ])("does not classify normal output as context overflow: %s", async (delta) => {
    const executor = new CodexExecutor();
    const text = [
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta })}`,
      "",
    ].join("\n");
    const response = new Response(streamFromText(text), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    expect(peek.contextOverflow).toBe(false);
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(text);
  });

  it("reassembles normal SSE after peeking", async () => {
    const executor = new CodexExecutor();
    const text = [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"OK"}',
      "",
    ].join("\n");
    const response = new Response(streamFromText(text), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    expect(peek.contextOverflow).toBe(false);
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(text);
  });
});

describe("Codex reasoning normalization", () => {
  it.each([
    ["gpt-5.6-sol", "max", "max"],
    ["gpt-5.6-sol", "ultra", "ultra"],
    ["gpt-5.6-terra", "max", "max"],
    ["gpt-5.6-terra", "ultra", "ultra"],
    ["gpt-5.6-luna", "max", "max"],
    ["gpt-5.6-luna", "ultra", "max"],
  ])("normalizes %s effort %s to %s", (model, effort, expected) => {
    const body = new CodexExecutor().transformRequest(model, {
      model,
      input: "hi",
      reasoning: { effort },
    }, true, {});

    expect(body.reasoning.effort).toBe(expected);
  });

  it("resolves review models before applying the reasoning matrix", () => {
    const body = new CodexExecutor().transformRequest("gpt-5.6-terra-review", {
      model: "gpt-5.6-terra-review",
      input: "hi",
      reasoning_effort: "ultra",
    }, true, {});

    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.reasoning.effort).toBe("ultra");
  });
});
