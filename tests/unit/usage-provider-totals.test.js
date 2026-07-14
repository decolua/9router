import { describe, expect, it, vi, beforeEach } from "vitest";

// Stub driver before importing the repo under test
vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => ({
    get: vi.fn((sql, params) => {
      // Return deterministic aggregate based on params length (presence of connectionId)
      if (params && params.length >= 2) {
        return { requests: 7, promptTokens: 1234, completionTokens: 56 };
      }
      return { requests: 42, promptTokens: 98765, completionTokens: 4321 };
    }),
    all: vi.fn(() => []),
    run: vi.fn(),
  })),
}));

const { getProviderUsageTotals } = await import("../../src/lib/db/repos/usageRepo.js");

describe("getProviderUsageTotals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates all-time usage when no connectionId or since is provided", async () => {
    const r = await getProviderUsageTotals({ provider: "xai" });
    expect(r).toEqual({
      requests: 42,
      promptTokens: 98765,
      completionTokens: 4321,
      totalTokens: 98765 + 4321,
    });
  });

  it("filters by connectionId when supplied", async () => {
    const r = await getProviderUsageTotals({
      provider: "xai",
      connectionId: "conn-xyz",
    });
    expect(r).toEqual({
      requests: 7,
      promptTokens: 1234,
      completionTokens: 56,
      totalTokens: 1234 + 56,
    });
  });

  it("handles zero rows gracefully", async () => {
    // Force the stub to return empty row
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    getAdapter.mockResolvedValueOnce({
      get: vi.fn(() => ({})),
      all: vi.fn(() => []),
      run: vi.fn(),
    });
    const r = await getProviderUsageTotals({ provider: "xai" });
    expect(r).toEqual({ requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });
});
