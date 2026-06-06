import { describe, it, expect } from "vitest";
import {
  getRemoteExposureBlockReason,
  hasCustomPassword,
  isRemoteExposureRequest,
} from "../../src/lib/security/exposureGate.js";

describe("exposureGate", () => {
  it("requires custom password before remote exposure", () => {
    expect(hasCustomPassword({})).toBe(false);
    expect(getRemoteExposureBlockReason({ requireLogin: true })).toContain("custom password");
  });

  it("requires login before remote exposure", () => {
    expect(
      getRemoteExposureBlockReason({ password: "hashed", requireLogin: false })
    ).toContain("dashboard login");
  });

  it("allows exposure when password is set and login is required", () => {
    expect(
      getRemoteExposureBlockReason({ password: "hashed", requireLogin: true })
    ).toBeNull();
  });

  it("detects remote exposure settings updates", () => {
    expect(isRemoteExposureRequest({ tunnelEnabled: true })).toBe(true);
    expect(isRemoteExposureRequest({ tunnelDashboardAccess: true })).toBe(true);
    expect(isRemoteExposureRequest({ requireLogin: false })).toBe(false);
  });
});
