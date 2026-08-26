// sizingCharsPerToken takes the MINIMUM ratio across providers, so one provider
// reporting a bad number sizes every request in every cascade. The guard against
// that is MIN_RATIO, and it was set to 0.5 — below anything a tokenizer can
// produce, so it caught none of the bugs its own comment named.
//
// Production numbers, 2026-08-26: antigravity reported 458,135 input tokens for a
// body measured at 466,255 chars. `chars` is measured with media stripped and
// Gemini counts media as tokens, so the two numbers describe different bodies.
// The 1.02 ratio was accepted, became the pool minimum, and sized a ~133K
// conversation at 684,446 tokens. Every member under a megatoken was then skipped
// for window and the combo reported exhaustion with a pool that could have served
// the request.
import { beforeEach, describe, expect, it } from "vitest";
import {
  observeTokenRatio,
  sizingCharsPerToken,
  charsPerToken,
  resetTokenRatios,
  ratioStats,
} from "../../open-sse/services/tokenRatio.js";

// The exact pair from the router log.
const AG_CHARS = 466255;
const AG_TOKENS = 458135;

// A plausible sample from a provider whose accounting is not broken.
const SANE_CHARS = 400000;
const SANE_TOKENS = 145000; // ~2.76 chars/token, dense JSON and code

beforeEach(() => resetTokenRatios());

describe("a media accounting mismatch cannot become the pool's sizing ratio", () => {
  it("rejects the antigravity sample outright", () => {
    for (let i = 0; i < 5; i++) observeTokenRatio("antigravity", AG_CHARS, AG_TOKENS);
    expect(ratioStats().providers.antigravity).toBeUndefined();
  });

  it("keeps sizing on the sane provider when the bad one is also reporting", () => {
    for (let i = 0; i < 5; i++) {
      observeTokenRatio("antigravity", AG_CHARS, AG_TOKENS);
      observeTokenRatio("kiro", SANE_CHARS, SANE_TOKENS);
    }
    // Without the floor this returned ~0.92 and sized the body at 5x its real size.
    expect(sizingCharsPerToken()).toBeGreaterThan(2);
  });

  it("sizes the production body near its real token count, not five times it", () => {
    for (let i = 0; i < 5; i++) {
      observeTokenRatio("antigravity", AG_CHARS, AG_TOKENS);
      observeTokenRatio("kiro", SANE_CHARS, SANE_TOKENS);
    }
    const sized = Math.round(AG_CHARS / sizingCharsPerToken());
    // Real count is ~133K-170K. The estimate must still err high, but not wildly.
    expect(sized).toBeLessThan(300000);
    expect(sized).toBeGreaterThan(AG_CHARS / 8); // still a sane lower bound
    expect(sized).toBeLessThan(684446); // the number that caused the incident
  });

  it("never returns a sizing ratio below the floor, whatever was recorded", () => {
    for (let i = 0; i < 5; i++) observeTokenRatio("antigravity", AG_CHARS, AG_TOKENS);
    // Every sample rejected, so this falls through to the bootstrap — which is
    // itself below the floor, and must be clamped rather than passed through.
    expect(sizingCharsPerToken()).toBeGreaterThanOrEqual(1.5 * 0.9);
  });
});

describe("legitimate samples are unaffected", () => {
  it("still learns a normal provider ratio", () => {
    for (let i = 0; i < 3; i++) observeTokenRatio("kiro", SANE_CHARS, SANE_TOKENS);
    expect(charsPerToken("kiro")).toBeCloseTo(SANE_CHARS / SANE_TOKENS, 2);
  });

  it("still rejects the ceiling case it always rejected", () => {
    observeTokenRatio("weird", 100000, 5000); // 20 chars/token
    expect(ratioStats().providers.weird).toBeUndefined();
  });

  it("still ignores samples too small to mean anything", () => {
    observeTokenRatio("kiro", 500, 150);
    expect(ratioStats().providers.kiro).toBeUndefined();
  });
});
