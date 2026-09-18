import { describe, expect, it } from "vitest";
import { KiroCreditCache, inferKiroCacheReuse } from "../../open-sse/services/kiroCreditCache.js";

import { resolveKiroCachePolicy } from "../../open-sse/config/kiroConstants.js";

const MINUTE = 60_000;
const user = (content = "cacheable input ".repeat(1400)) => ({ userInputMessage: {
  content, modelId: "claude-opus-5", origin: "AI_EDITOR"
} });
function request(model = "claude-opus-5", session = "session-a") {
  const currentMessage = user();
  currentMessage.userInputMessage.modelId = model;
  return {
    endpoint: "https://q.example/generate",
    credentials: { connectionId: "account-a", accessToken: "fixture-oauth" },
    body: { conversationState: { conversationId: session, agentContinuationId: "continuation",
      currentMessage, history: [], chatTriggerType: "MANUAL" }, inferenceConfig: { maxTokens: 100 } }
  };
}
const usage = { prompt_tokens: 10000, completion_tokens: 20, total_tokens: 10020 };
const observation = (credits, outputTokens = 20) => ({ credits, outputTokens, inputTokens: 10000, totalTokens: 10000 + outputTokens, complete: true });
function finish(cache, req, credits, success = true) {
  const p = cache.prepare(req);
  const result = p.apply(usage);
  p.complete(observation(credits), success);
  return result;
}
function train(cache, req) {
  for (const credits of [10, 2, 2]) finish(cache, req, credits);
}
const cached = (plan) => plan?.apply(usage).prompt_tokens_details?.cached_tokens || 0;

