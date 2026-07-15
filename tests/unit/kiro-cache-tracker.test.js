// Kiro cached-token accounting - local heuristic tracker modeled after
// Kiro-Go/proxy/cache_tracker.go. Upstream (Amazon Q / CodeWhisperer) emits no
// cache fields, so we estimate cache creation/read from explicit cache_control
// ephemeral breakpoints in the Claude request, scoped per connectionId.
import { describe, it, expect } from "vitest";
import {
  estimateApproxTokens,
  canonicalizeCacheValue,
  buildClaudeCacheProfile,
  applyKiroCacheAccounting,
  KiroCacheTracker,
} from "../../open-sse/utils/kiroCacheTracker.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

// ~51 chars/repeat, ~11.8 tokens/repeat (mostly regularAscii / 4.5)
const SENTENCE = "The quick brown fox jumps over the lazy dog again. ";
const BIG_TEXT = SENTENCE.repeat(200); // ~2356 tokens (> 1024, < 4096)
const MID_TEXT = SENTENCE.repeat(160); // ~1885 tokens (> 1024, < 4096)

function makeReq(model, systemText, messageText = "Hello there, please help me today.") {
  return {
    model,
    tool_choice: "auto",
    tools: [],
    system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: messageText }],
  };
}

describe("estimateApproxTokens", () => {
  it("returns 0 for empty/nullish input", () => {
    expect(estimateApproxTokens("")).toBe(0);
    expect(estimateApproxTokens(null)).toBe(0);
    expect(estimateApproxTokens(undefined)).toBe(0);
  });

  it("returns at least 1 for very short strings", () => {
    expect(estimateApproxTokens("ab")).toBeGreaterThanOrEqual(1);
    expect(estimateApproxTokens("abcd")).toBeGreaterThanOrEqual(1);
  });

  it("scales roughly with length and is deterministic", () => {
    const a = estimateApproxTokens("hello world ".repeat(10));
    const b = estimateApproxTokens("hello world ".repeat(20));
    expect(b).toBeGreaterThan(a);
    expect(estimateApproxTokens(BIG_TEXT)).toBe(estimateApproxTokens(BIG_TEXT));
  });
});

