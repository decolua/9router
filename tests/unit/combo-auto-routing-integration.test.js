import { describe, it, expect, vi, beforeEach } from "vitest";
import { AUTO_ROUTING_TIERS } from "../../open-sse/config/autoRouting.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), usage: vi.fn(async () => {}), settings: {}, combos: {}, getCredentials: vi.fn(), markUnavailable: vi.fn() }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => mocks.settings,
  getComboByName: async (name) => mocks.combos[name] ?? null,
  getModelAliases: async () => ({}),
  getProviderNodes: async () => [],
}));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: (...args) => mocks.getCredentials(...args),
  markAccountUnavailable: (...args) => mocks.markUnavailable(...args),
  clearAccountError: vi.fn(async () => {}),
  extractApiKey: () => "caller-key",
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn(), checkAndRefreshToken: async (_p, credentials) => credentials }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ config: {}, noAuth: true, execute: mocks.execute }) }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: (...args) => mocks.usage(...args),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({ createRequestLogger: async () => Object.fromEntries(["logClientRawRequest", "logRawRequest", "logTargetRequest", "logProviderResponse", "logConvertedResponse", "logError"].map((key) => [key, vi.fn()])) }));
vi.mock("../../open-sse/handlers/chatCore.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, handleChatCore: vi.fn(original.handleChatCore) };
});

const { handleChat } = await import("@/sse/handlers/chat.js");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { POST: handleGemini } = await import("@/app/api/v1beta/models/[...path]/route.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.combos = { smart: { name: "smart", models: ["openai/emergency"] } };
  mocks.settings = {
    requireApiKey: true,
    comboStrategies: { smart: { fallbackStrategy: "auto-routing", autoRouting: {
      classifierModel: "openai/gpt-4o-mini", timeoutMs: 2000,
      tiers: Object.fromEntries(AUTO_ROUTING_TIERS.map(({ id }) => [id, ["deepseek/deepseek-chat"]])),
    } } },
  };
  mocks.getCredentials.mockResolvedValue({ apiKey: "provider-key", connectionId: "test", providerSpecificData: {} });
  mocks.execute.mockImplementation(async ({ model, body, stream, credentials }) => {
    const content = model === "gpt-4o-mini" ? '{"tier":"COMPLEX"}' : "final answer";
    const usage = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 };
    const chunk = { id: "chatcmpl-test", model, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: "stop" }], usage };
    return {
      response: credentials.runtimeTransport?.format === "claude"
        ? Response.json({ id: "msg-test", type: "message", role: "assistant", model, content: [{ type: "text", text: content }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 5 } })
        : stream
        ? new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
        : Response.json({ id: "chatcmpl-test", model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage }),
      url: "https://provider.invalid/v1/chat/completions", headers: {}, transformedBody: body,
    };
  });
});

