import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

describe("Codex usage windows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves upstream window duration so consumers can label 5h and 7d correctly", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        plan_type: "team",
        rate_limit: {
          primary_window: {
            used_percent: 7,
            limit_window_seconds: 18000,
            reset_at: 1785623016,
          },
          secondary_window: {
            used_percent: 19,
            limit_window_seconds: 604800,
            reset_at: 1785678428,
          },
        },
      }),
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");

    await expect(getCodexUsage("token")).resolves.toMatchObject({
      quotas: {
        session: { used: 7, windowSeconds: 18000 },
        weekly: { used: 19, windowSeconds: 604800 },
      },
    });
  });
});
