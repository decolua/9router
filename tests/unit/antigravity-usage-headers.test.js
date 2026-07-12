import { describe, it, expect, vi, beforeEach } from "vitest";

const proxyAwareFetch = vi.fn(async (url) => ({
  ok: true,
  status: 200,
  json: async () => url.includes(":loadCodeAssist")
    ? { cloudaicompanionProject: "project-1", currentTier: { name: "Pro" } }
    : { models: {} },
  text: async () => "{}",
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Antigravity usage headers", () => {
  beforeEach(() => proxyAwareFetch.mockClear());

  it("uses the official IDE user agent and omits router-only source headers", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    await getAntigravityUsage("access-token", {});

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    for (const [, options] of proxyAwareFetch.mock.calls) {
      expect(options.headers["User-Agent"]).toBe("antigravity/ide/2.1.1 darwin/arm64");
      expect(options.headers).not.toHaveProperty("x-request-source");
    }
  });
});
