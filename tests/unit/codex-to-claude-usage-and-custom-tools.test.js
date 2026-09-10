/**
 * Two regressions on the openai-responses -> claude route (Codex app talking to
 * an Anthropic-compatible connection). Both come from the same structural fact:
 * there is no direct `openai-responses:claude` translator, so translateRequest()
 * pivots openai-responses -> openai -> claude, and the response side comes back
 * claude -> openai -> openai-responses.
 *
 * 1. Token double-count. claude-to-openai folds Claude's cache-exclusive
 *    input_tokens into a cache-inclusive prompt_tokens, but did not set the
 *    top-level `cached_tokens` key that canonicalizeUsage() uses as its
 *    already-folded marker. saveUsageStats() therefore folded the cache totals a
 *    second time, so usageHistory recorded roughly double what requestDetails did
 *    (observed in production: 483,711 stored vs 967,422 reported for one request,
 *    and rows above 1.4M -- larger than the model context window).
 *
 * 2. Lost custom tool names. openai-responses sets `_customToolNames` for
 *    Responses-API custom/freeform tools; openai-to-claude built a fresh result
 *    object and dropped it, so chatCore saw undefined and emitted `function_call`
 *    with a JSON `{"input": ...}` wrapper instead of `custom_tool_call` with the
 *    raw freeform program.
 *
 * 3. Never-compacting client. sendCompleted() synthesized response.completed
 *    without `usage`. Codex sizes its context from that field, so every turn
 *    read as free, it never hit its compaction threshold, and history grew
 *    +2 messages/turn until the upstream returned 400 context_length_exceeded
 *    (production: 1,022,873 estimated input against a 1,000,000 window).
 *
 * 4. Account punished for a request-scoped error. That same 400 was classified
 *    as account-unavailable, locking modelLock_claude-sonnet-5 on both accounts
 *    and retrying an identical payload that could only fail again.
 *
 * 5. message_stop reported a cache-exclusive prompt_tokens. Streams that end
 *    without a stop_reason-bearing message_delta took a second usage-building
 *    path that read input_tokens (cache-EXCLUSIVE) as prompt_tokens and emitted
 *    no cached_tokens at all.
 *
 * 6. A provider reset hint outranked the request-scoped verdict.
 *    markAccountUnavailable() hardcoded shouldFallback = true in its
 *    githubResetAtMs / resetsAtMs branches, so a fallback:false error arriving
 *    alongside one of those hints still locked the account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  ...dbMocks,
  validateApiKey: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { toResponsesUsage } from "../../open-sse/translator/concerns/usage.js";
import { applyErrorState, checkFallbackError } from "../../open-sse/services/accountFallback.js";

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const freshState = () => ({ id: "chatcmpl-test", created: 0, model: "claude-sonnet-4-5" });

// Drive the streaming translator the way stream.js does: one shared state object
// across message_start -> message_delta.
function runClaudeStream(startUsage, deltaUsage) {
  const state = freshState();
  claudeToOpenAIResponse({ type: "message_start", message: { model: "claude-sonnet-4-5", usage: startUsage } }, state);
  claudeToOpenAIResponse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: deltaUsage }, state);
  return state.usage;
}

describe("claude-to-openai usage is canonicalizeUsage-idempotent", () => {
  it("does not fold cache_read into prompt_tokens a second time", () => {
    // Real shape of the production request that reported 967,422:
    // input 0, cache_read 481,799, cache_creation 1,912 -> prompt 483,711.
    const usage = runClaudeStream(
      { input_tokens: 0, cache_read_input_tokens: 481799, cache_creation_input_tokens: 1912 },
      { output_tokens: 640 }
    );

    expect(usage.prompt_tokens).toBe(483711);
    expect(usage.cached_tokens).toBe(481799);

    const canonical = canonicalizeUsage(usage);
    expect(canonical.prompt_tokens).toBe(483711); // was 967,422
    expect(canonical.cached_tokens).toBe(481799);
    expect(canonical.completion_tokens).toBe(640);
  });

  it("marks a cache-creation-only first write as folded too (cached_tokens 0)", () => {
    // The marker must be set unconditionally: gating it on cache_read > 0 leaves
    // first-write requests (creation only, no read) double-folded.
    const usage = runClaudeStream(
      { input_tokens: 12, cache_creation_input_tokens: 8000 },
      { output_tokens: 30 }
    );

    expect(usage.prompt_tokens).toBe(8012);
    expect(usage.cached_tokens).toBe(0);
    expect(canonicalizeUsage(usage).prompt_tokens).toBe(8012); // was 16,012
  });

  it("leaves a no-cache request untouched through both folds", () => {
    const usage = runClaudeStream({ input_tokens: 500 }, { output_tokens: 20 });
    expect(usage.prompt_tokens).toBe(500);
    expect(usage.cached_tokens).toBe(0);
    expect(canonicalizeUsage(usage).prompt_tokens).toBe(500);
  });
});

describe("_customToolNames survives the openai-responses -> openai -> claude pivot", () => {
  const EXEC_TOOL = {
    type: "custom",
    name: "exec",
    description: "Run JavaScript code to orchestrate tool calls.",
    format: { type: "grammar", syntax: "lark", definition: "start: /(.|\\n)+/" },
  };

  it("carries the metadata through hop 2", () => {
    const hop1 = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [
        { type: "additional_tools", role: "developer", tools: [EXEC_TOOL] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Run pwd" }] },
      ],
      tool_choice: "auto",
    }, true, null);
    expect(hop1._customToolNames).toEqual(["exec"]);

    const hop2 = openaiToClaudeRequest("claude-sonnet-4-5", hop1, true);
    expect(hop2._customToolNames).toEqual(["exec"]);
  });

  it("adds nothing when the client declared no custom tools", () => {
    const hop2 = openaiToClaudeRequest("claude-sonnet-4-5", {
      messages: [{ role: "user", content: "hi" }],
    }, true);
    expect("_customToolNames" in hop2).toBe(false);
  });
});

describe("response.completed carries usage on the claude -> openai-responses pivot", () => {
  // Codex sizes its context from response.usage in response.completed and
  // compacts once that nears the model window. On a passthrough route the
  // upstream supplies the field; on this pivot 9router synthesizes the event,
  // so an empty response.completed reads as "this turn cost 0 tokens" and the
  // client never compacts -- history grows until the upstream rejects the
  // request with a 400 context_length_exceeded (observed in production at
  // ~1,022,873 estimated input tokens against a 1,000,000 window).
  function runPivot(startUsage, deltaUsage) {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [];
    const push = (chunk) => events.push(...translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, chunk, state));

    push({ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-5", usage: startUsage } });
    push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } });
    push({ type: "content_block_stop", index: 0 });
    push({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: deltaUsage });
    push(null); // flush

    return events.find(e => e.event === "response.completed")?.data?.response;
  }

  it("emits Responses-shaped usage, not the Chat spelling", () => {
    const response = runPivot(
      { input_tokens: 12, cache_read_input_tokens: 481799, cache_creation_input_tokens: 1912 },
      { output_tokens: 640 }
    );

    expect(response).toBeDefined();
    expect(response.usage).toBeDefined();
    // Chat keys would read as zero to a Responses-API client.
    expect(response.usage.prompt_tokens).toBeUndefined();
    expect(response.usage.input_tokens).toBe(483723);
    expect(response.usage.output_tokens).toBe(640);
    expect(response.usage.total_tokens).toBe(484363);
    // Responses contract: input_tokens already includes cached_tokens.
    expect(response.usage.input_tokens_details).toEqual({ cached_tokens: 481799 });
  });

  it("omits usage entirely when the upstream reported none", () => {
    // Better an absent field than input_tokens: 0, which a client would read as
    // a real measurement of an empty context.
    const response = runPivot(undefined, undefined);
    expect(response).toBeDefined();
    expect("usage" in response).toBe(false);
  });

  it("omits usage when every count came back zero", () => {
    const response = runPivot({ input_tokens: 0 }, { output_tokens: 0 });
    expect(response).toBeDefined();
    expect("usage" in response).toBe(false);
  });
});

describe("toResponsesUsage", () => {
  it("passes an already-Responses-shaped object through", () => {
    expect(toResponsesUsage({ input_tokens: 100, output_tokens: 20 }))
      .toEqual({ input_tokens: 100, output_tokens: 20, total_tokens: 120 });
  });

  it("forwards reasoning tokens under the Responses spelling", () => {
    const out = toResponsesUsage({
      prompt_tokens: 10, completion_tokens: 90, total_tokens: 100,
      completion_tokens_details: { reasoning_tokens: 64 }
    });
    expect(out.output_tokens_details).toEqual({ reasoning_tokens: 64 });
  });

  it("returns null for nothing worth sending", () => {
    expect(toResponsesUsage(null)).toBeNull();
    expect(toResponsesUsage({})).toBeNull();
    expect(toResponsesUsage({ prompt_tokens: 0, completion_tokens: 0 })).toBeNull();
  });
});

describe("context_length_exceeded is request-scoped, not account-scoped", () => {
  // The body is identical on every retry, so a second account rejects it the
  // same way: falling back burns an extra upstream call and the cooldown pulls
  // a healthy account out of rotation for unrelated short traffic on the model.
  const CLE = 'Model "claude-sonnet-5" supports at most 1000000 input tokens; ' +
    'estimated request input is 1022873 tokens (type: context_length_exceeded)';

  it("does not fall back and does not cool the account down", () => {
    expect(checkFallbackError(400, CLE)).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("leaves rateLimitedUntil untouched", () => {
    const account = { id: "a1", backoffLevel: 0, rateLimitedUntil: null };
    expect(applyErrorState(account, 400, CLE).rateLimitedUntil).toBeNull();
  });

  it("still falls back on a genuine rate limit", () => {
    const result = checkFallbackError(429, "rate limit exceeded", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});

describe("message_stop reports a cache-inclusive prompt_tokens", () => {
  // Streams that end on message_stop without a stop_reason-bearing message_delta
  // take a second usage-building path. It used to read input_tokens, which is
  // cache-EXCLUSIVE on Claude, so the client saw a prompt understated by the
  // whole cache component and no cached_tokens at all.
  function runToStop(startUsage, deltaUsage) {
    const state = freshState();
    claudeToOpenAIResponse({ type: "message_start", message: { model: "claude-sonnet-4-5", usage: startUsage } }, state);
    if (deltaUsage) claudeToOpenAIResponse({ type: "message_delta", delta: {}, usage: deltaUsage }, state);
    const out = claudeToOpenAIResponse({ type: "message_stop" }, state);
    return out?.[0];
  }

  it("folds cache into prompt_tokens and reports cached_tokens", () => {
    const chunk = runToStop(
      { input_tokens: 12, cache_read_input_tokens: 481799, cache_creation_input_tokens: 1912 },
      { output_tokens: 640 }
    );

    expect(chunk.usage.prompt_tokens).toBe(483723); // was 12
    expect(chunk.usage.completion_tokens).toBe(640);
    expect(chunk.usage.total_tokens).toBe(484363);
    expect(chunk.usage.prompt_tokens_details).toEqual({
      cached_tokens: 481799,
      cache_creation_tokens: 1912
    });
  });

  it("still reports a plain no-cache request unchanged", () => {
    const chunk = runToStop({ input_tokens: 500 }, { output_tokens: 20 });
    expect(chunk.usage.prompt_tokens).toBe(500);
    expect(chunk.usage.completion_tokens).toBe(20);
    expect(chunk.usage).not.toHaveProperty("prompt_tokens_details");
  });

  it("emits no usage when the upstream reported none", () => {
    const chunk = runToStop(undefined, undefined);
    expect(chunk).toBeDefined();
    expect("usage" in chunk).toBe(false);
  });
});

describe("a provider reset hint does not override a request-scoped verdict", () => {
  // markAccountUnavailable() hardcoded shouldFallback = true whenever a precise
  // reset timestamp was available, so a fallback:false error riding along with
  // one still locked the account for a body no account could serve.
  const CLE_400 = 'estimated request input is 1022873 tokens (type: context_length_exceeded)';

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getProviderConnections.mockResolvedValue([
      { id: "c1", provider: "claude", name: "c1", backoffLevel: 0 }
    ]);
  });

  it("writes no lock when resetsAtMs accompanies a context_length_exceeded", async () => {
    const resetsAtMs = Date.now() + 5 * 60 * 1000;
    const result = await markAccountUnavailable("c1", 400, CLE_400, "claude", "claude-sonnet-5", resetsAtMs);

    expect(result).toMatchObject({ shouldFallback: false, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("still honours resetsAtMs for a genuine rate limit", async () => {
    const resetsAtMs = Date.now() + 5 * 60 * 1000;
    const result = await markAccountUnavailable("c1", 429, "rate limit exceeded", "claude", "claude-sonnet-5", resetsAtMs);

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(4 * 60 * 1000);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ "modelLock_claude-sonnet-5": expect.any(String) })
    );
  });
});
