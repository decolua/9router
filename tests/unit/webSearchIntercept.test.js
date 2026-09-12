// Layer 0 of the native web_search redirect: response interception. The search executor
// and credential services are mocked; what is verified is call extraction, the
// /v1-search argument mapping, and the per-format response rewrite.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleSearchCore: vi.fn(),
  getSettings: vi.fn(),
  getCombos: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: mocks.updateProviderCredentials,
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getCombos: mocks.getCombos,
}));
vi.mock("@/shared/constants/providers.js", () => ({
  AI_PROVIDERS: {
    tavily: { searchConfig: { endpoint: "https://x" } },
    gemini: { searchViaChat: true },
    doodleo: { noAuth: true, searchConfig: {} },
  },
  resolveProviderId: (p) => String(p).split("/").pop(),
}));
vi.mock("open-sse/handlers/search/index.js", () => ({
  handleSearchCore: mocks.handleSearchCore,
}));

const { applyWebSearchFallback } = await import("open-sse/handlers/chatCore/webSearchIntercept.js");

const PLAN = { enabled: true, toolName: "9router_web_search", convertedToolCount: 1 };
const SEARCH_DATA = {
  provider: "tavily",
  query: "latest ai news",
  results: [{ title: "A", url: "https://a", snippet: "s" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ webSearchFallbackProvider: "tavily" });
  mocks.getCombos.mockResolvedValue([]);
  mocks.getProviderCredentials.mockResolvedValue({ connectionId: "c1", accessToken: "t" });
  mocks.checkAndRefreshToken.mockResolvedValue({ accessToken: "t" });
  mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
  mocks.handleSearchCore.mockResolvedValue({ success: true, data: SEARCH_DATA });
});

describe("applyWebSearchFallback", () => {
  it("rewrites a Claude response: tool_use becomes a text block with the search result", async () => {
    const response = {
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "Let me search." },
        { type: "tool_use", id: "tu_1", name: "9router_web_search", input: { query: "latest ai news", max_results: 5 } },
      ],
      stop_reason: "tool_use",
    };
    const out = await applyWebSearchFallback({ translatedResponse: response, sourceFormat: "claude", fallbackPlan: PLAN, log: {} });

    const coreArg = mocks.handleSearchCore.mock.calls[0][0];
    expect(coreArg.body.query).toBe("latest ai news");
    expect(coreArg.body.provider).toBe("tavily");
    expect(coreArg.credentials.accessToken).toBe("t");

    expect(out.content[0]).toEqual({ type: "text", text: "Let me search." });
    expect(out.content[1].type).toBe("text");
    const payload = JSON.parse(out.content[1].text.replace("[Skill result: 9router_web_search]\n", ""));
    expect(payload.success).toBe(true);
    expect(payload.results).toHaveLength(1);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.stop_sequence).toBeNull();
  });

  it("preserves a remaining client-owned tool_use after the injected result", async () => {
    const response = {
      type: "message",
      content: [
        { type: "tool_use", id: "tu_1", name: "9router_web_search", input: { query: "q" } },
        { type: "tool_use", id: "tu_2", name: "Read", input: { path: "x" } },
      ],
      stop_reason: "tool_use",
    };
    const out = await applyWebSearchFallback({ translatedResponse: response, sourceFormat: "claude", fallbackPlan: PLAN, log: {} });
    expect(out.content.map((b) => b.type)).toEqual(["text", "tool_use"]);
    expect(out.content[1].id).toBe("tu_2");
    expect(out.stop_reason).toBe("tool_use"); // not rewritten while a real tool_use remains
  });

  it("appends function_call_output for a Responses client", async () => {
    const response = {
      object: "response",
      output: [{ type: "function_call", call_id: "call_1", name: "9router_web_search", arguments: "{\"query\":\"q\"}" }],
    };
    const out = await applyWebSearchFallback({ translatedResponse: response, sourceFormat: "openai-responses", fallbackPlan: PLAN, log: {} });
    const outputTypes = out.output.map((o) => o.type);
    expect(outputTypes).toContain("function_call_output");
    expect(outputTypes).toContain("web_search_call");
    const fnOutput = out.output.find((o) => o.type === "function_call_output");
    expect(JSON.parse(fnOutput.output).results).toHaveLength(1);
  });

  it("attaches tool_results for an OpenAI Chat client", async () => {
    const response = {
      choices: [{ message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "9router_web_search", arguments: "{\"query\":\"q\"}" } }] }, finish_reason: "tool_calls" }],
    };
    const out = await applyWebSearchFallback({ translatedResponse: response, sourceFormat: "openai", fallbackPlan: PLAN, log: {} });
    expect(out.tool_results).toHaveLength(1);
    expect(out.tool_results[0].tool_call_id).toBe("c1");
    expect(out.choices[0].message.tool_calls).toHaveLength(1);
  });

  it("maps domain filters to the -domain exclusion convention", async () => {
    const response = { type: "message", content: [{ type: "tool_use", id: "t", name: PLAN.toolName, input: { query: "q", filters: { include_domains: ["x.com"], exclude_domains: ["y.com"] } } }] };
    await applyWebSearchFallback({ translatedResponse: response, sourceFormat: "claude", fallbackPlan: PLAN, log: {} });
    expect(mocks.handleSearchCore.mock.calls[0][0].body.domain_filter).toEqual(["x.com", "-y.com"]);
  });

  it("passes a search failure through as an error payload without throwing", async () => {
    mocks.handleSearchCore.mockResolvedValue({ success: false, status: 503, error: "up down" });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    const response = { type: "message", content: [{ type: "tool_use", id: "t", name: PLAN.toolName, input: { query: "q" } }] };
    const out = await applyWebSearchFallback({ translatedResponse: response, sourceFormat: "claude", fallbackPlan: PLAN, log: {} });
    const payload = JSON.parse(out.content[0].text.split("\n")[1]);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe("up down");
  });

  it("is a no-op when the model never called the fallback tool", async () => {
    const response = { type: "message", content: [{ type: "text", text: "done" }], stop_reason: "end_turn" };
    const out = await applyWebSearchFallback({ translatedResponse: response, sourceFormat: "claude", fallbackPlan: PLAN, log: {} });
    expect(out).toBe(response);
    expect(mocks.handleSearchCore).not.toHaveBeenCalled();
  });

  it("skips disabled plans and unknown tool names", async () => {
    expect(await applyWebSearchFallback({ translatedResponse: { a: 1 }, sourceFormat: "claude", fallbackPlan: { enabled: false }, log: {} })).toEqual({ a: 1 });
    const response = { type: "message", content: [{ type: "tool_use", id: "t", name: "Other", input: {} }] };
    const out = await applyWebSearchFallback({ translatedResponse: response, sourceFormat: "claude", fallbackPlan: PLAN, log: {} });
    expect(out).toBe(response);
  });

  it("uses noAuth providers without touching the credential loop", async () => {
    mocks.getSettings.mockResolvedValue({ webSearchFallbackProvider: "doodleo" });
    const response = { type: "message", content: [{ type: "tool_use", id: "t", name: PLAN.toolName, input: { query: "q" } }] };
    await applyWebSearchFallback({ translatedResponse: response, sourceFormat: "claude", fallbackPlan: PLAN, log: {} });
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.handleSearchCore.mock.calls[0][0].credentials).toBeNull();
  });
});