describe("native-credit cache calibration", () => {
  it("uses the existing 90% bound on early warm calls, then two comparable pairs take over", () => {
    const cache = new KiroCreditCache();
    const req = request();
    expect(finish(cache, req, 10)).toEqual(usage);
    for (const credits of [2, 2]) {
      expect(finish(cache, req, credits).prompt_tokens_details.cached_tokens).toBe(9000);
    }
    const p = cache.prepare(req);
    expect(cached(p)).toBe(10000);
    expect(p.apply(usage).prompt_tokens).toBe(10000);
    p.complete(observation(8), true);
    expect(cached(p)).toBe(10000); // frozen plan, even after late metering
    expect(cached(cache.prepare(req))).toBeCloseTo(10000 * 0.2 / 0.475, -1); // adverse evidence applies immediately
  });

  it("matches an append-only ladder with current/history wrappers normalized", () => {
    const cache = new KiroCreditCache();
    const req = request();
    finish(cache, req, 10);
    for (const credits of [3, 4]) {
      req.body.conversationState.history.push(req.body.conversationState.currentMessage,
        { assistantResponseMessage: { content: "answer" } });
      req.body.conversationState.currentMessage = user("next question");
      finish(cache, req, credits);
    }
    expect(cached(cache.prepare(req))).toBeGreaterThan(5000);
  });

  it("shares Opus calibration across sessions and OAuth rotation, but isolates accounts, endpoints, profiles, models and API keys", () => {
    const cache = new KiroCreditCache();
    train(cache, request());
    const next = request("claude-opus-5", "session-b");
    next.credentials.accessToken = "rotated-fixture-oauth";
    expect(cached(cache.prepare(next))).toBe(10000);
    for (const change of [
      r => { r.credentials.connectionId = "account-b"; },
      r => { r.endpoint += "/other"; },
      r => { r.body.profileArn = "fixture-profile"; },
      r => { r.body.conversationState.agentContinuationId = "different-continuation"; },
      r => { r.body.conversationState.currentMessage.userInputMessage.modelId = "gpt-5.6-terra"; },
    ]) {
      const r = request(); change(r);
      expect(cached(cache.prepare(r))).toBe(0);
    }
    const keyReq = request();
    keyReq.credentials.providerSpecificData = { authMethod: "api_key" };
    train(cache, keyReq);
    keyReq.credentials.accessToken = "different-fixture-key";
    expect(cached(cache.prepare(keyReq))).toBe(0);
  });

  it.each([["claude-opus-5", 5], ["claude-sonnet-6", 5], ["haiku-5", 5],
    ["gpt-5.6-terra", 30], ["gpt-5.6-luna", 30], ["sol", 30]])("uses %s sliding TTL (%i minutes)", (model, minutes) => {
    let now = 0;
    const cache = new KiroCreditCache({ now: () => now });
    const req = request(model);
    train(cache, req);
    now += (minutes - 1) * MINUTE;
    const probe = cache.prepare(req);
    expect(cached(probe)).toBeGreaterThan(0);
    probe.complete(null, false);
    finish(cache, req, 2);
    finish(cache, req, 2);
    now += 2 * MINUTE;
    expect(cached(cache.prepare(req))).toBeGreaterThan(0);
    now += minutes * MINUTE;
    expect(cached(cache.prepare(req))).toBe(0);
  });

  it("makes a different GPT conversation cold", () => {
    const cache = new KiroCreditCache();
    train(cache, request("gpt-5.6-terra"));
    expect(cached(cache.prepare(request("gpt-5.6-terra", "other")))).toBe(0);
    const req = request("gpt-5.6-terra");
    delete req.body.conversationState.conversationId;
    expect(cache.prepare(req)).toBeNull();
  });

  it.each([0, -1, NaN, Infinity, undefined, null, "2"])("rejects invalid credits %s without renewing warmth", credits => {
    const cache = new KiroCreditCache();
    const req = request();
    finish(cache, req, credits);
    train(cache, req);
    expect(cached(cache.prepare(req))).toBe(10000);
  });

  it("failed, incomplete, slow and overlapping requests cannot calibrate", () => {
    let now = 0;
    const cache = new KiroCreditCache({ now: () => now });
    const req = request();
    finish(cache, req, 10, false);
    const p = cache.prepare(req);
    p.complete({ ...observation(10), complete: false }, true);
    const slow = cache.prepare(req);
    now += 6 * MINUTE;
    slow.complete(observation(10), true);
    train(cache, req);
    expect(cached(cache.prepare(req))).toBe(10000);
    const overlap = new KiroCreditCache();
    const plans = Array.from({ length: 10 }, () => overlap.prepare(req));
    for (const plan of plans.reverse()) {
      plan.complete(observation(2), true);
      plan.complete(observation(10), true);
    }
    expect([...overlap.scopes.values()][0].pairs).toHaveLength(0);
    expect(cached(overlap.prepare(req))).toBe(9000); // only static fallback, no learned ratio
  });

  it("does not pair differing inference configurations", () => {
    const cache = new KiroCreditCache();
    const req = request();
    finish(cache, req, 10);
    for (let i = 0; i < 3; i++) cache.prepare(req).complete(observation(2, 30), true);
    req.body.inferenceConfig.maxTokens++;
    for (let i = 0; i < 3; i++) finish(cache, req, 2);
    expect(cached(cache.prepare(req))).toBe(0);
  });

  it("keeps fully cached native input authoritative without double counting", () => {
    const cache = new KiroCreditCache();
    const req = request(); train(cache, req);
    const native = { ...usage, prompt_tokens_details: { cached_tokens: 10000 } };
    expect(cache.prepare(req).apply(native)).toEqual(native);
    expect(cache.prepare(request("unknown-model"))).toBeNull();
  });

  it.each([["claude-opus-5", 5], ["claude-sonnet-6", 5], ["haiku-5", 5],
    ["gpt-5.6-terra", 30], ["gpt-5.6-luna", 30], ["sol", 30]])("failed %s observations do not slide TTL", (model, minutes) => {
    let now = 0;
    const cache = new KiroCreditCache({ now: () => now });
    const req = request(model); train(cache, req);
    now = minutes * MINUTE - 1;
    finish(cache, req, 2, false);
    now += 2;
    expect(cached(cache.prepare(req))).toBe(0);
  });

  it("retains semantic order and tool/image/continuation differences, but ignores object key order", () => {
    const req = request();
    req.body.conversationState.currentMessage.userInputMessage.userInputMessageContext = {
      tools: [{ name: "one", schema: { type: "object" } }, { name: "two" }]
    };
    const cache = new KiroCreditCache(); train(cache, req);
    const reordered = structuredClone(req);
    reordered.body.inferenceConfig = Object.fromEntries(Object.entries(req.body.inferenceConfig).reverse());
    expect(cached(cache.prepare(reordered))).toBeGreaterThan(0);
    for (const change of [
      r => r.body.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools.reverse(),
      r => { r.body.conversationState.currentMessage.userInputMessage.images = [{ source: { bytes: "fixture-image" } }]; },
      r => { r.body.conversationState.agentContinuationId = "new-continuation"; },
    ]) {
      const r = structuredClone(req); change(r);
      expect(cached(cache.prepare(r))).toBe(0);
    }
  });

  it("bounds per-account scopes without evicting another account's calibration", () => {
    const cache = new KiroCreditCache(); train(cache, request());
    for (let i = 0; i < 32; i++) {
      const r = request("gpt-5.6-terra", `session-${i}`);
      r.credentials.connectionId = "other-account";
      cache.prepare(r).complete(null, false);
    }
    const r = request("gpt-5.6-terra", "overflow"); r.credentials.connectionId = "other-account";
    expect(cache.prepare(r)).toBeNull();
    expect(cached(cache.prepare(request()))).toBe(10000);
  });
});

