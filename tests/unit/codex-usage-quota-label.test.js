import { describe, it, expect, vi, afterEach } from "vitest";

const originalFetch = global.fetch;

describe("Codex usage quota labels", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("labels a standalone primary window as primary instead of session", async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plan_type: "pro",
        rate_limit: {
          primary_window: {
            used_percent: 28,
            reset_at: nowSec + 46 * 3600,
          },
        },
      }),
    }));

    const { getUsageForProvider } = await import("../../src/lib/open-sse/services/usage.js");
    const result = await getUsageForProvider({ provider: "codex", accessToken: "token" });

    expect(result.quotas.primary).toBeDefined();
    expect(result.quotas.session).toBeUndefined();
  });
});
