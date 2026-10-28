import { describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

function streamFromText(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

describe("Codex fast tier and capacity handling", () => {
  it("maps Codex fast tier to priority and max reasoning to xhigh", () => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest("gpt-reserve", {
      model: "gpt-reserve",
      input: "hi",
      reasoning_effort: "max",
      service_tier: "fast",
    }, true, {});

    expect(body.service_tier).toBe("priority");
    expect(body.reasoning.effort).toBe("xhigh");
  });

  it("uses Codex account and request-routing headers", () => {
    const executor = new CodexExecutor();
    const headers = executor.buildHeaders({
      accessToken: "token",
      connectionId: "conn_1",
      providerSpecificData: { chatgptAccountId: "acct_1" },
    }, true, null, "gpt-5.6-terra", {
      model: "gpt-5.6-terra",
      service_tier: "priority",
    });

    expect(headers["ChatGPT-Account-ID"]).toBe("acct_1");
    expect(headers["OpenAI-Beta"]).toBe("responses=experimental");
    expect(headers["x-codex-routing-hint"]).toBe("model=gpt-5.6-terra;tier=priority");
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
describe("Codex compact endpoint routing", () => {
  it("routes compact and normal requests independently", async () => {
    const requests = [];
    const fetchSpy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url) => {
      requests.push(url);
      return { ok: true, status: 200, headers: new Map() };
    });

    try {
      const executor = new CodexExecutor();
      const credentials = { accessToken: "test", connectionId: "conn-1", providerSpecificData: {} };
      const model = "gpt-5.6-terra";
      const makeBody = (compact) => ({
        ...(compact ? { _compact: true } : {}),
        model,
        input: "compact this conversation",
      });

      await executor.execute({ model, body: makeBody(true), stream: true, credentials });
      await executor.execute({ model, body: makeBody(false), stream: true, credentials });

      expect(requests).toEqual([
        "https://chatgpt.com/backend-api/codex/responses/compact",
        "https://chatgpt.com/backend-api/codex/responses",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it("keeps compact requests on the compact endpoint when retrying", async () => {
    const requests = [];
    const upstream = [
      new Response([
        "event: error",
        'data: {"error":{"type":"service_unavailable_error","message":"temporary outage"}}',
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    ];
    const fetchSpy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url) => {
      requests.push(url);
      return upstream.shift();
    });

    try {
      const executor = new CodexExecutor();
      executor.config = { ...executor.config, retry: { 503: { attempts: 1, delayMs: 0 } } };
      const model = "gpt-5.6-terra";
      await executor.execute({
        model,
        body: { _compact: true, model, input: "compact this conversation" },
        stream: true,
        credentials: { accessToken: "test", connectionId: "conn-1", providerSpecificData: {} },
      });

      expect(requests).toEqual([
        "https://chatgpt.com/backend-api/codex/responses/compact",
        "https://chatgpt.com/backend-api/codex/responses/compact",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps compact routing across BaseExecutor HTTP retries", async () => {
    const requests = [];
    const upstream = [
      new Response("retry", { status: 503 }),
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    ];
    const fetchSpy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url) => {
      requests.push(url);
      return upstream.shift();
    });

    try {
      const executor = new CodexExecutor();
      executor.config = { ...executor.config, retry: { 503: { attempts: 1, delayMs: 0 } } };
      const model = "gpt-5.6-terra";
      await executor.execute({
        model,
        body: { _compact: true, model, input: "compact this conversation" },
        stream: true,
        credentials: { accessToken: "test", connectionId: "conn-1", providerSpecificData: {} },
      });

      expect(requests).toEqual([
        "https://chatgpt.com/backend-api/codex/responses/compact",
        "https://chatgpt.com/backend-api/codex/responses/compact",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

});

describe("Codex SSE transient error detection", () => {
  it("does not treat model error words in assistant output as an upstream error", async () => {
    const executor = new CodexExecutor();
    const text = [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"The error code is server_is_overloaded."}',
      "",
    ].join("\n");
    const response = new Response(streamFromText(text), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(text);
  });
  it("classifies structured response.failed capacity errors", async () => {
    const executor = new CodexExecutor();
    const text = [
      "event: response.failed",
      'data: {"type":"response.failed","response":{"error":{"code":"model_at_capacity","message":"busy"}}}',
      "",
    ].join("\n");
    const response = new Response(streamFromText(text), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.accountFallback).toBe(true);
    expect(peek.message).toBe("busy");
  });

  it("stops transient retries after a function call is emitted", async () => {
    const executor = new CodexExecutor();
    const text = [
      "event: response.output_item.added",
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call1","name":"run","arguments":""}}',
      "",
      "event: error",
      'data: {"error":{"type":"service_unavailable_error","message":"late error"}}',
      "",
    ].join("\n");
    const response = new Response(streamFromText(text), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    await expect(new Response(peek.replacementBody).text()).resolves.toBe(text);
  });

});
