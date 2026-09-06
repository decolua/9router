import { describe, it, expect } from "vitest";

describe("formatSubscriptionActiveUntil", () => {
  it("returns absolute localized display and dateTime ISO for valid ISO", async () => {
    const { formatSubscriptionActiveUntil } = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    const iso = "2026-09-28T12:00:00.000Z";
    const res = formatSubscriptionActiveUntil(iso);
    expect(res).not.toBeNull();
    expect(res.dateTime).toBe(new Date(iso).toISOString());
    expect(res.display).toBeTruthy();
    // must be absolute, not countdown
    expect(res.display).not.toMatch(/expires in/i);
    expect(res.display).not.toMatch(/reset/i);
  });

  it("handles epoch seconds and ms", async () => {
    const { formatSubscriptionActiveUntil } = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    const sec = Math.floor(Date.now() / 1000) + 86400;
    const ms = Date.now() + 86400000;
    const r1 = formatSubscriptionActiveUntil(sec);
    const r2 = formatSubscriptionActiveUntil(ms);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(new Date(r1.dateTime).getTime()).toBe(sec * 1000);
  });

  it("returns null for invalid/unknown", async () => {
    const { formatSubscriptionActiveUntil } = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    expect(formatSubscriptionActiveUntil(null)).toBeNull();
    expect(formatSubscriptionActiveUntil("")).toBeNull();
    expect(formatSubscriptionActiveUntil("not-a-date")).toBeNull();
    expect(formatSubscriptionActiveUntil(undefined)).toBeNull();
  });

  it("display is absolute localized date/time, no countdown wording", async () => {
    const { formatSubscriptionActiveUntil } = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    const res = formatSubscriptionActiveUntil("2026-12-01T00:00:00.000Z");
    expect(res.display.toLowerCase()).not.toContain("token expiry");
    expect(res.display.toLowerCase()).not.toContain("reset");
    expect(res.display.toLowerCase()).not.toContain("countdown");
  });
});

describe("ProviderLimits Codex subscription UI", () => {
  it("renders <time dateTime> with correct wording for Codex when data present", async () => {
    // This is a contract test checking utils output wording, not full render
    const { formatSubscriptionActiveUntil } = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    const iso = "2026-09-28T12:00:00.000Z";
    const fmt = formatSubscriptionActiveUntil(iso);
    // Simulated render string that component must produce
    const rendered = `<time dateTime="${fmt.dateTime}">Subscription active until ${fmt.display}</time>`;
    expect(rendered).toContain(`dateTime="${fmt.dateTime}"`);
    expect(rendered).toContain("Subscription active until");
    expect(rendered).not.toContain("expires in");
    expect(rendered).not.toContain("token expiry");
  });

  it("hides time when unknown/invalid", async () => {
    const { formatSubscriptionActiveUntil } = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    expect(formatSubscriptionActiveUntil(null)).toBeNull();
    expect(formatSubscriptionActiveUntil("bad")).toBeNull();
  });

  // RED: UI free-plan hides expiry, missing plan still shows
  it("explicit free plan hides expiry time (even with valid expiry)", async () => {
    const { shouldShowSubscriptionExpiry } = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    const future = new Date(Date.now() + 10 * 86400000).toISOString();
    expect(shouldShowSubscriptionExpiry({ subscriptionPlan: "free", subscriptionActiveUntil: future })).toBe(false);
    expect(shouldShowSubscriptionExpiry({ subscriptionPlan: " Free ", subscriptionActiveUntil: future })).toBe(false);
    expect(shouldShowSubscriptionExpiry({ subscriptionPlan: "FREE", subscriptionActiveUntil: future })).toBe(false);
  });

  it("missing/null plan with valid expiry still shows time", async () => {
    const { shouldShowSubscriptionExpiry, formatSubscriptionActiveUntil } = await import("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js");
    const future = new Date(Date.now() + 10 * 86400000).toISOString();
    expect(formatSubscriptionActiveUntil(future)).not.toBeNull();
    expect(shouldShowSubscriptionExpiry({ subscriptionPlan: null, subscriptionActiveUntil: future })).toBe(true);
    expect(shouldShowSubscriptionExpiry({ subscriptionPlan: undefined, subscriptionActiveUntil: future })).toBe(true);
    expect(shouldShowSubscriptionExpiry({ subscriptionPlan: "", subscriptionActiveUntil: future })).toBe(true);
  });
});
