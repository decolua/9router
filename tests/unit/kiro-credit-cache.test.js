import { describe, expect, it } from "vitest";
import { KiroCreditCache } from "../../open-sse/services/kiroCreditCache.js";

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
const observation = (credits, outputTokens = 20) => ({ credits, outputTokens, complete: true });
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
  it("has no fixed savings; requires two comparable successful cold/warm pairs", () => {
    const cache = new KiroCreditCache();
    const req = request();
    for (const credits of [10, 2, 2]) expect(finish(cache, req, credits)).toEqual(usage);
    const p = cache.prepare(req);
    expect(cached(p)).toBe(8000);
    expect(p.apply(usage).prompt_tokens).toBe(10000);
    p.complete(observation(8), true);
    expect(cached(p)).toBe(8000); // frozen plan, even after late metering
    expect(cached(cache.prepare(req))).toBe(2000); // adverse evidence applies immediately
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
    expect(cached(cache.prepare(next))).toBe(8000);
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

  it.each([["claude-opus-5", 5], ["gpt-5.6-terra", 30]])("uses %s sliding TTL (%i minutes)", (model, minutes) => {
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
    expect(cached(cache.prepare(req))).toBe(8000);
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
    expect(cached(cache.prepare(req))).toBe(8000);
    const overlap = new KiroCreditCache();
    const plans = Array.from({ length: 10 }, () => overlap.prepare(req));
    for (const plan of plans.reverse()) {
      plan.complete(observation(2), true);
      plan.complete(observation(10), true);
    }
    expect(cached(overlap.prepare(req))).toBe(0);
  });

  it("does not pair differing output counts or inference configurations", () => {
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
    expect(cache.prepare(request("claude-sonnet-4.6"))).toBeNull();
  });

  it.each([["claude-opus-5", 5], ["gpt-5.6-terra", 30]])("failed %s observations do not slide TTL", (model, minutes) => {
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
    expect(cached(cache.prepare(request()))).toBe(8000);
  });
});
