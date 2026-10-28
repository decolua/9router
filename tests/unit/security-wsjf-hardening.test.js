import { describe, it, expect } from "vitest";
import { reauthRequiredKeys } from "../../src/lib/auth/settingsReauth.js";
import { isValidAwsRegion, safeAwsRegion } from "../../open-sse/config/awsRegion.js";
import { isPlaceholderInitialPassword, hasOperatorInitialPassword } from "../../src/lib/auth/initialPassword.js";

describe("settings security re-auth", () => {
  const current = { requireLogin: true, requireApiKey: true, tunnelDashboardAccess: false, authMode: "password", oidcIssuerUrl: "" };

  it("requires re-authentication for security downgrades", () => {
    expect(reauthRequiredKeys({ requireLogin: false }, current)).toEqual(["requireLogin"]);
    expect(reauthRequiredKeys({ requireApiKey: false }, current)).toEqual(["requireApiKey"]);
    expect(reauthRequiredKeys({ tunnelDashboardAccess: true }, current)).toEqual(["tunnelDashboardAccess"]);
    expect(reauthRequiredKeys({ authMode: "oidc", oidcIssuerUrl: "https://idp.example" }, current))
      .toEqual(["authMode", "oidcIssuerUrl"]);
  });

  it("does not gate hardening or unchanged settings", () => {
    expect(reauthRequiredKeys({ requireLogin: true }, { ...current, requireLogin: false })).toEqual([]);
    expect(reauthRequiredKeys({ requireApiKey: true }, { ...current, requireApiKey: false })).toEqual([]);
    expect(reauthRequiredKeys({ rtkEnabled: false }, current)).toEqual([]);
  });
});

describe("Kiro AWS region validation", () => {
  it.each(["us-east-1", "eu-west-1", "ap-southeast-2"])("accepts %s", (region) => {
    expect(isValidAwsRegion(region)).toBe(true);
  });

  it.each(["evil.com", "us-east-1.evil.com", "us-east-1/", "us-east-1#x", "", null])("rejects %j", (region) => {
    expect(isValidAwsRegion(region)).toBe(false);
  });

  it("falls back instead of interpolating attacker-controlled host data", () => {
    expect(safeAwsRegion("us-east-1.evil.com")).toBe("us-east-1");
    expect(safeAwsRegion("eu-west-1")).toBe("eu-west-1");
  });
});

describe("initial password placeholders", () => {
  it("treats shipped examples as public values", () => {
    expect(isPlaceholderInitialPassword("change-me")).toBe(true);
    expect(isPlaceholderInitialPassword("your-password")).toBe(true);
    expect(isPlaceholderInitialPassword("operator-secret-123")).toBe(false);
  });

  it("only considers a non-placeholder env value operator supplied", () => {
    const original = process.env.INITIAL_PASSWORD;
    process.env.INITIAL_PASSWORD = "change-me";
    expect(hasOperatorInitialPassword()).toBe(false);
    process.env.INITIAL_PASSWORD = "operator-secret-123";
    expect(hasOperatorInitialPassword()).toBe(true);
    if (original === undefined) delete process.env.INITIAL_PASSWORD;
    else process.env.INITIAL_PASSWORD = original;
  });
});
