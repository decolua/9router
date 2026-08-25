import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { attachActualModelHeader, extractRouterSelectedModel } = await import("../../open-sse/handlers/chatCore.js");

const responseWithHeader = (value) => ({
  headers: { get: () => value }
});

describe("LLMRouter selected model response metadata", () => {
  it("accepts a printable model identifier", () => {
    expect(extractRouterSelectedModel(responseWithHeader("  glm  "))).toBe("glm");
  });

  it("ignores missing, unsafe, and oversized values", () => {
    expect(extractRouterSelectedModel(responseWithHeader(null))).toBeNull();
    expect(extractRouterSelectedModel(responseWithHeader("glm\nqwen"))).toBeNull();
    expect(extractRouterSelectedModel(responseWithHeader("x".repeat(257)))).toBeNull();
  });

  it("exposes the final 9router model to nested routers", () => {
    const result = { success: true, response: Response.json({ ok: true }) };

    attachActualModelHeader(result, "DeepSeek-V4-Pro");

    expect(result.response.headers.get("x-9router-actual-model")).toBe("DeepSeek-V4-Pro");
  });

  it("does not expose unsafe actual model values", () => {
    const result = { success: true, response: Response.json({ ok: true }) };

    attachActualModelHeader(result, "deepseek\ninvalid");

    expect(result.response.headers.get("x-9router-actual-model")).toBeNull();
  });
});
