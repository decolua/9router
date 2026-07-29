import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

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
  it("maps Codex fast tier to priority and unsupported max reasoning to xhigh", () => {
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

  // Official openai/codex serializes semantic Ultra as Max for requests.
  // Sol/Terra keep semantic ultra via resolveOpenAiEffort; Codex wire alias maps ultra→max.
  it.each([
    ["gpt-5.6-sol", "max", "max"],
    ["gpt-5.6-sol", "ultra", "max"],
    ["gpt-5.6-terra", "max", "max"],
    ["gpt-5.6-terra", "ultra", "max"],
    ["gpt-5.6-luna", "max", "max"],
    ["gpt-5.6-luna", "ultra", "max"],
    ["gpt-5.5", "max", "xhigh"],
    ["gpt-5.5", "ultra", "xhigh"],
    ["gpt-5.5", "ULTRA", "ULTRA"],
    ["gpt-5.5", "Ultra", "Ultra"],
    ["gpt-5.6-sol", "xhigh", "xhigh"],
    ["gpt-5.6-sol", "high", "high"],
  ])("normalizes nested reasoning.effort for %s: %s → %s", (model, requested, expected) => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest(model, {
      model,
      input: "hi",
      reasoning: { effort: requested },
    }, true, {});

    expect(body.reasoning.effort).toBe(expected);
  });

  // Legacy reasoning_effort also converges through the same semantic→wire path.
  it.each([
    ["gpt-5.6-sol", "ultra", "max"],
    ["gpt-5.6-terra", "ultra", "max"],
    ["gpt-5.6-sol", "max", "max"],
    ["gpt-5.6-luna", "ultra", "max"],
    ["gpt-5.5", "ultra", "xhigh"],
    ["gpt-5.5", "ULTRA", "ULTRA"],
  ])("normalizes legacy reasoning_effort for %s: %s → %s", (model, requested, expected) => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest(model, {
      model,
      input: "hi",
      reasoning_effort: requested,
    }, true, {});

    expect(body.reasoning.effort).toBe(expected);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it.each([
    ["gpt-5.6-sol-ultra", "gpt-5.6-sol", "max"],
    ["gpt-5.6-terra-ultra", "gpt-5.6-terra", "max"],
    ["gpt-5.6-terra-max", "gpt-5.6-terra", "max"],
    ["gpt-5.6-luna-ultra", "gpt-5.6-luna", "max"],
  ])("normalizes effort suffix %s → model %s effort %s", (model, expectedModel, expectedEffort) => {
    const executor = new CodexExecutor();
    const body = executor.transformRequest(model, { model, input: "hi" }, true, {});

    expect(body.model).toBe(expectedModel);
    expect(body.reasoning.effort).toBe(expectedEffort);
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
