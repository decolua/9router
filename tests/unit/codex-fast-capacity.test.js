import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { applyCodexFastMode } from "../../src/sse/handlers/chat.js";

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

describe("applyCodexFastMode", () => {
  const body = { model: "gpt-6.1-sol", input: "hi" };
  const connOn = { providerSpecificData: { codexFastMode: true } };
  const connOff = { providerSpecificData: { codexFastMode: false } };

  it("does nothing when both global and per-connection flags are off", () => {
    expect(applyCodexFastMode(body, "codex", "gpt-6.1-sol", {}, connOff).service_tier).toBeUndefined();
    expect(applyCodexFastMode(body, "codex", "gpt-6.1-sol", null, null).service_tier).toBeUndefined();
  });

  it("applies priority when the global setting is on", () => {
    expect(applyCodexFastMode(body, "codex", "gpt-6.1-sol", { codexFastMode: true }).service_tier).toBe("priority");
  });

  it("applies priority when only the connection flag is on", () => {
    expect(applyCodexFastMode(body, "codex", "gpt-6.1-sol", {}, connOn).service_tier).toBe("priority");
  });

  it("covers all codex models (sol, luna, terra, review variants)", () => {
    const on = { codexFastMode: true };
    for (const m of ["gpt-5.6-sol", "gpt-5.6-sol-review", "gpt-6.1-sol", "gpt-6.1-sol(xhigh)", "gpt-6-luna", "gpt-6-terra"]) {
      expect(applyCodexFastMode({ ...body, model: m }, "codex", m, on).service_tier).toBe("priority");
    }
  });

  it("ignores other providers even when the flag is on", () => {
    expect(applyCodexFastMode(body, "openai", "gpt-6.1-sol", { codexFastMode: true }, connOn).service_tier).toBeUndefined();
  });

  it("preserves a client-supplied service_tier", () => {
    const explicit = { ...body, service_tier: "flex" };
    expect(applyCodexFastMode(explicit, "codex", "gpt-6.1-sol", { codexFastMode: true }, connOn).service_tier).toBe("flex");
  });
});
