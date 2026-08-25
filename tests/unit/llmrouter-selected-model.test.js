import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { attachActualRouteHeaders, extractRouterSelectedModel, extractRouterSelectedProvider } = await import("../../open-sse/handlers/chatCore.js");

const responseWithHeaders = (headers) => ({
  headers: { get: (name) => headers[name] ?? null }
});

describe("LLMRouter selected route response metadata", () => {
  it("accepts printable model and provider identifiers", () => {
    const response = responseWithHeaders({
      "x-llmrouter-selected-model": "  glm  ",
      "x-llmrouter-selected-provider": "  deepseek  ",
    });

    expect(extractRouterSelectedModel(response)).toBe("glm");
    expect(extractRouterSelectedProvider(response)).toBe("deepseek");
  });

  it("ignores missing, unsafe, and oversized values", () => {
    expect(extractRouterSelectedModel(responseWithHeaders({}))).toBeNull();
    expect(extractRouterSelectedModel(responseWithHeaders({ "x-llmrouter-selected-model": "glm\nqwen" }))).toBeNull();
    expect(extractRouterSelectedProvider(responseWithHeaders({ "x-llmrouter-selected-provider": "x".repeat(257) }))).toBeNull();
  });

  it("exposes the final 9router route to nested routers", () => {
    const result = { success: true, response: Response.json({ ok: true }) };

    attachActualRouteHeaders(result, { actualModel: "DeepSeek-V4-Pro", actualProvider: "deepseek" });

    expect(result.response.headers.get("x-9router-actual-model")).toBe("DeepSeek-V4-Pro");
    expect(result.response.headers.get("x-9router-actual-provider")).toBe("deepseek");
  });

  it("does not expose unsafe actual route values", () => {
    const result = { success: true, response: Response.json({ ok: true }) };

    attachActualRouteHeaders(result, { actualModel: "deepseek\ninvalid", actualProvider: "provider\ninvalid" });

    expect(result.response.headers.get("x-9router-actual-model")).toBeNull();
    expect(result.response.headers.get("x-9router-actual-provider")).toBeNull();
  });
});
