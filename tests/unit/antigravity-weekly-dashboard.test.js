import { describe, it, expect } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Antigravity dashboard normalization with weekly quotas", () => {
  const data = {
    quotas: {
      "gemini-pro-agent": {
        displayName: "Gemini 3.1 Pro (High)",
        used: 200,
        total: 1000,
        resetAt: "2026-09-08T00:00:00Z",
        remainingPercentage: 80,
      },
      "claude-opus-4-6-thinking": {
        displayName: "Claude Opus 4.6 (Thinking)",
        used: 100,
        total: 1000,
        resetAt: "2026-09-08T00:00:00Z",
        remainingPercentage: 90,
      },
      gemini_weekly: {
        displayName: "Gemini (Weekly)",
        used: 250,
        total: 1000,
        resetAt: "2026-09-15T00:00:00Z",
        remainingPercentage: 75,
      },
      claude_gpt_weekly: {
        displayName: "Claude & GPT (Weekly)",
        used: 500,
        total: 1000,
        resetAt: "2026-09-14T00:00:00Z",
        remainingPercentage: 50,
      },
    },
  };

  it("includes weekly rows with correct display names", () => {
    const quotas = parseQuotaData("antigravity", data);
    const names = quotas.map((q) => q.name);

    expect(names).toContain("Gemini (Flash / Pro)");
    expect(names).toContain("Claude (Sonnet / Opus)");
    expect(names).toContain("Gemini (Weekly)");
    expect(names).toContain("Claude & GPT (Weekly)");
  });

  it("uses stable modelKey for weekly rows", () => {
    const quotas = parseQuotaData("antigravity", data);
    const keys = quotas.map((q) => q.modelKey);

    expect(keys).toContain("gemini_weekly");
    expect(keys).toContain("claude_gpt_weekly");
  });

  it("weekly rows carry correct quota values", () => {
    const quotas = parseQuotaData("antigravity", data);
    const geminiWeekly = quotas.find((q) => q.modelKey === "gemini_weekly");
    const claudeWeekly = quotas.find((q) => q.modelKey === "claude_gpt_weekly");

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
  });

  it("weekly rows do NOT appear as otherModels", () => {
    const quotas = parseQuotaData("antigravity", data);
    const weeklyRows = quotas.filter((q) =>
      q.modelKey === "gemini_weekly" || q.modelKey === "claude_gpt_weekly"
    );
    expect(weeklyRows).toHaveLength(2);
    expect(weeklyRows[0].name).toMatch(/Weekly/);
    expect(weeklyRows[1].name).toMatch(/Weekly/);
  });

  it("order: session, weekly, then other models", () => {
    const dataWithBoth = {
      quotas: {
        gemini_session: {
          displayName: "Gemini (5h)",
          used: 100,
          total: 1000,
          resetAt: "2026-09-08T05:00:00Z",
          remainingPercentage: 90,
        },
        gemini_weekly: {
          displayName: "Gemini (Weekly)",
          used: 250,
          total: 1000,
          resetAt: "2026-09-15T00:00:00Z",
          remainingPercentage: 75,
        },
        claude_gpt_session: {
          displayName: "Claude & GPT (5h)",
          used: 50,
          total: 1000,
          resetAt: "2026-09-08T05:00:00Z",
          remainingPercentage: 95,
        },
        claude_gpt_weekly: {
          displayName: "Claude & GPT (Weekly)",
          used: 500,
          total: 1000,
          resetAt: "2026-09-14T00:00:00Z",
          remainingPercentage: 50,
        },
      },
    };
    const quotas = parseQuotaData("antigravity", dataWithBoth);
    const keys = quotas.map((q) => q.modelKey);

    const geminiSessionIdx = keys.indexOf("gemini_session");
    const geminiWeeklyIdx = keys.indexOf("gemini_weekly");
    const claudeSessionIdx = keys.indexOf("claude_gpt_session");
    const claudeWeeklyIdx = keys.indexOf("claude_gpt_weekly");

    expect(geminiSessionIdx).toBeLessThan(geminiWeeklyIdx);
    expect(claudeSessionIdx).toBeLessThan(claudeWeeklyIdx);
  });

  it("excludes redundant duplicates when individual models mirror weekly reset and summary is present", () => {
    // Exact scenario from Christian's account:
    const liveLikeData = {
      quotas: {
        "gemini-3.8-flash-high": { used: 1000, total: 1000, remainingPercentage: 0, resetAt: "2026-09-23T06:00:17Z", displayName: "Gemini 3.8 Flash (High)" },
        "claude-sonnet-4-6": { used: 1000, total: 1000, remainingPercentage: 0, resetAt: "2026-09-20T19:00:21Z", displayName: "Claude 3.7 Sonnet" },
        "gpt-oss-120b-medium": { used: 1000, total: 1000, remainingPercentage: 0, resetAt: "2026-09-20T19:00:21Z", displayName: "GPT-OSS 120B (Medium)" },
        "gemini-3.1-flash-image": { used: 1000, total: 1000, remainingPercentage: 0, resetAt: "2026-09-23T06:00:17Z", displayName: "Gemini 3.1 Flash Image" },
        gemini_weekly: {
          displayName: "Gemini (Weekly)",
          used: 1000,
          total: 1000,
          resetAt: "2026-09-23T06:00:17Z",
          remainingPercentage: 0,
        },
        claude_gpt_weekly: {
          displayName: "Claude & GPT (Weekly)",
          used: 807,
          total: 1000,
          resetAt: "2026-09-24T18:09:46Z",
          remainingPercentage: 19.3,
        },
        claude_gpt_session: {
          displayName: "Claude & GPT (5h)",
          used: 1000,
          total: 1000,
          resetAt: "2026-09-20T19:00:21Z",
          remainingPercentage: 0,
        },
      },
    };

    const quotas = parseQuotaData("antigravity", liveLikeData);
    const names = quotas.map((q) => q.name);

    // Should contain unique usages:
    expect(names).toContain("Claude & GPT (5h)");
    expect(names).toContain("Claude & GPT (Weekly)");
    expect(names).toContain("Gemini (Weekly)");
    expect(names).toContain("Gemini 3.1 Flash Image");

    // Should NOT contain redundant duplicate entries:
    expect(names).not.toContain("Gemini (Flash / Pro)"); // duplicate of Gemini (Weekly)
    expect(names).not.toContain("Claude (Sonnet / Opus)"); // duplicate of Claude & GPT (5h)
    expect(names).not.toContain("GPT-OSS 120B (Medium)"); // covered by Claude & GPT family
    expect(quotas).toHaveLength(4);
  });

  it("works with no weekly keys present (backward compat)", () => {
    const noWeekly = {
      quotas: {
        "gemini-pro-agent": {
          displayName: "Gemini 3.1 Pro (High)",
          used: 200,
          total: 1000,
          remainingPercentage: 80,
        },
      },
    };
    const quotas = parseQuotaData("antigravity", noWeekly);
    expect(quotas).toHaveLength(1);
    expect(quotas[0].name).toBe("Gemini (Flash / Pro)");
  });
});