const familyModels = [
  ...["claude-opus-5", "claude-sonnet-4.6", "claude-haiku-4.5", "claude-3-5-sonnet",
    "claude-opus-9.2", "claude-future", "opus-5", "sonnet", "haiku-7",
    " CLAUDE_OPUS_5 ", "Claude.Sonnet.6", "kiro/claude-haiku-5", "kr/opus-5",
    "anthropic.claude-sonnet-4-6", "claude-sonnet-5-thinking-agentic"
  ].map(model => [model, 5, false]),
  ...["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-7.2", "gpt-next",
    "terra", "luna", "sol", " TERRA ", "GPT_5_6_LUNA", "GPT.7.2",
    "kr/gpt-6", "kiro/luna", "openai/gpt-7", "gpt-5.6-sol-thinking-agentic",
    "luna-thinking-agentic"
  ].map(model => [model, 30, true]),
];

describe("Kiro cache family policies", () => {
  it.each(familyModels)("%s calibrates with a %i minute window (conversation scoped: %s)", (model, minutes, scoped) => {
    let now = 0;
    const cache = new KiroCreditCache({ now: () => now });
    const req = request(model);
    const eligible = cache.prepare(req);
    expect(eligible).not.toBeNull();
    eligible.complete(null, false);
    const short = request(model);
    short.body.conversationState.currentMessage.userInputMessage.content = "x".repeat(5000);
    const shortPlan = cache.prepare(short);
    expect(shortPlan !== null).toBe(scoped); // GPT minimum 1,024; Claude minimum 4,096.
    shortPlan?.complete(null, false);
    const tracker = new KiroCreditCache({ now: () => now });
    train(tracker, req);
    const probe = r => {
      const p = tracker.prepare(r);
      const read = cached(p);
      p?.complete(null, false);
      return read;
    };
    const warm = probe(req);
    // Existing conservative floor can lose one token through floating-point arithmetic.
    expect(warm).toBeGreaterThanOrEqual(9999);
    expect(warm).toBeLessThanOrEqual(10000);
    expect(probe(request(model, "other"))).toBe(scoped ? 0 : warm);
    const missing = request(model); delete missing.body.conversationState.conversationId;
    expect(probe(missing)).toBe(scoped ? 0 : warm);
    now = minutes * MINUTE - 1;
    expect(probe(req)).toBe(warm);
    now++;
    expect(probe(req)).toBe(0);
  });

  it.each([undefined, null, 5, {}, "", "auto", "unknown-model", "not-claude-opus-5",
    "claudette", "gptish", "my-gpt-5", "lunar", "terra-unknown", "claude-gpt-5",
    "gpt-claude-5", "openai/claude-opus-5", "anthropic/gpt-5", "unknown/claude-5"])(
    "disables unknown or ambiguous model %s without allocating state", model => {
      const cache = new KiroCreditCache();
      const req = request(); req.body.conversationState.currentMessage.userInputMessage.modelId = model;
      expect(cache.prepare(req)).toBeNull();
      expect(cache.scopes.size).toBe(0);
    });

  it.each([["claude-sonnet-5", "claude-haiku-5"], ["gpt-5.6-luna", "gpt-5.6-sol"]])(
    "keeps %s calibration isolated from another model in its family (%s)", (model, other) => {
      const cache = new KiroCreditCache(); train(cache, request(model));
      expect(cached(cache.prepare(request(other)))).toBe(0);
    });
});


