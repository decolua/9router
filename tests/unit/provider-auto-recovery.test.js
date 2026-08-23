import { describe, expect, it } from "vitest";
import { matchesAutoDisableTrigger, parseAutoDisableTriggers } from "@/shared/services/providerAutoRecovery.js";

describe("provider auto disable rules", () => {
  it("normalizes comma and newline separated trigger words", () => {
    expect(parseAutoDisableTriggers("Invalid API Key， quota exceeded\nFORBIDDEN"))
      .toEqual(["invalid api key", "quota exceeded", "forbidden"]);
  });

  it("matches trigger words case-insensitively", () => {
    expect(matchesAutoDisableTrigger("401 INVALID API KEY", "invalid api key,quota exceeded")).toBe(true);
    expect(matchesAutoDisableTrigger("temporary network failure", "invalid api key,quota exceeded")).toBe(false);
  });
});
