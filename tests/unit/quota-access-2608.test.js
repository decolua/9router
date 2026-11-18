import { describe, it, expect } from "vitest";

import {
  anonymizeConnectionLabel,
  normalizeQuotaAccess,
  QUOTA_ACCESS_NONE,
  QUOTA_ACCESS_FULL,
  QUOTA_ACCESS_ACCOUNT,
  QUOTA_ACCESS_AGGREGATE,
  QUOTA_ACCESS_MODES,
} from "@/shared/utils/quotaAccess";

describe("quota access utils", () => {
  it("normalizeQuotaAccess defaults unknown values to none (deny by default)", () => {
    expect(normalizeQuotaAccess(null)).toBe(QUOTA_ACCESS_NONE);
    expect(normalizeQuotaAccess(undefined)).toBe(QUOTA_ACCESS_NONE);
    expect(normalizeQuotaAccess("bogus")).toBe(QUOTA_ACCESS_NONE);
    // Legacy pre-4-mode value no longer resolves — treated as unknown → none.
    expect(normalizeQuotaAccess("anonymized")).toBe(QUOTA_ACCESS_NONE);
  });

  it("normalizeQuotaAccess passes through every known mode", () => {
    for (const mode of QUOTA_ACCESS_MODES) {
      expect(normalizeQuotaAccess(mode)).toBe(mode);
    }
    expect(QUOTA_ACCESS_MODES).toEqual([
      QUOTA_ACCESS_NONE,
      QUOTA_ACCESS_FULL,
      QUOTA_ACCESS_ACCOUNT,
      QUOTA_ACCESS_AGGREGATE,
    ]);
  });

  it("anonymizeConnectionLabel returns a stable one-way label", () => {
    const c1 = { id: "abc123", name: "Personal Claude", email: "me@example.com" };
    const c2 = { id: "xyz789", name: "Work Codex", email: "work@example.com" };
    const a = anonymizeConnectionLabel(c1, "salt-1");
    const b = anonymizeConnectionLabel(c2, "salt-1");
    const c = anonymizeConnectionLabel(c1, "salt-2");
    expect(a).toMatch(/^conn-[0-9a-z]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("Personal");
    expect(a).not.toContain("Claude");
    // stable
    expect(anonymizeConnectionLabel(c1, "salt-1")).toBe(a);
    // different salt / different machine → different label
    expect(c).not.toBe(a);
  });

  it("anonymizeConnectionLabel tolerates missing fields", () => {
    expect(anonymizeConnectionLabel(null, "s")).toBe("conn-?");
    expect(anonymizeConnectionLabel({}, "s")).toMatch(/^conn-[0-9a-z]+$/);
  });
});