describe("real-traffic credit calibration", () => {
  const observed = (credits, inputTokens, outputTokens, totalTokens = inputTokens + outputTokens) =>
    ({ credits, inputTokens, outputTokens, totalTokens, complete: true });
  it("uses configured fallback only on proven warmth, then normalized dynamic savings", () => {
    const cache = new KiroCreditCache({ staticReadRatio: 0.4 });
    const req = request();
    const cold = cache.prepare(req); expect(cached(cold)).toBe(0);
    cold.complete(observed(10, 9000, 1000), true);
    const warm1 = cache.prepare(req); expect(cached(warm1)).toBe(4000);
    warm1.complete(observed(9, 9000, 3000), true);
    const warm2 = cache.prepare(req); expect(cached(warm2)).toBe(4000);
    warm2.complete(observed(8, 9000, 1000), true);
    const dynamic = cache.prepare(req);
    expect(cached(dynamic)).toBeCloseTo(10000 * 0.2 / 0.475, -1); // min savings = 0.2
    expect(cached(warm2)).toBe(4000); // prepared estimate stays frozen
  });
  it("dynamic zero overrides static fallback even with unequal outputs", () => {
    const cache = new KiroCreditCache({ staticReadRatio: 0.8 });
    const req = request();
    cache.prepare(req).complete(observed(10, 9000, 1000), true);
    cache.prepare(req).complete(observed(12, 9000, 3000), true); // equal density => zero
    cache.prepare(req).complete(observed(2, 9000, 500), true);
    expect(cached(cache.prepare(req))).toBe(0);
  });
  it.each([undefined, 0, -1, NaN, Infinity])("uses safe input + output when total is %s", total => {
    const cache = new KiroCreditCache(); const req = request();
    const cold = observed(10, 9000, 1000); cold.totalTokens = total;
    cache.prepare(req).complete(cold, true);
    cache.prepare(req).complete(observed(8, 9000, 1000), true);
    cache.prepare(req).complete(observed(15, 9000, 11000), true);
    expect(cached(cache.prepare(req))).toBeCloseTo(10000 * 0.2 / 0.475, -1);
  });
  it("prefers an actual total, and skips invalid normalization instead of training", () => {
    const cache = new KiroCreditCache(); const req = request();
    cache.prepare(req).complete(observed(10, 9000, 1000, 20000), true);
    cache.prepare(req).complete(observed(8, 9000, 1000, 20000), true);
    cache.prepare(req).complete(observed(9, 9000, 2000, 24000), true);
    expect(cached(cache.prepare(req))).toBeCloseTo(10000 * 0.2 / 0.475, -1);
    const invalid = new KiroCreditCache();
    invalid.prepare(req).complete({ credits:10, outputTokens:20, complete:true }, true);
    expect([...invalid.scopes.values()][0].samples.size).toBe(0);
  });
  it("bounds startup estimates to the matched prefix and preserves explicit native zero", () => {
    const cache = new KiroCreditCache({ staticReadRatio: 0.4 }); const req = request();
    cache.prepare(req).complete(observed(10, 9000, 1000), true);
    req.body.conversationState.history.push(req.body.conversationState.currentMessage,
      { assistantResponseMessage: { content: "answer" } });
    req.body.conversationState.currentMessage = user("new uncached content ".repeat(2000));
    const p = cache.prepare(req);
    expect(cached(p)).toBeGreaterThan(0); expect(cached(p)).toBeLessThan(4000);
    const native = { ...usage, prompt_tokens_details: { cached_tokens: 0 } };
    expect(p.apply(native)).toBe(native);
  });
});


describe("startup fallback isolation", () => {
  it.each([["claude-sonnet-5", 5, false], ["gpt-5.6-luna", 30, true]])("%s keeps model/account/endpoint/TTL isolation", (model, minutes, scoped) => {
    let now = 0;
    const cache = new KiroCreditCache({ now: () => now, staticReadRatio: 0.4 });
    const req = request(model);
    cache.prepare(req).complete(observation(10), true);
    const probe = r => { const p = cache.prepare(r); const read = cached(p); p?.complete(null, false); return read; };
    expect(probe(request(model, "other-session"))).toBe(scoped ? 0 : 4000);
    for (const change of [
      r => { r.credentials.connectionId = "other-account"; },
      r => { r.endpoint += "/other"; },
      r => { r.body.conversationState.currentMessage.userInputMessage.modelId = model + "-future"; },
      r => { r.body.conversationState.agentContinuationId = "other-continuation"; },
    ]) { const r = request(model); change(r); expect(probe(r)).toBe(0); }
    expect(probe(req)).toBe(4000);
    now = minutes * MINUTE;
    expect(probe(req)).toBe(0);
  });
  it.each([0, -1, NaN, Infinity])("invalid/disabled static ratio %s cannot create an estimate", staticReadRatio => {
    const cache = new KiroCreditCache({ staticReadRatio }); const req = request();
    cache.prepare(req).complete(observation(10), true);
    expect(cached(cache.prepare(req))).toBe(0);
  });
});


