// Cline free models (z-ai/glm-5.3-flash, deepseek-v4-flash) wrap non-stream
// chat completions in {"success":true,"data":{...choices...}} on
// https://api.cline.bot/api/v1/chat/completions. Both the UI model-test ping
// (src/app/api/models/test/ping.js) and the proxy non-stream path
// (open-sse/handlers/chatCore/nonStreamingHandler.js) read `choices` at the
// top level, so enveloped choices are invisible ("Provider returned no
// completion choices for this model"). These tests pin the unwrap behavior.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the heavy Next.js-dependent imports BEFORE importing ping.js
// (same pattern as tests/unit/ping-reasoning-models-3010.test.js).
vi.mock("@/lib/localDb", () => ({ getApiKeys: vi.fn(async () => [{ key: "test-key", isActive: true }]) }));
vi.mock("@/shared/constants/config", () => ({ UPDATER_CONFIG: { appPort: 20127 } }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "cli-token") }));
// requestDetail.js imports from @/lib/usageDb.js too, so one mock covers both
// the handler and its usage/detail helpers.
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

// The proxy adds a 2000-token headroom buffer to usage before returning it
// to the client (addBufferToUsage), so response-body usage is input + 2000.
// The usage recorded via saveRequestUsage is the unbuffered extraction —
// asserting on it proves the unwrap ran before usage extraction.
const { saveRequestUsage } = await import("@/lib/usageDb.js");

describe("cline free-models {success,data} envelope", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(obj) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(obj),
      json: async () => obj,
    };
  }

  it("ping: enveloped success unwraps to ok:true (regression for reported error)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { choices: [{ message: { content: "OK" } }] } })
    );
    const result = await pingModelByKind("cl/z-ai/glm-5.3-flash", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(true);
  });

  it("ping: enveloped reasoning-only response still soft-passes with note", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          choices: [
            {
              finish_reason: "length",
              message: { content: "", reasoning: "The user said hi" },
            },
          ],
        },
      })
    );
    const result = await pingModelByKind("cl/z-ai/glm-5.3-flash", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/reasoning-only/);
  });

  it("ping: error envelope passes through without unwrap", async () => {
    const body = { error: "empty response content", success: false };
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify(body),
      json: async () => body,
    });
    const result = await pingModelByKind("cl/z-ai/glm-5.3-flash", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty response content/);
  });

  it("ping: bare (un-enveloped) body still passes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "Hello!" } }] }));
    const result = await pingModelByKind("openai/gpt-4o", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(true);
  });

  it("ping: does not unwrap for a provider that did not opt in", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { choices: [{ message: { content: "OK" } }] } })
    );
    const result = await pingModelByKind("openai/gpt-4o", "llm", "http://127.0.0.1:20127");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no completion choices/i);
  });
});

