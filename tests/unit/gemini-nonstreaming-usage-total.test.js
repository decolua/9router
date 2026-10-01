import { describe, expect, it } from "vitest";

import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// #3789: the non-streaming path that maps a Gemini-shaped response into a
// Gemini-family envelope reported a self-contradictory usage block when
// upstream omitted totalTokenCount — prompt and completion were filled in, but
// total was 0. Every sibling branch in the same file sums the parts, and so does
// the streaming normaliser; this path was the only one that did not.

const geminiResp = (usageMetadata) => ({
  candidates: [{ content: { parts: [{ text: "hello" }], role: "model" }, finishReason: "STOP" }],
  usageMetadata,
});

// The branch under test: an OpenAI-shaped client response whose provider spoke
// Gemini, re-expressed for a Gemini-family target.
const usageFor = (usageMetadata, target = FORMATS.GEMINI) =>
  translateNonStreamingResponse(geminiResp(usageMetadata), target, FORMATS.OPENAI).usage;

describe("non-streaming Gemini usage totals (#3789)", () => {
  it("sums the parts when totalTokenCount is absent", () => {
    expect(usageFor({ promptTokenCount: 10, candidatesTokenCount: 20 })).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
  });

  it("uses totalTokenCount when upstream sends it", () => {
    expect(usageFor({ promptTokenCount: 8, candidatesTokenCount: 4, thoughtsTokenCount: 2, totalTokenCount: 14 }))
      .toMatchObject({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
  });

  it("keeps upstream's total even when it disagrees with the sum", () => {
    // totalTokenCount may legitimately differ (cached content, tool overhead),
    // so it stays authoritative when present.
    expect(usageFor({ promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 999 }))
      .toMatchObject({ total_tokens: 999 });
  });

  it("includes thoughts in prompt_tokens and the total", () => {
    const u = usageFor({ promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10 });
    expect(u.prompt_tokens).toBe(110);
    expect(u.total_tokens).toBe(150);
  });

  it("reports reasoning_tokens when thoughts are present", () => {
    expect(usageFor({ promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10 }))
      .toHaveProperty("completion_tokens_details.reasoning_tokens", 10);
  });

  it("does not invent a reasoning_tokens block when there are no thoughts", () => {
    expect(usageFor({ promptTokenCount: 10, candidatesTokenCount: 20 }))
      .not.toHaveProperty("completion_tokens_details");
  });

  it("handles an entirely empty usage block without NaN or undefined", () => {
    expect(usageFor({})).toMatchObject({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  });

  it("is never internally inconsistent: total === prompt + completion when derived", () => {
    for (const u of [
      { promptTokenCount: 10, candidatesTokenCount: 20 },
      { promptTokenCount: 0, candidatesTokenCount: 0 },
      { promptTokenCount: 7, candidatesTokenCount: 0, thoughtsTokenCount: 3 },
    ]) {
      const got = usageFor(u);
      expect(got.total_tokens, JSON.stringify(u)).toBe(got.prompt_tokens + got.completion_tokens);
    }
  });

  it("agrees across every Gemini-family target", () => {
    for (const t of [FORMATS.GEMINI, FORMATS.ANTIGRAVITY, FORMATS.GEMINI_CLI, FORMATS.VERTEX]) {
      expect(usageFor({ promptTokenCount: 10, candidatesTokenCount: 20 }, t), t).toMatchObject({
        total_tokens: 30,
      });
    }
  });
});