describe("density bounds and recovery", () => {
  it("keeps the lowest cold density when a prefix turns cold again", () => {
    let now = 0; const cache = new KiroCreditCache({ now: () => now }); const req = request();
    const observe = credits => cache.prepare(req).complete(observation(credits), true);
    observe(10);
    now = 6 * MINUTE; observe(4);
    observe(3.5); observe(3.5);
    expect(cached(cache.prepare(req))).toBeCloseTo(10000 * 0.125 / 0.475, -1);
  });
  it("retains authoritative zero until its pair leaves the eight-pair window", () => {
    const cache = new KiroCreditCache({ staticReadRatio: 0.4 }); const req = request();
    cache.prepare(req).complete(observation(10), true);
    cache.prepare(req).complete(observation(12), true);
    for (let i = 0; i < 8; i++) {
      const outputTokens = 100 + i * 71, totalTokens = 10000 + outputTokens;
      const p = cache.prepare(req);
      if (i > 0) expect(cached(p)).toBe(0);
      p.complete({ ...observation(2 * totalTokens / 10020, outputTokens), totalTokens }, true);
    }
    expect(cached(cache.prepare(req))).toBeGreaterThanOrEqual(9999);
  });
  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER, undefined])("invalid fallback input %s cannot train density", inputTokens => {
    const cache = new KiroCreditCache(); const req = request();
    cache.prepare(req).complete({ credits:10, inputTokens, outputTokens:20, complete:true }, true);
    expect([...cache.scopes.values()][0].samples.size).toBe(0);
  });
});


describe("family credit discounts", () => {
  it.each([["gpt-5.6-sol", 0.523], ["luna", 0.523], ["claude-opus-5", 0.525],
    ["Claude.Sonnet.6", 0.525]])("%s converts savings only after calibration", (model, d) => {
    const cache = new KiroCreditCache(); const req = request(model);
    expect(finish(cache, req, 10).prompt_tokens_details).toBeUndefined();
    expect(finish(cache, req, 8).prompt_tokens_details.cached_tokens).toBe(9000);
    expect(finish(cache, req, 8).prompt_tokens_details.cached_tokens).toBe(9000);
    const plan = cache.prepare(req);
    expect(cached(plan)).toBeCloseTo(Math.floor(10000 * 0.2 / (1 - d)), -1);
    plan.complete(observation(10), true);
    expect(cached(cache.prepare(req))).toBe(0); // calibrated zero, no fallback
  });
  it.each(["claude-opus-5", "gpt-5.6-luna"])("%s clamps inferred reuse to its structural prefix", model => {
    const cache = new KiroCreditCache(); const req = request(model); train(cache, req);
    const full = cache.prepare(req); expect(cached(full)).toBe(10000); full.complete(null, false);
    const structural = new KiroCreditCache({ staticReadRatio: 1 });
    finish(structural, req, 10);
    req.body.conversationState.history.push(req.body.conversationState.currentMessage);
    const current = user("uncached new input ".repeat(3000)); current.userInputMessage.modelId = model;
    req.body.conversationState.currentMessage = current;
    const bound = cached(structural.prepare(req));
    expect(bound).toBeGreaterThan(0); expect(bound).toBeLessThan(10000);
    expect(cached(cache.prepare(req))).toBe(bound);
  });
  it("does not share discount calibration across exact model IDs", () => {
    const cache = new KiroCreditCache(); train(cache, request("gpt-5.6-luna"));
    expect(cached(cache.prepare(request("gpt-5.6-luna")))).toBe(10000);
    expect(cached(cache.prepare(request("gpt-5.6-sol")))).toBe(0);
    expect(cache.prepare(request("unknown-model"))).toBeNull();
  });
});


describe("credit savings conversion bounds", () => {
  it.each([["gpt-5.6-sol", 0.523], ["claude-sonnet-5", 0.525]])("%s uses its family discount", (model, d) => {
    const policy = resolveKiroCachePolicy(model);
    expect(policy.cachedCreditRatio).toBe(d);
    expect(inferKiroCacheReuse(0.2, policy)).toBeCloseTo(0.2 / (1 - d), 12);
    expect(inferKiroCacheReuse(0, policy)).toBe(0);
    expect(inferKiroCacheReuse(-0.2, policy)).toBe(0);
    expect(inferKiroCacheReuse(1, policy)).toBe(1);
  });
  it("leaves savings unchanged for unknown or uncalibrated policies", () => {
    const unknown = resolveKiroCachePolicy("unknown-model"); expect(unknown).toBeNull();
    for (const policy of [unknown, {}]) {
      expect(inferKiroCacheReuse(0.2, policy)).toBe(0.2);
      expect(inferKiroCacheReuse(0, policy)).toBe(0);
      expect(inferKiroCacheReuse(0.9, policy)).toBe(0.9);
    }
  });
});
