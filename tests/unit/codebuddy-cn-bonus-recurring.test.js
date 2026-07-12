// CodeBuddy CN mixes recurring refill packs with one-shot bonus packs.
// Bonus packs ("Bonus Pack N") must surface recurring:false so the dashboard
// shows "Expires in" instead of implying a monthly refill. The usage handler
// tags the flag and parseQuotaData must forward it.
import { describe, it, expect } from "vitest";
import {
  getAccountTypeLabel,
  getPlanLabel,
  parseQuotaData,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("parseQuotaData codebuddy-cn recurring flag", () => {
  it("forwards recurring:false for bonus packs and true for refill packs", () => {
    const data = {
      plan: "CodeBuddy CN",
      quotas: {
        Monthly: { used: 6.54, total: 500, resetAt: "2026-07-31T00:00:00Z", recurring: true },
        "Bonus Pack 1": { used: 12, total: 100, resetAt: "2026-07-15T00:00:00Z", recurring: false },
      },
    };

    const out = parseQuotaData("codebuddy-cn", data);
    const byName = Object.fromEntries(out.map((q) => [q.name, q]));

    expect(byName["Monthly"].recurring).toBe(true);
    expect(byName["Bonus Pack 1"].recurring).toBe(false);
  });

  it("defaults recurring to true when the flag is absent (back-compat)", () => {
    const data = { quotas: { Monthly: { used: 0, total: 100, resetAt: null } } };
    const out = parseQuotaData("codebuddy-cn", data);
    expect(out[0].recurring).toBe(true);
  });
});

describe("getPlanLabel", () => {
  it("formats known Codex and Claude plan names", () => {
    expect(getPlanLabel("plus")).toBe("Plus");
    expect(getPlanLabel("team")).toBe("Team");
    expect(getPlanLabel("k12")).toBe("K-12");
    expect(getPlanLabel("max_5x")).toBe("Max x5");
    expect(getPlanLabel("max_20x")).toBe("Max x20");
  });

  it("returns null for unknown empty plan values", () => {
    expect(getPlanLabel("unknown")).toBeNull();
    expect(getPlanLabel("Unknown")).toBeNull();
    expect(getPlanLabel(null)).toBeNull();
  });
});

describe("getAccountTypeLabel", () => {
  it("uses provider-specific auth method labels when present", () => {
    expect(getAccountTypeLabel({
      authType: "oauth",
      providerSpecificData: { authMethod: "builder-id" },
    })).toBe("AWS Builder ID");
  });

  it("falls back to normalized auth type labels", () => {
    expect(getAccountTypeLabel({ authType: "api_key" })).toBe("API Key");
    expect(getAccountTypeLabel({ authType: "oauth" })).toBe("OAuth");
  });

  it("labels non-Kiro provider auth methods", () => {
    expect(getAccountTypeLabel({
      authType: "oauth",
      providerSpecificData: { authMethod: "external_idp" },
    })).toBe("External IdP");
    expect(getAccountTypeLabel({
      authType: "oauth",
      providerSpecificData: { authMethod: "browser_token" },
    })).toBe("Browser Token");
  });
});
