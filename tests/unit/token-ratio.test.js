import { beforeEach, describe, expect, it } from "vitest";
import {
  observeTokenRatio, charsPerToken, isCalibrated, ratioStats, resetTokenRatios,
} from "../../open-sse/services/tokenRatio.js";

describe("learned chars-per-token ratio", () => {
  beforeEach(() => resetTokenRatios());

  it("starts uncalibrated on the bootstrap value", () => {
    expect(isCalibrated()).toBe(false);
    expect(charsPerToken()).toBeCloseTo(1.6, 5);
  });

  // The incident this exists for: 602,528 chars measured by the provider at
  // 391,532 tokens = 1.54 chars/token, against a hardcoded assumption of 4.0.
  it("the first real sample replaces the assumption outright", () => {
    observeTokenRatio("ag", 602528, 391532);
    expect(isCalibrated()).toBe(true);
    expect(charsPerToken()).toBeCloseTo(602528 / 391532, 5);
    expect(charsPerToken("ag")).toBeCloseTo(602528 / 391532, 5);
  });

  it("sizes the incident request correctly once calibrated", () => {
    observeTokenRatio("ag", 602528, 391532);
    const sized = Math.ceil(602528 / charsPerToken());
    expect(sized).toBe(391532);
    // The whole point: a 200K member must now be judged unable to serve it.
    expect(sized).toBeGreaterThan(200000);
  });

  it("keeps providers separate, because tokenizers differ", () => {
    observeTokenRatio("ag", 100000, 50000);      // 2.0
    observeTokenRatio("gemini", 100000, 25000);  // 4.0
    expect(charsPerToken("ag")).toBeCloseTo(2.0, 5);
    expect(charsPerToken("gemini")).toBeCloseTo(4.0, 5);
    expect(charsPerToken("never-seen")).toBe(charsPerToken()); // global blend
  });

  it("moves gradually after the first sample rather than tracking noise", () => {
    observeTokenRatio("ag", 100000, 50000);   // 2.0
    observeTokenRatio("ag", 100000, 100000);  // 1.0 — one odd request
    const r = charsPerToken("ag");
    expect(r).toBeLessThan(2.0);
    expect(r).toBeGreaterThan(1.7);           // EWMA, not a jump to 1.0
  });

  it("ignores samples that cannot be a real ratio", () => {
    observeTokenRatio("ag", 100000, 0);        // provider reported nothing
    observeTokenRatio("ag", 100000, 10);       // 10000 chars/token — impossible
    observeTokenRatio("ag", 100000, 1000000);  // 0.1 — impossible
    observeTokenRatio("ag", 500, 100);         // too small to be signal
    observeTokenRatio("ag", NaN, 50);
    expect(isCalibrated()).toBe(false);
    expect(ratioStats().global.samples).toBe(0);
  });
});
