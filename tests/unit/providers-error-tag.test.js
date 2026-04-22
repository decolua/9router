import { describe, expect, it } from "vitest";

import { getConnectionErrorTag } from "../../src/app/(dashboard)/dashboard/providers/errorTag.js";

describe("getConnectionErrorTag", () => {
  it("prefers canonical reasonCode mappings", () => {
    expect(getConnectionErrorTag({ reasonCode: "auth_invalid" })).toBe("AUTH");
    expect(getConnectionErrorTag({ reasonCode: "quota_exhausted" })).toBe("429");
    expect(getConnectionErrorTag({ reasonCode: "upstream_unhealthy" })).toBe("5XX");
  });

  it("uses canonical routing status before legacy explicit error fields", () => {
    expect(getConnectionErrorTag({ routingStatus: "blocked_auth", errorCode: "500" })).toBe("AUTH");
    expect(getConnectionErrorTag({ routingStatus: "exhausted", lastErrorType: "upstream_auth_error" })).toBe("429");
    expect(getConnectionErrorTag({ routingStatus: "blocked_health", lastErrorType: "upstream_rate_limited" })).toBe("5XX");
  });

  it("maps legacy auth_invalid explicit error type to AUTH", () => {
    expect(getConnectionErrorTag({ lastErrorType: "auth_invalid" })).toBe("AUTH");
  });
});
