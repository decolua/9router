import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/localDb", () => ({
  resolveApiKeyRecord: vi.fn(),
  getMonthlyUsageForKey: vi.fn(),
}));

const { checkModelAllowed, checkMonthlyLimits } = await import(
  "../../src/sse/services/keyPolicy.js"
);
const { getMonthlyUsageForKey } = await import("@/lib/localDb");

describe("checkModelAllowed", () => {
  it("allows when no record provided", () => {
    expect(checkModelAllowed(null, "openai/gpt-4o", { provider: "openai", model: "gpt-4o" })).toEqual({
      allowed: true,
    });
  });

  it("allows when both allow-lists are empty", () => {
    const r = { allowedModels: [], allowedProviders: [] };
    expect(
      checkModelAllowed(r, "openai/gpt-4o", { provider: "openai", model: "gpt-4o" })
    ).toEqual({ allowed: true });
  });

  it("blocks when provider not in non-empty allowedProviders", () => {
    const r = { allowedModels: [], allowedProviders: ["openai"] };
    const out = checkModelAllowed(r, "kr/claude-sonnet-4.5", {
      provider: "kr",
      model: "claude-sonnet-4.5",
    });
    expect(out.allowed).toBe(false);
  });

  it("allows when raw model is in allowedModels", () => {
    const r = { allowedModels: ["kr/claude-sonnet-4.5"], allowedProviders: [] };
    expect(
      checkModelAllowed(r, "kr/claude-sonnet-4.5", {
        provider: "kr",
        model: "claude-sonnet-4.5",
      })
    ).toEqual({ allowed: true });
  });

  it("allows when resolved provider/model is in allowedModels (bare resolved model)", () => {
    const r = { allowedModels: ["gpt-4o-mini"], allowedProviders: [] };
    expect(
      checkModelAllowed(r, "openai/gpt-4o-mini", {
        provider: "openai",
        model: "gpt-4o-mini",
      }).allowed
    ).toBe(true);
  });

  it("AND-combines provider and model lists when both non-empty", () => {
    const r = { allowedModels: ["openai/gpt-4o-mini"], allowedProviders: ["openai"] };
    expect(
      checkModelAllowed(r, "openai/gpt-4o-mini", {
        provider: "openai",
        model: "gpt-4o-mini",
      }).allowed
    ).toBe(true);

    // Provider mismatch → blocked at provider check even if model matches.
    const r2 = { allowedModels: ["openai/gpt-4o-mini"], allowedProviders: ["anthropic"] };
    const out = checkModelAllowed(r2, "openai/gpt-4o-mini", {
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(out.allowed).toBe(false);
  });
});

describe("checkMonthlyLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns allowed when both limits are 0/null", async () => {
    const out = await checkMonthlyLimits({ monthlyTokenLimit: 0, monthlyBudgetUsd: 0 }, "sk-test");
    expect(out).toEqual({ allowed: true });
  });

  it("blocks at token cap with scope=tokens", async () => {
    getMonthlyUsageForKey.mockResolvedValue({ tokens: 100, cost: 0, requests: 1 });
    const out = await checkMonthlyLimits({ monthlyTokenLimit: 100, monthlyBudgetUsd: 0 }, "sk-test");
    expect(out.allowed).toBe(false);
    expect(out.scope).toBe("tokens");
  });

  it("blocks at budget cap with scope=budget", async () => {
    getMonthlyUsageForKey.mockResolvedValue({ tokens: 0, cost: 5.01, requests: 1 });
    const out = await checkMonthlyLimits({ monthlyTokenLimit: 0, monthlyBudgetUsd: 5 }, "sk-test");
    expect(out.allowed).toBe(false);
    expect(out.scope).toBe("budget");
  });

  it("fail-open on DB error", async () => {
    getMonthlyUsageForKey.mockRejectedValue(new Error("db gone"));
    const out = await checkMonthlyLimits({ monthlyTokenLimit: 1, monthlyBudgetUsd: 0 }, "sk-test");
    expect(out.allowed).toBe(true);
  });

  it("returns allowed when no record", async () => {
    const out = await checkMonthlyLimits(null, "sk-test");
    expect(out).toEqual({ allowed: true });
  });
});
