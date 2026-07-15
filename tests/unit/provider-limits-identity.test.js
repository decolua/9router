import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  HIDE_ACCOUNT_IDENTITY_STORAGE_KEY,
  maskAccountIdentity,
  getConnectionLabel,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

describe("HIDE_ACCOUNT_IDENTITY_STORAGE_KEY", () => {
  it("uses the quota-scoped localStorage key", () => {
    expect(HIDE_ACCOUNT_IDENTITY_STORAGE_KEY).toBe("quotaHideAccountIdentity");
  });
});

describe("maskAccountIdentity", () => {
  it("passes through null, undefined, non-string, and blank values", () => {
    expect(maskAccountIdentity(null)).toBe(null);
    expect(maskAccountIdentity(undefined)).toBe(undefined);
    expect(maskAccountIdentity(42)).toBe(42);
    expect(maskAccountIdentity("   ")).toBe("   ");
  });

  it("masks an email as first-3-of-local + '@' + masked domain keeping the TLD", () => {
    expect(maskAccountIdentity("johndoe@email.com")).toBe("joh*****@****.com");
  });

  it("masks a plain name keeping the first 3 chars", () => {
    expect(maskAccountIdentity("Alexander")).toBe("Ale*****");
  });

  it("masks a short name (<=2 chars) entirely", () => {
    expect(maskAccountIdentity("ab")).toBe("**");
    expect(maskAccountIdentity("x")).toBe("*");
  });
});

describe("getConnectionLabel", () => {
  it("returns the raw label by default (no masking)", () => {
    expect(getConnectionLabel({ email: "johndoe@email.com" })).toBe("johndoe@email.com");
    expect(getConnectionLabel({ name: "Alexander" })).toBe("Alexander");
  });

  it("masks the resolved label when hideIdentity is set", () => {
    expect(getConnectionLabel({ email: "johndoe@email.com" }, { hideIdentity: true }))
      .toBe("joh*****@****.com");
    expect(getConnectionLabel({ name: "Alexander" }, { hideIdentity: true }))
      .toBe("Ale*****");
    expect(getConnectionLabel({ displayName: "Johann Horne" }, { hideIdentity: true }))
      .toBe("Joh*****");
  });

  it("returns null when the connection has no identity fields", () => {
    expect(getConnectionLabel({})).toBe(null);
  });
});

describe("ProviderLimits privacy wiring", () => {
  const source = fs.readFileSync(
    path.join(
      REPO_ROOT,
      "src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js",
    ),
    "utf-8",
  );

  it("masks identity in both Codex dialogs when privacy mode is enabled", () => {
    const maskedDialogCalls = source.match(
      /getConnectionLabel\([^)]*, \{ hideIdentity: hideAccountIdentity \}\)/g,
    ) || [];
    expect(maskedDialogCalls.length).toBeGreaterThanOrEqual(4);
  });

  it("gives the privacy toggle an explicit accessible name and hides its icon", () => {
    expect(source).toContain("aria-label={hideAccountIdentity ?");
    expect(source).toContain('aria-hidden="true"');
  });
});
