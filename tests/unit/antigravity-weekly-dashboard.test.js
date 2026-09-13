import { describe, it, expect } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Antigravity dashboard normalization with pool-grouped quotas", () => {
  const data = {
    quotas: {
      gemini_weekly: {
        displayName: "Gemini (Weekly)",
        used: 250,
        total: 1000,
        resetAt: "2026-09-15T00:00:00Z",
        remainingPercentage: 75,
      },
      gemini_5h: {
        displayName: "Gemini (5h)",
        used: 10,
        total: 1000,
        resetAt: "2026-09-08T03:00:00Z",
        remainingPercentage: 99,
      },
      claude_gpt_weekly: {
        displayName: "Claude & GPT (Weekly)",
        used: 500,
        total: 1000,
        resetAt: "2026-09-14T00:00:00Z",
        remainingPercentage: 50,
      },
      claude_gpt_5h: {
        displayName: "Claude & GPT (5h)",
        used: 0,
        total: 1000,
        resetAt: "2026-09-08T03:00:00Z",
        remainingPercentage: 100,
      },
    },
  };

  it("renders one row per pool window, never per-model rows", () => {
    const quotas = parseQuotaData("antigravity", data);
    const keys = quotas.map((q) => q.modelKey);

    expect(keys).toContain("gemini_weekly");
    expect(keys).toContain("gemini_5h");
    expect(keys).toContain("claude_gpt_weekly");
    expect(keys).toContain("claude_gpt_5h");
    // Per-model entries (from the same fetch) must never leak into the UI.
    expect(quotas).toHaveLength(4);
  });

  it("pool window rows carry correct quota values", () => {
    const quotas = parseQuotaData("antigravity", data);
    const geminiWeekly = quotas.find((q) => q.modelKey === "gemini_weekly");
    const claudeWeekly = quotas.find((q) => q.modelKey === "claude_gpt_weekly");
    const gemini5h = quotas.find((q) => q.modelKey === "gemini_5h");

    expect(geminiWeekly).toMatchObject({
      used: 250,
      total: 1000,
      remainingPercentage: 75,
      resetAt: "2026-09-15T00:00:00Z",
    });
    expect(claudeWeekly).toMatchObject({
      used: 500,
      total: 1000,
      remainingPercentage: 50,
      resetAt: "2026-09-14T00:00:00Z",
    });
    expect(gemini5h).toMatchObject({
      remainingPercentage: 99,
    });
  });

  it("renders rows in 5h-then-weekly order per pool", () => {
    const quotas = parseQuotaData("antigravity", {
      quotas: {
        claude_gpt_weekly: { used: 0, total: 1000, remainingPercentage: 40, resetAt: "2026-09-14T00:00:00Z" },
        gemini_weekly: { used: 100, total: 1000, remainingPercentage: 90, resetAt: "2026-09-15T00:00:00Z" },
        gemini_5h: { used: 50, total: 1000, remainingPercentage: 95, resetAt: "2026-09-08T03:00:00Z" },
        claude_gpt_5h: { used: 0, total: 1000, remainingPercentage: 100, resetAt: "2026-09-08T03:00:00Z" },
      },
    });
    expect(quotas.map((q) => q.modelKey)).toEqual([
      "gemini_5h", "gemini_weekly", "claude_gpt_5h", "claude_gpt_weekly",
    ]);
  });

  it("free-tier snapshot (weekly only, no 5h) renders two rows", () => {
    const freeTier = {
      quotas: {
        gemini_weekly: { displayName: "Gemini (Weekly)", used: 0, total: 1000, remainingPercentage: 100, resetAt: "2026-09-15T00:00:00Z" },
        claude_gpt_weekly: { displayName: "Claude & GPT (Weekly)", used: 1000, total: 1000, remainingPercentage: 0, resetAt: "2026-09-14T00:00:00Z" },
      },
    };
    const quotas = parseQuotaData("antigravity", freeTier);
    expect(quotas).toHaveLength(2);
    expect(quotas.map((q) => q.modelKey)).toEqual(["gemini_weekly", "claude_gpt_weekly"]);
  });

  it("hides disabled 5h windows entirely (matches official Antigravity UI)", () => {
    // Upstream marks the 5h window disabled:true once the weekly limit is
    // hit. The official Antigravity app hides that row; the weekly row
    // already tells the story — the dashboard does the same.
    const quotas = parseQuotaData("antigravity", {
      quotas: {
        claude_gpt_weekly: { used: 1000, total: 1000, remainingPercentage: 0, resetAt: "2026-09-14T00:00:00Z" },
        claude_gpt_5h: { used: 0, total: 1000, remainingPercentage: 0, resetAt: "2026-09-08T03:00:00Z", disabled: true },
      },
    });
    expect(quotas).toHaveLength(1);
    expect(quotas[0].modelKey).toBe("claude_gpt_weekly");
  });

  it("falls back to one derived row per family when only per-model entries exist (legacy cache)", () => {
    const legacy = {
      quotas: {
        "gemini-pro-agent": { displayName: "Gemini 3.1 Pro (High)", used: 200, total: 1000, resetAt: "2026-09-08T00:00:00Z", remainingPercentage: 80 },
        "claude-opus-4-6-thinking": { displayName: "Claude Opus 4.6 (Thinking)", used: 100, total: 1000, resetAt: "2026-09-08T00:00:00Z", remainingPercentage: 90 },
      },
    };
    const quotas = parseQuotaData("antigravity", legacy);
    expect(quotas).toHaveLength(2);
    const names = quotas.map((q) => q.name);
    expect(names).toContain("Gemini (Weekly)");
    expect(names).toContain("Claude & GPT (Weekly)");
    // Derived rows take the family's worst remaining percentage.
    const gemini = quotas.find((q) => q.modelKey === "gemini_weekly");
    expect(gemini?.remainingPercentage).toBe(80);
  });

  it("returns nothing for an empty quotas map", () => {
    expect(parseQuotaData("antigravity", { quotas: {} })).toHaveLength(0);
  });
});
