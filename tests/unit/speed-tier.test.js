import { describe, expect, it } from "vitest";
import {
  applySpeed,
  hasSpeedSuffix,
  stripSpeedSuffix,
} from "../../open-sse/translator/concerns/speedTier.js";

describe("speed tier suffix parsing", () => {
  it("detects the -fast marker, alone or before a thinking suffix", () => {
    expect(hasSpeedSuffix("claude-opus-5-fast")).toBe(true);
    expect(hasSpeedSuffix("claude-opus-5-fast(low)")).toBe(true);
    expect(hasSpeedSuffix("gpt-5.6-sol-fast")).toBe(true);
  });

  it("ignores models without the marker", () => {
    expect(hasSpeedSuffix("claude-opus-5")).toBe(false);
    expect(hasSpeedSuffix("claude-opus-5(max)")).toBe(false);
    expect(hasSpeedSuffix(undefined)).toBe(false);
  });

  it("does not treat a non-trailing 'fast' as the marker", () => {
    // "-review" virtual models must not be mangled into a speed opt-in.
    expect(hasSpeedSuffix("gpt-5.4-fast-review")).toBe(false);
    expect(stripSpeedSuffix("gpt-5.4-fast-review")).toBe("gpt-5.4-fast-review");
  });

  it("strips the marker while keeping the thinking suffix intact", () => {
    expect(stripSpeedSuffix("claude-opus-5-fast")).toBe("claude-opus-5");
    expect(stripSpeedSuffix("claude-opus-5-fast(low)")).toBe("claude-opus-5(low)");
    expect(stripSpeedSuffix("gpt-5.6-sol-fast")).toBe("gpt-5.6-sol");
  });

  it("is a no-op for models without the marker", () => {
    expect(stripSpeedSuffix("claude-opus-5(max)")).toBe("claude-opus-5(max)");
  });
});

describe("applySpeed", () => {
  it("sets Anthropic fast mode on the models that support it", () => {
    for (const model of ["claude-opus-5", "claude-opus-4-8", "claude-opus-4.8"]) {
      const body = { model };
      expect(applySpeed("claude", body)).toBe(true);
      expect(body.speed).toBe("fast");
    }
  });

  it("leaves the body untouched for models with no faster tier", () => {
    // Anthropic removed fast mode on Opus 4.7 — declaring it would 400 the request.
    for (const [provider, model] of [
      ["claude", "claude-opus-4-7"],
      ["claude", "claude-sonnet-5"],
      ["claude", "claude-haiku-4-5-20251001"],
      ["codex", "gpt-5.6-sol"],
    ]) {
      const body = { model };
      expect(applySpeed(provider, body)).toBe(false);
      expect(body).toEqual({ model });
    }
  });

  it("tolerates a missing or non-object body", () => {
    expect(applySpeed("claude", null)).toBe(false);
    expect(applySpeed("claude", undefined)).toBe(false);
  });
});