describe("canonicalizeCacheValue", () => {
  it("is order-independent for object keys", () => {
    const a = canonicalizeCacheValue({ b: 1, a: 2, c: [3, { z: 1, y: 2 }] });
    const b = canonicalizeCacheValue({ c: [3, { y: 2, z: 1 }], a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("drops cache_control keys from the fingerprint", () => {
    const withCache = canonicalizeCacheValue({ a: 1, cache_control: { type: "ephemeral" } });
    const without = canonicalizeCacheValue({ a: 1 });
    expect(withCache).toBe(without);
  });
});

describe("buildClaudeCacheProfile", () => {
  it("returns null when there are no cache_control breakpoints", () => {
    const req = { model: "claude-sonnet-4", system: "plain system", messages: [{ role: "user", content: "hi" }] };
    expect(buildClaudeCacheProfile(req, 100)).toBeNull();
  });

  it("returns breakpoints when cache_control ephemeral is present", () => {
    const profile = buildClaudeCacheProfile(makeReq("claude-sonnet-4", BIG_TEXT), 20000);
    expect(profile).not.toBeNull();
    expect(profile.breakpoints.length).toBeGreaterThanOrEqual(1);
    expect(profile.totalInputTokens).toBeGreaterThanOrEqual(profile.breakpoints.at(-1).cumulativeTokens);
  });
});

describe("KiroCacheTracker compute/update", () => {
  it("first request reports cache_creation, repeat reports cache_read", () => {
    const tracker = new KiroCacheTracker();
    const profile = buildClaudeCacheProfile(makeReq("claude-sonnet-4", BIG_TEXT), 20000);

    const first = tracker.compute("conn-1", profile);
    tracker.update("conn-1", profile);
    expect(first.cacheCreationInputTokens).toBeGreaterThan(0);
    expect(first.cacheReadInputTokens).toBe(0);

    const second = tracker.compute("conn-1", profile);
    tracker.update("conn-1", profile);
    expect(second.cacheReadInputTokens).toBeGreaterThan(0);
    expect(second.cacheCreationInputTokens).toBe(0);
  });

  it("scopes cache state by connectionId", () => {
    const tracker = new KiroCacheTracker();
    const profile = buildClaudeCacheProfile(makeReq("claude-sonnet-4", BIG_TEXT), 20000);
    tracker.compute("conn-A", profile);
    tracker.update("conn-A", profile);

    // A different connection has never seen this prefix -> behaves like a first request.
    const other = tracker.compute("conn-B", profile);
    expect(other.cacheReadInputTokens).toBe(0);
    expect(other.cacheCreationInputTokens).toBeGreaterThan(0);
  });

  it("expires entries after the TTL window (5m default)", () => {
    const tracker = new KiroCacheTracker();
    const profile = buildClaudeCacheProfile(makeReq("claude-sonnet-4", BIG_TEXT), 20000);
    const t0 = 1_000_000;
    tracker.compute("c", profile, t0);
    tracker.update("c", profile, t0);

    const t1 = t0 + 6 * 60 * 1000; // 6 minutes later > 5m TTL
    const later = tracker.compute("c", profile, t1);
    expect(later.cacheReadInputTokens).toBe(0);
    expect(later.cacheCreationInputTokens).toBeGreaterThan(0);
  });

  it("honors an explicit 1h TTL breakpoint", () => {
    const tracker = new KiroCacheTracker();
    const req = makeReq("claude-sonnet-4", BIG_TEXT);
    req.system[0].cache_control.ttl = "1h";
    const profile = buildClaudeCacheProfile(req, 20000);
    const t0 = 1_000_000;
    tracker.compute("c", profile, t0);
    tracker.update("c", profile, t0);

    const afterSixMinutes = tracker.compute("c", profile, t0 + 6 * 60 * 1000);
    expect(afterSixMinutes.cacheReadInputTokens).toBeGreaterThan(0);

    // The hit above refreshes the sliding TTL; expire one hour after that hit.
    const afterRefreshedHour = tracker.compute("c", profile, t0 + 67 * 60 * 1000);
    expect(afterRefreshedHour.cacheReadInputTokens).toBe(0);
    expect(afterRefreshedHour.cacheCreationInputTokens).toBeGreaterThan(0);
  });

  it("applies a higher minimum cacheable threshold for Opus (4096) vs default (1024)", () => {
    // MID_TEXT ~1885 tokens: above default 1024, below Opus 4096.
    const sonnet = buildClaudeCacheProfile(makeReq("claude-sonnet-4", MID_TEXT), 20000);
    const opus = buildClaudeCacheProfile(makeReq("claude-opus-4", MID_TEXT), 20000);

    expect(new KiroCacheTracker().compute("c", sonnet).cacheCreationInputTokens).toBeGreaterThan(0);
    expect(new KiroCacheTracker().compute("c", opus).cacheCreationInputTokens).toBe(0);
  });

  it("does not report creation for prefixes below the 1024 threshold", () => {
    const profile = buildClaudeCacheProfile(makeReq("claude-sonnet-4", "tiny system prompt"), 500);
    // still has a breakpoint (cache_control present), but below threshold
    expect(profile).not.toBeNull();
    const r = new KiroCacheTracker().compute("c", profile);
    expect(r.cacheCreationInputTokens).toBe(0);
    expect(r.cacheReadInputTokens).toBe(0);
  });

  it("ignores x-anthropic-billing-header content when matching a cached prefix", () => {
    const tracker = new KiroCacheTracker();
    const reqA = makeReq("claude-sonnet-4", BIG_TEXT, "Hello there, please help me today.");
    const pA = buildClaudeCacheProfile(reqA, 20000);
    tracker.compute("c", pA);
    tracker.update("c", pA);

    // Same request, but the user message now carries a volatile billing-header
    // text block ahead of the identical hello block. It must be excluded from
    // the fingerprint so the prefix still matches.
    const reqB = {
      ...reqA,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.201; cc_entrypoint=cli" },
          { type: "text", text: "Hello there, please help me today." },
        ],
      }],
    };
    const pB = buildClaudeCacheProfile(reqB, 20000);
    const r = tracker.compute("c", pB);
    expect(r.cacheReadInputTokens).toBeGreaterThan(0);
  });
});

describe("applyKiroCacheAccounting integration with canonicalizeUsage", () => {
  it("leaves usage unchanged for non-Kiro providers", () => {
    const usage = { prompt_tokens: 100, completion_tokens: 10 };
    const out = applyKiroCacheAccounting({
      provider: "openai", sourceFormat: "claude",
      body: makeReq("claude-sonnet-4", BIG_TEXT), model: "x", connectionId: "c", usage,
    });
    expect(out).toEqual(usage);
  });

  it("leaves usage unchanged for non-Claude source formats", () => {
    const usage = { prompt_tokens: 100, completion_tokens: 10 };
    const out = applyKiroCacheAccounting({
      provider: "kiro", sourceFormat: "openai",
      body: makeReq("claude-sonnet-4", BIG_TEXT), model: "x", connectionId: "c", usage,
    });
    expect(out).toEqual(usage);
  });

  it("preserves real upstream cache fields instead of applying the heuristic", () => {
    const usage = {
      prompt_tokens: 100,
      completion_tokens: 10,
      cache_read_input_tokens: 25,
    };
    const out = applyKiroCacheAccounting({
      provider: "kiro", sourceFormat: "claude",
      body: makeReq("claude-sonnet-4", BIG_TEXT), model: "claude-sonnet-4",
      connectionId: "c", usage,
    });
    expect(out).toBe(usage);
  });

  it("first Kiro+Claude request: reports creation, canonical total stays inclusive", () => {
    const tracker = new KiroCacheTracker();
    const usage = { prompt_tokens: 20000, completion_tokens: 100, total_tokens: 20100 };
    const merged = applyKiroCacheAccounting({
      provider: "kiro", sourceFormat: "claude",
      body: makeReq("claude-sonnet-4", BIG_TEXT), model: "claude-sonnet-4",
      connectionId: "cc", usage, tracker,
    });
    expect(merged.cache_creation_input_tokens).toBeGreaterThan(0);
    expect(merged.cache_read_input_tokens).toBeUndefined();
    // prompt_tokens is reduced to the cache-exclusive (billed) portion
    expect(merged.prompt_tokens).toBe(20000 - merged.cache_creation_input_tokens);

    const canon = canonicalizeUsage(merged);
    expect(canon.prompt_tokens).toBe(20000); // inclusive total preserved
    expect(canon.cache_creation_input_tokens).toBe(merged.cache_creation_input_tokens);
    expect(canon.cached_tokens).toBe(0);
  });

  it("repeat Kiro+Claude request: reports read, canonical folds cache back into prompt", () => {
    const tracker = new KiroCacheTracker();
    const body = makeReq("claude-sonnet-4", BIG_TEXT);
    applyKiroCacheAccounting({
      provider: "kiro", sourceFormat: "claude", body, model: "claude-sonnet-4",
      connectionId: "cc", usage: { prompt_tokens: 20000, completion_tokens: 100 }, tracker,
    });
    const merged2 = applyKiroCacheAccounting({
      provider: "kiro", sourceFormat: "claude", body, model: "claude-sonnet-4",
      connectionId: "cc", usage: { prompt_tokens: 20000, completion_tokens: 100 }, tracker,
    });
    expect(merged2.cache_read_input_tokens).toBeGreaterThan(0);
    expect(merged2.cache_creation_input_tokens).toBeUndefined();

    const canon = canonicalizeUsage(merged2);
    expect(canon.prompt_tokens).toBe(20000);
    expect(canon.cached_tokens).toBe(merged2.cache_read_input_tokens);
  });
});
