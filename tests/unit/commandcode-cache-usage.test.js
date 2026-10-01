// Regression: CommandCode finish.totalUsage carries cache inside
// inputTokenDetails.{cacheReadTokens,cacheWriteTokens}.
//
// Semantics (verified against the raw upstream NDJSON, 2026-10-01): inputTokens
// is a cache-INCLUSIVE full prompt, not the cache-miss remainder. With an
// identical request body, inputTokens stays constant across a cold and a warm
// hit, and inputTokenDetails.noCacheTokens + cacheReadTokens === inputTokens.
// So cache must be surfaced via prompt_tokens_details WITHOUT being folded back
// into prompt_tokens (folding doubles the prompt and halves pi/Wren's CH).
//
// Pre-fix: USAGE_EXTRACTORS.commandcode dropped the cache fields entirely, so
// OpenAI clients (pi/Wren via prompt_tokens_details.cached_tokens) saw no cache.
import { describe, it, expect } from "vitest";
import { toOpenAIUsage, buildUsage } from "../../open-sse/translator/concerns/usage.js";
import { commandCodeToOpenAIResponse } from "../../open-sse/translator/response/commandcode-to-openai.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

describe("USAGE_EXTRACTORS.commandcode cache fields", () => {
  it("surfaces cache via prompt_tokens_details without inflating prompt_tokens", () => {
    const u = toOpenAIUsage(
      { inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 30 } },
      "commandcode"
    );
    // inputTokens is the inclusive prompt; cache is a subset, never added on top.
    expect(u.prompt_tokens).toBe(100);
    expect(u.completion_tokens).toBe(20);
    expect(u.total_tokens).toBe(120);
    expect(u.prompt_tokens_details.cached_tokens).toBe(60);
    expect(u.prompt_tokens_details.cache_creation_tokens).toBe(30);
  });

  it("prompt_tokens is invariant to cache (cold hit vs warm hit, same body)", () => {
    // Real upstream shape: identical body, only the cache split moves.
    const cold = toOpenAIUsage({ inputTokens: 8494, outputTokens: 4, inputTokenDetails: { noCacheTokens: 1070, cacheReadTokens: 7424 } }, "commandcode");
    const warm = toOpenAIUsage({ inputTokens: 8494, outputTokens: 4, inputTokenDetails: { noCacheTokens: 46, cacheReadTokens: 8448 } }, "commandcode");
    expect(cold.prompt_tokens).toBe(8494);
    expect(warm.prompt_tokens).toBe(8494); // must NOT grow with cache
    expect(cold.prompt_tokens_details.cached_tokens).toBe(7424);
    expect(warm.prompt_tokens_details.cached_tokens).toBe(8448);
  });

  it("keeps plain input/output working when inputTokenDetails is absent", () => {
    const u = toOpenAIUsage({ inputTokens: 8, outputTokens: 2, totalTokens: 10 }, "commandcode");
    expect(u.prompt_tokens).toBe(8);
    expect(u.completion_tokens).toBe(2);
    expect(u.total_tokens).toBe(10);
    expect(u.prompt_tokens_details).toBeUndefined();
  });

  it("handles cacheRead-only (warm hit, no new write)", () => {
    const u = toOpenAIUsage(
      { inputTokens: 50, outputTokens: 5, inputTokenDetails: { cacheReadTokens: 40 } },
      "commandcode"
    );
    expect(u.prompt_tokens).toBe(50);
    expect(u.prompt_tokens_details.cached_tokens).toBe(40);
    expect(u.prompt_tokens_details.cache_creation_tokens).toBeUndefined();
  });
});

describe("commandcode-to-openai end-to-end finish event", () => {
  it("final chunk usage carries prompt_tokens_details from totalUsage.inputTokenDetails", () => {
    const state = {};
    const out = commandCodeToOpenAIResponse(JSON.stringify({
      type: "finish",
      finishReason: "stop",
      totalUsage: { inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 30 } },
    }), state);
    const last = out[out.length - 1];
    expect(last.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 60, cache_creation_tokens: 30 },
    });
  });
});

describe("pi/Wren consumption chain (canonical + parseChunkUsage parity)", () => {
  it("canonicalizeUsage keeps the inclusive prompt and cache split for DB/cost", () => {
    const openaiUsage = toOpenAIUsage(
      { inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 30 } },
      "commandcode"
    );
    const canon = canonicalizeUsage(openaiUsage);
    expect(canon.prompt_tokens).toBe(100);
    expect(canon.cached_tokens).toBe(60);
    expect(canon.cache_creation_input_tokens).toBe(30);
  });

  it("buildUsage shape round-trips through pi's parseChunkUsage math", () => {
    // pi computes input = max(0, prompt_tokens - cacheRead - cacheWrite);
    // CH (Wren) = cacheRead / (input + cacheRead + cacheWrite).
    const u = buildUsage({ promptTokens: 8494, completionTokens: 4, totalTokens: 8498, cachedTokens: 8448, cacheCreationTokens: 0 });
    const cacheRead = u.prompt_tokens_details.cached_tokens;
    const cacheWrite = u.prompt_tokens_details.cache_creation_tokens ?? 0;
    const input = Math.max(0, u.prompt_tokens - cacheRead - cacheWrite);
    expect(input).toBe(46);
    const ch = cacheRead / (input + cacheRead + cacheWrite);
    expect(ch).toBeCloseTo(8448 / 8494, 12); // ≈99.5%, not halved
  });
});
