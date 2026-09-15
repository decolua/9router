import { describe, expect, it, vi, beforeEach } from "vitest";

const balanceUsage = vi.fn();
const desktopUsage = vi.fn();

vi.mock("../../open-sse/services/usage/xiaomiMimo.js", () => ({
  getXiaomiMimoUsage: balanceUsage,
}));
vi.mock("../../open-sse/services/usage/xiaomi-mimo.js", () => ({
  getXiaomiMimoUsage: desktopUsage,
}));

const { getUsageForProvider } = await import("../../open-sse/services/usage.js");

describe("MiMo usage composition", () => {
  beforeEach(() => {
    balanceUsage.mockReset();
    desktopUsage.mockReset();
  });

  it("returns only the console balance when that credential is present", async () => {
    balanceUsage.mockResolvedValue({ plan: "API balance", quotas: { "Available balance (CNY)": { total: 12 } } });
    const result = await getUsageForProvider({ provider: "xiaomi-mimo", providerSpecificData: { quotaCookie: "fixture-cookie" } });
    expect(result).toEqual({ plan: "API balance", quotas: { "Available balance (CNY)": { total: 12 } } });
    expect(desktopUsage).not.toHaveBeenCalled();
  });

  it("returns only Desktop weekly quota when its pass token is present", async () => {
    desktopUsage.mockResolvedValue({ plan: "Xiaomi MiMo Desktop", quotas: { Weekly: { total: 100, remainingPercentage: 75 } } });
    const result = await getUsageForProvider({ provider: "xiaomi-mimo", providerSpecificData: { mimoPassToken: "fixture-pass" } });
    expect(result).toEqual({ plan: "Xiaomi MiMo Desktop", quotas: { Weekly: { total: 100, remainingPercentage: 75 } } });
    expect(balanceUsage).not.toHaveBeenCalled();
  });

  it("keeps both sources and their units when both credentials are present", async () => {
    balanceUsage.mockResolvedValue({ plan: "API balance", quotas: { "Available balance (CNY)": { total: 12 } } });
    desktopUsage.mockResolvedValue({ plan: "Xiaomi MiMo Desktop", quotas: { Weekly: { total: 100, remainingPercentage: 75 } } });
    const result = await getUsageForProvider({
      provider: "xiaomi-mimo",
      providerSpecificData: { quotaCookie: "fixture-cookie", mimoPassToken: "fixture-pass" },
    });
    expect(result).toEqual({
      plan: "API balance + Xiaomi MiMo Desktop",
      quotas: {
        "Available balance (CNY)": { total: 12 },
        Weekly: { total: 100, remainingPercentage: 75 },
      },
    });
  });

  it("reports neutral empty usage without credentials", async () => {
    const result = await getUsageForProvider({ provider: "xiaomi-mimo", providerSpecificData: {} });
    expect(result).toEqual({
      message: "MiMo usage unavailable: no applicable account session or console cookie is configured.",
      quotas: {},
    });
    expect(balanceUsage).not.toHaveBeenCalled();
    expect(desktopUsage).not.toHaveBeenCalled();
  });

  it("preserves one source when the other source fails", async () => {
    balanceUsage.mockRejectedValue(new Error("fixture balance failure"));
    desktopUsage.mockResolvedValue({ plan: "Xiaomi MiMo Desktop", quotas: { Weekly: { total: 100, remainingPercentage: 75 } } });
    const result = await getUsageForProvider({
      provider: "xiaomi-mimo",
      providerSpecificData: { quotaCookie: "fixture-cookie", mimoPassToken: "fixture-pass" },
    });
    expect(result).toEqual({
      plan: "Xiaomi MiMo Desktop",
      quotas: { Weekly: { total: 100, remainingPercentage: 75 } },
      message: "MiMo balance unavailable: fixture balance failure",
    });
  });
});
