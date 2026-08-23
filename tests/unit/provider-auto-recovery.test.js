import { describe, expect, it } from "vitest";
import { matchesAutoDisableTrigger, parseAutoDisableTriggers } from "@/shared/services/providerAutoRecovery.js";

describe("provider auto disable rules", () => {
  it("treats each line as one complete trigger phrase", () => {
    expect(parseAutoDisableTriggers("Invalid API Key， quota exceeded\nFORBIDDEN"))
      .toEqual(["invalid api key， quota exceeded", "forbidden"]);
  });

  it("matches trigger words case-insensitively", () => {
    expect(matchesAutoDisableTrigger("401 INVALID API KEY", "invalid api key\nquota exceeded")).toBe(true);
    expect(matchesAutoDisableTrigger("temporary network failure", "invalid api key\nquota exceeded")).toBe(false);
  });
});
