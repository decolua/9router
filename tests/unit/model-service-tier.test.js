import { describe, it, expect, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
  createSSETransformStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

import { parseSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockImplementation(async () => ({
    response: Response.json({ error: { message: "fixture upstream rejection" } }, { status: 400 }),
    url: "https://example.invalid/chat", headers: {}, transformedBody: null,
  }));
});

async function outbound(provider, suffix, sourceFormat = "openai", extra = {}, native = false) {
  const model = `gpt-6.1-sol${suffix}`;
  const request = sourceFormat === "openai-responses" ? { input: "hello" } : { messages: [{ role: "user", content: "hello" }] };
  await handleChatCore({
    body: { model, max_tokens: 1024, stream: false, ...request, ...extra },
    modelInfo: { provider, model }, credentials: { apiKey: "test-key", providerSpecificData: {} },
    sourceFormatOverride: sourceFormat,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, connectionId: "test-connection",
    clientRawRequest: { endpoint: sourceFormat === "claude" ? "/v1/messages" : "/v1/responses", body: {}, headers: native ? { "user-agent": "codex_cli_rs/0.1" } : {} },
  });
  expect(executeMock).toHaveBeenCalledOnce();
  return executeMock.mock.calls[0][0].body;
}

describe("model service-tier modifiers (#5333)", () => {
  it.each(["openai", "codex"])("selects priority with (fast) for %s", async (provider) => {
    const body = await outbound(provider, "(fast)");
    expect(body.model).toBe("gpt-6.1-sol");
    expect(body.service_tier).toBe("priority");
  });

  it.each(["openai", "codex"])("combines xhigh reasoning with fast processing for %s", async (provider) => {
    const body = await outbound(provider, "(xhigh,fast)");
    expect(body.model).toBe("gpt-6.1-sol");
    expect(body.service_tier).toBe("priority");
    expect(body.reasoning?.effort || body.reasoning_effort).toBe("xhigh");
  });

  it("accepts either modifier order and whitespace", async () => {
    const body = await outbound("openai", "( FAST , HIGH )");
    expect(body.service_tier).toBe("priority");
    expect(body.reasoning_effort).toBe("high");
  });

  it.each(["openai", "codex"])("lets an explicit standard suffix override a fast request body for %s", async (provider) => {
    const body = await outbound(provider, "(standard)", "openai", { service_tier: "priority" });
    expect(body.service_tier).toBe("default");
    if (provider === "codex") {
      expect(new CodexExecutor().transformRequest(body.model, body, true, {}).service_tier).toBeUndefined();
    }
  });

  it("preserves explicit body tier and effort when no tier modifier is present", async () => {
    const body = await outbound("openai", "(high)", "openai", { service_tier: "flex" });
    expect(body.service_tier).toBe("flex");
    expect(body.reasoning_effort).toBe("high");
  });

  it("keeps the body's effort when the suffix only selects fast mode", async () => {
    const body = await outbound("openai", "(fast)", "openai", { reasoning_effort: "low" });
    expect(body.service_tier).toBe("priority");
    expect(body.reasoning_effort).toBe("low");
  });

  it("applies the tier after a Claude-to-OpenAI translation", async () => {
    const body = await outbound("openai", "(high,fast)", "claude");
    expect(body.service_tier).toBe("priority");
    expect(body.reasoning_effort).toBe("high");
  });

  it("supports native Codex passthrough without dropping existing reasoning settings", async () => {
    const body = await outbound("codex", "(xhigh,fast)", "openai-responses", { reasoning: { effort: "low", summary: "detailed" } }, true);
    expect(body.service_tier).toBe("priority");
    expect(body.reasoning).toMatchObject({ effort: "xhigh", summary: "detailed" });
    const transformed = new CodexExecutor().transformRequest(body.model, body, true, {});
    expect(transformed.service_tier).toBe("priority");
  });

  it("does not inject a tier into unrelated providers", async () => {
    const body = await outbound("groq", "(high,fast)");
    expect(body.service_tier).toBeUndefined();
  });

  it.each(["(fast,standard)", "(fast,unknown)", "(fast,)", "(low,high,fast)"])("does not opt in to paid priority for invalid modifiers %s", async (suffix) => {
    const body = await outbound("openai", suffix);
    expect(body.service_tier).toBeUndefined();
  });

  it("retains the legacy parseSuffix return shape for a combined budget and tier", () => {
    expect(parseSuffix("model(8192,fast)")).toEqual({ cleanModel: "model", override: { mode: "budget", budget: 8192 } });
  });
});
