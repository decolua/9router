import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { extractRouterSelectedModel } = await import("../../open-sse/handlers/chatCore.js");

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
});
