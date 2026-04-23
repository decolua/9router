import { describe, expect, it } from "vitest";

import { getConnectionErrorTag } from "../../src/app/(dashboard)/dashboard/providers/errorTag.js";

describe("getConnectionErrorTag", () => {
  it("prefers canonical reasonCode mappings", () => {
    expect(getConnectionErrorTag({ reasonCode: "auth_invalid" })).toBe("AUTH");
    expect(getConnectionErrorTag({ reasonCode: "quota_exhausted" })).toBe("429");
    expect(getConnectionErrorTag({ reasonCode: "upstream_unhealthy" })).toBe("5XX");
  });

  it("uses canonical routing status values only", () => {
    expect(getConnectionErrorTag({ routingStatus: "blocked" })).toBe("AUTH");
    expect(getConnectionErrorTag({ routingStatus: "exhausted" })).toBe("429");
    expect(getConnectionErrorTag({ routingStatus: "unknown" })).toBe("ERR");
  });

  it("uses canonical reason detail text when no canonical state code is set", () => {
    expect(getConnectionErrorTag({ reasonDetail: "Token revoked by upstream" })).toBe("AUTH");
  });

  it("prefers canonical reasonCode over conflicting reasonDetail text", () => {
    expect(getConnectionErrorTag({
      reasonCode: "quota_exhausted",
      reasonDetail: "Token revoked by upstream",
    })).toBe("429");
  });

  it("prefers canonical reasonCode over conflicting routing status", () => {
    expect(getConnectionErrorTag({
      reasonCode: "upstream_unhealthy",
      routingStatus: "blocked",
    })).toBe("5XX");
  });
});
