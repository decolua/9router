import { beforeEach, describe, expect, it } from "vitest";
import {
  observeTokenRatio, charsPerToken, sizingCharsPerToken, isCalibrated, isSizingCalibrated,
  ratioStats, resetTokenRatios,
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
    observeTokenRatio("ag", 100000, 62500);   // 1.6 — one odd request
    const r = charsPerToken("ag");
    expect(r).toBeLessThan(2.0);
    expect(r).toBeGreaterThan(1.7);           // EWMA, not a jump to 1.6
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

// The regression that made sizing unusable in production on 2026-08-23. A single
// global mean, fed by whichever provider answered last, is a feedback loop: the
// estimate picks the member, that member's tokenizer produces the next sample,
// the sample moves the estimate. Observed over eight minutes on one unchanged
// conversation the mean travelled 1.84 -> 3.63, so the same 600k-char body sized
// at 150k tokens and at 305k tokens against a hard 200k cliff — members flipped
// in and out of eligibility every turn, and the client's compaction request came
// back an error, which Claude Code answers by abandoning compaction entirely.
describe("sizing ratio is pessimistic and stable, not the mean", () => {
  beforeEach(() => resetTokenRatios());

  const feed = (provider, ratio, n = 5) => {
    for (let i = 0; i < n; i++) observeTokenRatio(provider, 100000, Math.round(100000 / ratio));
  };

  it("sizes on the most token-hungry provider, not the average of them", () => {
    feed("antigravity", 4.0);
    feed("kiro", 1.6);
    // The mean of these lands near 2.8 and under-counts by ~40% for anything
    // routed to kiro. Sizing takes kiro's number for everyone.
    expect(sizingCharsPerToken()).toBeLessThanOrEqual(1.6);
    expect(sizingCharsPerToken()).toBeLessThan(charsPerToken());
  });

  it("never under-counts tokens relative to the mean", () => {
    feed("antigravity", 3.0);
    const chars = 600000;
    expect(Math.ceil(chars / sizingCharsPerToken())).toBeGreaterThan(Math.ceil(chars / charsPerToken()));
  });

  it("ignores a provider seen only once, so one freak sample cannot set the floor", () => {
    feed("antigravity", 3.0);
    const before = sizingCharsPerToken();
    // 1.6, just inside the guard rail. This read 0.5 until 2026-08-26, when the
    // floor rose to 1.5 — a value that low is now rejected on arrival, which
    // tests the wrong gate. The point here is the sample COUNT, not the value:
    // a provider seen once must not speak, however plausible its number.
    observeTokenRatio("weird", 100000, 62500);
    // Recorded, but not yet allowed to speak: one sample is an anecdote, and
    // because sizing takes the minimum this one would otherwise halve the
    // estimate for every provider at once.
    expect(ratioStats().providers.weird).toMatchObject({ samples: 1 });
    expect(sizingCharsPerToken()).toBe(before);
  });

  it("holds steady while the mean drifts across providers", () => {
    feed("antigravity", 1.8);
    const sized = sizingCharsPerToken();
    // Everything after this is a HIGHER ratio from other providers — exactly what
    // dragged the old mean up and under-counted the next request.
    feed("gemini", 3.6);
    feed("commandcode", 4.0);
    expect(charsPerToken()).toBeGreaterThan(2.5);
    expect(sizingCharsPerToken()).toBe(sized);
  });

  it("is not calibrated until some provider clears the sample floor", () => {
    expect(isSizingCalibrated()).toBe(false);
    observeTokenRatio("antigravity", 100000, 50000);
    expect(isSizingCalibrated()).toBe(false);
    feed("antigravity", 2.0, 2);
    expect(isSizingCalibrated()).toBe(true);
  });
});
