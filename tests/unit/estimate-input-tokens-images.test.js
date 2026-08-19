// A base64 image must not be estimated as prose. Regression for a phone photo
// scoring ~1.08M tokens and being refused with context_length_exceeded by the
// per-model context check, while the session itself held ~20K tokens.
import { describe, it, expect } from "vitest";
import { estimateInputTokens } from "../../open-sse/utils/usageTracking.js";

// ~3MB of base64, the size an iPhone photo arrives at.
const B64 = "A".repeat(3 * 1024 * 1024);

describe("estimateInputTokens with inlined images", () => {
  it("does not count an OpenAI data-URI image as text", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "did you see the picture sent by my phone?" },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${B64}` } },
    ] }] };
    const tokens = estimateInputTokens(body);
    expect(tokens).toBeLessThan(5_000);
    expect(tokens).toBeGreaterThan(1_600);
  });

  it("does not count an Anthropic source.data image as text", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: B64 } },
    ] }] };
    expect(estimateInputTokens(body)).toBeLessThan(5_000);
  });

  it("still counts ordinary prose at roughly four chars per token", () => {
    const body = { messages: [{ role: "user", content: "x".repeat(4000) }] };
    const tokens = estimateInputTokens(body);
    expect(tokens).toBeGreaterThan(950);
    expect(tokens).toBeLessThan(1_100);
  });

  it("charges each image separately", () => {
    const one = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: `data:image/png;base64,${B64}` } }] }] };
    const two = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: `data:image/png;base64,${B64}` } },
      { type: "image_url", image_url: { url: `data:image/png;base64,${B64}` } }] }] };
    expect(estimateInputTokens(two) - estimateInputTokens(one)).toBeGreaterThan(1_500);
  });

  it("leaves a long non-image string named data alone", () => {
    const prose = { messages: [{ role: "user", content: "hello" }],
      data: "the quick brown fox! ".repeat(2000) };
    expect(estimateInputTokens(prose)).toBeGreaterThan(9_000);
  });
});
