import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Gemini CLI usage project id resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the projectId stored on the provider connection", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      buckets: [
        {
          modelId: "gemini-3-flash-preview",
          remainingFraction: 0.75,
          resetTime: "2026-05-25T12:00:00Z",
        },
      ],
    }));

    const usage = await getUsageForProvider({
      provider: "gemini-cli",
      accessToken: "token",
      projectId: "cloud-code-project",
    });

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
      expect.objectContaining({
        body: JSON.stringify({ project: "cloud-code-project" }),
      }),
      null
    );
    expect(usage.quotas["gemini-3-flash-preview"]).toMatchObject({
      used: 250,
      total: 1000,
      remainingPercentage: 75,
    });
  });

  it("normalizes project objects returned by loadCodeAssist", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        cloudaicompanionProject: { id: "project-from-load" },
        currentTier: { name: "Free" },
      }))
      .mockResolvedValueOnce(jsonResponse({ buckets: [] }));

    await getUsageForProvider({
      provider: "gemini-cli",
      accessToken: "token",
    });

    expect(proxyAwareFetch).toHaveBeenLastCalledWith(
      "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
      expect.objectContaining({
        body: JSON.stringify({ project: "project-from-load" }),
      }),
      null
    );
  });

  it("returns actionable guidance when no project id is available", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({}));

    const usage = await getUsageForProvider({
      provider: "gemini-cli",
      accessToken: "token",
    });

    expect(usage.message).toContain("Reconnect Gemini CLI");
    expect(usage.message).toContain("Gemini Code Assist");
  });
});