describe("cline free-models envelope in nonStreamingHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stubLogger() {
    return { logProviderResponse() {}, logConvertedResponse() {} };
  }

  function callHandler(providerResponse, provider = "cline") {
    return handleNonStreamingResponse({
      providerResponse,
      provider,
      model: "z-ai/glm-5.3-flash",
      sourceFormat: "openai",
      targetFormat: "openai",
      body: { stream: false },
      stream: false,
      translatedBody: null,
      finalBody: null,
      requestStartTime: Date.now(),
      connectionId: "c1",
      apiKey: "k",
      clientRawRequest: null,
      onRequestSuccess: () => {},
      reqLogger: stubLogger(),
      toolNameMap: null,
      customToolNames: null,
      trackDone: () => {},
      appendLog: () => {},
      pxpipe: null,
      reqTag: "t",
      log: null,
    });
  }

  it("unwraps the {success,data} envelope before usage extraction and translation", async () => {
    const providerResponse = new Response(
      JSON.stringify({
        success: true,
        data: {
          choices: [{ message: { content: "Hi" } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const result = await callHandler(providerResponse);
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices).toBeDefined();
    expect(body.choices[0].message.content).toBe("Hi");
    expect(body.success).toBeUndefined();
    expect(saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(saveRequestUsage.mock.calls[0][0].tokens).toMatchObject({
      prompt_tokens: 5,
      completion_tokens: 2,
    });
    expect(body.usage.prompt_tokens).toBe(2005);
  });

  it("passes a bare (non-enveloped) body through unchanged", async () => {
    const providerResponse = new Response(
      JSON.stringify({
        choices: [{ message: { content: "Hi" } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const result = await callHandler(providerResponse);
    expect(result.success).toBe(true);
    const body = await result.response.json();
    expect(body.choices[0].message.content).toBe("Hi");
    expect(saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(saveRequestUsage.mock.calls[0][0].tokens).toMatchObject({
      prompt_tokens: 3,
      completion_tokens: 1,
    });
    expect(body.usage.prompt_tokens).toBe(2003);
  });

  // The unwrap is opt-in via transport.quirks.clineEnvelope so it can never
  // rewrite another provider's body — including one that happens to return
  // {"success":true,"data":...} for its own reasons.
  it("leaves an enveloped body untouched for a provider that did not opt in", async () => {
    const providerResponse = new Response(
      JSON.stringify({
        success: true,
        data: { choices: [{ message: { content: "Hi" } }] },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const result = await callHandler(providerResponse, "openai");
    const body = await result.response.json();
    expect(body.success).toBe(true);
    expect(body.data.choices[0].message.content).toBe("Hi");
    expect(body.choices).toBeUndefined();
  });
});

describe("cline /api/v1/models aggregation (resolveClineModels vs resolveClinepassModels)", () => {
  const API_MODELS_URL = "https://api.cline.bot/api/v1/models";

  const API_RESPONSE = [
    { id: "cline-pass/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "cline-pass/glm-5.2", name: "GLM-5.2" },
    { id: "z-ai/glm-5.3-flash", name: "GLM-5.3 Flash" },
    { id: "z-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash (Free)" },
  ];

  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolveClineModels returns all models (including free-tier)", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => API_RESPONSE,
    });
    const result = await resolveClineModels({ accessToken: "test-token" });
    expect(result).not.toBeNull();
    expect(result.models).toHaveLength(4);
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("cline-pass/deepseek-v4-flash");
    expect(ids).toContain("z-ai/glm-5.3-flash");
    expect(ids).toContain("z-ai/deepseek-v4-flash");
  });

  it("resolveClinepassModels returns only cline-pass/ models", async () => {
    const { resolveClinepassModels } = await import("../../open-sse/services/clinepassModels.js");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => API_RESPONSE,
    });
    const result = await resolveClinepassModels({ accessToken: "test-token" });
    expect(result).not.toBeNull();
    expect(result.models).toHaveLength(2);
    const ids = result.models.map((m) => m.id);
    expect(ids).toContain("cline-pass/deepseek-v4-flash");
    expect(ids).toContain("cline-pass/glm-5.2");
    expect(ids).not.toContain("z-ai/glm-5.3-flash");
  });

  it("resolveClineModels unwraps {success,data} envelope", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: API_RESPONSE }),
    });
    const result = await resolveClineModels({ accessToken: "test-token" });
    expect(result).not.toBeNull();
    expect(result.models).toHaveLength(4);
  });

  it("resolveClineModels returns null when no token", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    const result = await resolveClineModels({});
    expect(result).toBeNull();
  });

  it("resolveClineModels returns null on fetch error", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    fetchMock.mockRejectedValue(new Error("network error"));
    const result = await resolveClineModels({ accessToken: "test-token" });
    expect(result).toBeNull();
  });

  it("resolveClineModels returns {id,name} shape", async () => {
    const { resolveClineModels } = await import("../../open-sse/services/clinepassModels.js");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => API_RESPONSE,
    });
    const result = await resolveClineModels({ accessToken: "test-token" });
    expect(result.models[0]).toHaveProperty("id");
    expect(result.models[0]).toHaveProperty("name");
    expect(typeof result.models[0].id).toBe("string");
    expect(typeof result.models[0].name).toBe("string");
  });
});
