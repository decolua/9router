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

  it("checks quota for the same stored project used by generation", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    await getAntigravityUsage("access-token", { projectId: "stored-project" });

    const quotaCall = proxyAwareFetch.mock.calls.find(([url]) => url.includes(":fetchAvailableModels"));
    expect(JSON.parse(quotaCall[1].body)).toEqual({ project: "stored-project" });
  });

  it("marks Antigravity quota as percentage-only because Google exposes no absolute count", async () => {
    proxyAwareFetch
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ cloudaicompanionProject: "project-1", currentTier: { name: "Pro" } }),
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          models: {
            "gemini-3.1-flash-image": {
              displayName: "Gemini 3.1 Flash Image",
              quotaInfo: { remainingFraction: 1, resetTime: "2026-07-22T09:40:57Z" },
            },
          },
        }),
      }));

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.quotas["gemini-3.1-flash-image"]).toMatchObject({
      remainingPercentage: 100,
      percentageOnly: true,
      quotaNote: "Google does not expose the exact remaining image-generation count.",
    });
  });
});