describe("auto-routing chat integration", () => {
  it("recognizes auto-router with an empty emergency pool", async () => {
    mocks.combos["auto-router"] = { name: "auto-router", models: [] };
    mocks.settings.comboStrategies["auto-router"] = mocks.settings.comboStrategies.smart;
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST", body: JSON.stringify({ model: "auto-router", stream: false, messages: [{ role: "user", content: "hello" }] }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.execute.mock.calls.map(([args]) => args.model)).toEqual(["gpt-4o-mini", "deepseek-chat"]);
  });
  it.each([
    ["/v1/messages", { messages: [{ role: "user", content: "Design an auth system" }], system: "caller system", max_tokens: 200, tools: [{ name: "read", input_schema: { type: "object" } }] }],
    ["/v1/responses", { input: "Design an auth system", instructions: "caller system", tools: [{ type: "function", name: "read", parameters: { type: "object" } }] }],
    ["/v1/chat/completions", { messages: [{ role: "user", content: "Design an auth system" }], tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }] }],
  ])("isolates classifier format and accounts for both calls from %s", async (endpoint, fields) => {
    const request = new Request(`http://localhost${endpoint}`, { method: "POST", headers: { "content-type": "application/json", "x-session-id": "client-session", "user-agent": "claude-code", authorization: "Bearer caller-key" }, body: JSON.stringify({ model: "smart", stream: false, ...fields }) });
    const response = await handleChat(request);
    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(JSON.stringify(result)).toContain("final answer");
    if (endpoint === "/v1/messages") expect(result.content[0].text).toBe("final answer");
    if (endpoint === "/v1/responses") expect(result.output[0].content[0].text).toBe("final answer");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const first = handleChatCore.mock.calls[0][0];
    expect(first.sourceFormatOverride).toBe("openai");
    expect(first.body.stream).toBe(false);
    expect(first.body.tools).toBeUndefined();
    expect(first.clientRawRequest.headers).toEqual({ accept: "application/json", "x-session-id": expect.stringMatching(/^auto-routing:/) });
    expect(first.clientRawRequest.headers["x-session-id"]).not.toBe("client-session");
    expect(first.apiKey).toBe("caller-key");
    expect(first.providerThinking).toBeNull();
    for (const option of ["rtkEnabled", "headroomEnabled", "cavemanEnabled", "ponytailEnabled", "pxpipeEnabled"]) expect(first[option]).toBe(false);
    expect(mocks.usage).toHaveBeenCalledTimes(2);
    expect(mocks.usage.mock.calls.map(([usage]) => usage.model)).toEqual(["gpt-4o-mini", "deepseek-chat"]);
    expect(mocks.usage.mock.calls.every(([usage]) => usage.apiKey === "caller-key")).toBe(true);
  });
  it("aborts the executor at the classifier deadline and never retries its account", async () => {
    mocks.settings.comboStrategies.smart.autoRouting.timeoutMs = 25;
    let classifierSignal;
    const normalExecute = mocks.execute.getMockImplementation();
    mocks.execute.mockImplementation(async (args) => {
      if (args.model !== "gpt-4o-mini") return normalExecute(args);
      classifierSignal = args.signal;
      return new Promise((_, reject) => args.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "smart", stream: false, messages: [{ role: "user", content: "hello" }] }) }));
    expect(response.ok).toBe(true);
    expect(classifierSignal.aborted).toBe(true);
    expect(mocks.execute.mock.calls.map(([args]) => args.model)).toEqual(["gpt-4o-mini", "emergency"]);
    expect(mocks.markUnavailable).not.toHaveBeenCalled();
  });
  it("streams only the selected completion and preserves its tools", async () => {
    const tools = [{ type: "function", function: { name: "read", parameters: { type: "object" } } }];
    const response = await handleChat(new Request("http://localhost/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "smart", stream: true, tools, messages: [{ role: "user", content: "Design an auth system" }] }) }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("final answer");
    expect(text).not.toContain("COMPLEX");
    expect(handleChatCore.mock.calls[1][0].body.tools).toEqual(tools);
    expect(handleChatCore.mock.calls[1][0].body.stream).toBe(true);
  });
  it("aborts a selected completion without starting another account or emergency model", async () => {
    const controller = new AbortController();
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const normalExecute = mocks.execute.getMockImplementation();
    mocks.execute.mockImplementation(async (args) => {
      if (args.model === "gpt-4o-mini") return normalExecute(args);
      started();
      return new Promise((_, reject) => args.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    });
    const pending = handleChat(new Request("http://localhost/v1/chat/completions", { method: "POST", signal: controller.signal, body: JSON.stringify({ model: "smart", stream: false, messages: [{ role: "user", content: "hello" }] }) }));
    await ready;
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(mocks.execute.mock.calls.map(([args]) => args.model)).toEqual(["gpt-4o-mini", "deepseek-chat"]);
    expect(mocks.markUnavailable).not.toHaveBeenCalled();
  });
  it("classifies Gemini contents and returns the completion in Gemini format", async () => {
    const response = await handleGemini(new Request("http://localhost/v1beta/models/smart:streamGenerateContent", { method: "POST", body: JSON.stringify({
      model: "smart", contents: [{ role: "user", parts: [{ text: "Design an auth system" }] }],
    }) }), { params: Promise.resolve({ path: ["smart:streamGenerateContent"] }) });
    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toContain("candidates");
    expect(text).toContain("final answer");
    expect(text).not.toContain("COMPLEX");
    expect(handleChatCore.mock.calls[0][0].sourceFormatOverride).toBe("openai");
    expect(handleChatCore.mock.calls[1][0].body.messages[0].content).toBe("Design an auth system");
  });
});
