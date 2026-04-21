import { afterEach, describe, expect, it, vi } from "vitest";

describe("Codex usage parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("omits session quota when primary_window is absent and keeps weekly quota", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          plan_type: "free",
          rate_limit: {
            secondary_window: {
              used_percent: 100,
              reset_at: 1760000000,
            },
          },
        }),
      }))
    );

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");

    const result = await getUsageForProvider({
      provider: "codex",
      accessToken: "token",
      providerSpecificData: {},
    });

    expect(result.quotas.session).toBeUndefined();
    expect(result.quotas.weekly).toEqual(
      expect.objectContaining({
        used: 100,
        total: 100,
        remaining: 0,
      })
    );
  });

  it("keeps both session and weekly quotas when both windows exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          plan_type: "pro",
          rate_limit: {
            primary_window: {
              used_percent: 40,
              reset_at: 1760000000,
            },
            secondary_window: {
              used_percent: 65,
              reset_at: 1761000000,
            },
          },
        }),
      }))
    );

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");

    const result = await getUsageForProvider({
      provider: "codex",
      accessToken: "token",
      providerSpecificData: {},
    });

    expect(result.quotas.session).toEqual(
      expect.objectContaining({ used: 40, remaining: 60 })
    );
    expect(result.quotas.weekly).toEqual(
      expect.objectContaining({ used: 65, remaining: 35 })
    );
  });
});
