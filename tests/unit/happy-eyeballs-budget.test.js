import { describe, expect, it } from "vitest";
import { EYEBALLS_ATTEMPT_TIMEOUT_MS, parseEyeballsTimeoutMs } from "../../open-sse/utils/proxyFetch.js";

describe("#5721 happy-eyeballs attempt budget", () => {
  it("is above a ~285ms intercontinental RTT", () => {
    expect(EYEBALLS_ATTEMPT_TIMEOUT_MS).toBeGreaterThan(300);
  });
  it("accepts sane integers from NINEROUTER_HAPPY_EYEBALLS_TIMEOUT_MS", () => {
    expect(parseEyeballsTimeoutMs("2500")).toBe(2500);
  });
  it("falls back to the default for missing, malformed or out-of-range values", () => {
    for (const bad of [undefined, "", "abc", "12.5", "-5", "0", "50", "999999"]) {
      expect(parseEyeballsTimeoutMs(bad), String(bad)).toBe(1000);
    }
  });
});
