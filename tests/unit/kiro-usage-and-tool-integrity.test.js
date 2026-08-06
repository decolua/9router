/**
 * Seven Kiro defects, all on the OAuth/social Kiro route (kr/claude-sonnet-4.5
 * with a >100k context). Production shape: 402 of 2156 usageHistory rows for
 * Kiro recorded completionTokens 0, and the 25 newest rows all sat pinned at
 * exactly 1 output token against prompts of 80k-103k -- i.e. the router was not
 * measuring the answer, it was measuring nothing and rounding up.
 *
 * A. OUT 0 / OUT 1. finish() estimates completion tokens as
 *    totalContentLength / 4, but tool-call bytes were never added to
 *    totalContentLength. A turn whose entire answer is a tool call therefore
 *    measured as an empty answer (Math.max(1, ...) is where the 1 comes from).
 *
 * B. Truncation threw away a complete-enough answer. stopDisposition() maps
 *    model_context_window_exceeded (and max_tokens alongside tool calls) to
 *    terminal_incomplete, which hard-fails the turn -- even when the model had
 *    already streamed text. A truncated turn is what finish_reason "length" is
 *    for. Both disposition gates needed the bypass: the declared-stop-reason
 *    gate runs first and returns, so patching only finish() would be dead code.
 *
 * C. One bad tool fragment killed every good one. Three separate latches:
 *    emitTools() validated per turn and threw out of the loop; the frame-loop
 *    catch cleared state.tools wholesale; and the toolUseEvent branch returned
 *    early forever once toolValidationError was set. Net effect for the client:
 *    a turn that answered nothing.
 *
 * D. Cache tokens dropped on the kiro:claude route. kiro-to-claude built usage
 *    from prompt_tokens/completion_tokens only, so Claude clients lost
 *    cache_read_input_tokens / cache_creation_input_tokens and could neither
 *    price the turn nor size their prompt cache.
 *
 * E. A malformed body cooled accounts down. Kiro answers an unusable
 *    conversation with 400 {"message":"Improperly formed request.","reason":
 *    "REQUEST_BODY_INVALID"}, which fell through to the default transient rule.
 *    Measured: 12 different Kiro connections locked inside 1.6 seconds
 *    (2026-08-04T09:13:14.290Z -> 09:13:32.221Z), 39 of 44 rows carrying
 *    errorCode 400. Every account rejects the identical payload the same way,
 *    so this is request-scoped, exactly like context_length_exceeded.
 *
 * F. Defence-in-depth only: both request translators discarded canonical.valid.
 *    canonicalizeKiroConversation() self-heals every failure mode it can detect
 *    (see the test below), so the guard is unreachable by construction today --
 *    it exists so a future validator rule cannot ship an unusable body silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args)
}));

const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
const { kiroToClaudeResponse, kiroToClaudeNonStreaming } = await import(
  "../../open-sse/translator/response/kiro-to-claude.js"
);
const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");
const { validateKiroConversation, canonicalizeKiroConversation } = await import(
  "../../open-sse/translator/concerns/kiroConversation.js"
);

const encoder = new TextEncoder();
const credentials = {
  accessToken: "test-token",
  providerSpecificData: { kiroToolCallRepair: true }
};

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeHeader(name, value) {
  const nameBytes = encoder.encode(name);
  const valueBytes = encoder.encode(value);
  const bytes = new Uint8Array(1 + nameBytes.length + 3 + valueBytes.length);
  let offset = 0;
  bytes[offset++] = nameBytes.length;
  bytes.set(nameBytes, offset);
  offset += nameBytes.length;
  bytes[offset++] = 7;
  new DataView(bytes.buffer).setUint16(offset, valueBytes.length, false);
  offset += 2;
  bytes.set(valueBytes, offset);
  return bytes;
}

function concat(chunks) {
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function checksum(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(8, crc32(bytes.subarray(0, 8)), false);
  view.setUint32(bytes.byteLength - 4, crc32(bytes.subarray(0, bytes.byteLength - 4)), false);
  return bytes;
}

function frameFromEntries(entries, payload) {
  const headers = concat(entries.map(([name, value]) => encodeHeader(name, value)));
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const totalLength = 12 + headers.byteLength + payloadBytes.byteLength + 4;
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headers.byteLength, false);
  frame.set(headers, 12);
  frame.set(payloadBytes, 12 + headers.byteLength);
  return checksum(frame);
}

function frame(eventType, payload) {
  return frameFromEntries([[":event-type", eventType]], payload);
}

function response(frames, status = 200) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const value of frames) controller.enqueue(value);
      controller.close();
    }
  }), { status, statusText: status === 200 ? "OK" : "Upstream Error" });
}

async function execute(executor = new KiroExecutor(), overrides = {}) {
  return executor.execute({
    model: "kr/claude-opus-4.8",
    body: { systemPrompt: "base", conversationState: {} },
    stream: true,
    credentials,
    ...overrides
  });
}

// Output is held behind the ": kiro-validation" heartbeat until clean EOF, so
// every executor assertion has to drain the whole response.
async function run(frames) {
  fetchMock.mockResolvedValueOnce(response(frames));
  return await (await execute()).response.text();
}

// Same as run(), but with the bounded tool-call repair retry disabled, so a
// hard failure is surfaced from the first attempt instead of triggering a
// second upstream fetch.
async function runNoRepair(frames) {
  fetchMock.mockResolvedValueOnce(response(frames));
  const result = await execute(new KiroExecutor(), {
    credentials: { accessToken: "test-token", providerSpecificData: { kiroToolCallRepair: false } }
  });
  return await result.response.text();
}

// The estimator only runs when metering and context usage both arrived and the
// upstream reported no token totals of its own -- the exact production shape.
const METERED = [
  frame("meteringEvent", { usage: 2, unit: "credit" }),
  frame("contextUsageEvent", { contextUsagePercentage: 10 })
];

function usageFrom(body) {
  const usages = body
    .split("\n")
    .filter(line => line.startsWith("data: ") && line.includes('"usage"'))
    .map(line => JSON.parse(line.slice(6)).usage)
    .filter(Boolean);
  return usages[usages.length - 1];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("A: tool-call bytes count as output tokens", () => {
  it("does not report a tool-only turn as OUT 1", async () => {
    const body = await run([
      frame("toolUseEvent", {
        toolUseId: "call_a",
        name: "tool_call",
        input: { name: "mcp_search", arguments: { query: "why is the router reporting zero output" } }
      }),
      frame("metadataEvent", { stopReason: "tool_use" }),
      ...METERED
    ]);

    const usage = usageFrom(body);
    expect(usage).toBeDefined();
    // Was 1: the Math.max floor over a totalContentLength of 0.
    expect(usage.completion_tokens).toBeGreaterThan(10);
    expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
  });

  it("still counts plain text output", async () => {
    const body = await run([
      frame("assistantResponseEvent", { content: "x".repeat(400) }),
      frame("metadataEvent", { stopReason: "end_turn" }),
      ...METERED
    ]);
    expect(usageFrom(body).completion_tokens).toBe(100);
  });
});

describe("C: one unusable tool fragment does not take the whole turn with it", () => {
  it("ships the valid call and drops only the invalid one", async () => {
    const body = await run([
      frame("toolUseEvent", {
        toolUseId: "good",
        name: "tool_call",
        input: { name: "mcp_search", arguments: { q: "router" } }
      }),
      // No nested MCP name -> unusable, cannot be forwarded to the client.
      frame("toolUseEvent", { toolUseId: "bad", name: "tool_call", input: { arguments: { q: "router" } } }),
      frame("metadataEvent", { stopReason: "tool_use" }),
      ...METERED
    ]);

    expect(body).toContain('\\"name\\":\\"mcp_search\\"');
    expect(body).not.toContain('"id":"bad"');
    expect(body).toContain('"finish_reason":"tool_calls"');
  });

  it("keeps streamed text when the only tool call is unusable", async () => {
    const body = await run([
      frame("assistantResponseEvent", { content: "Here is what I found." }),
      frame("toolUseEvent", { toolUseId: "bad", name: "tool_call", input: { arguments: {} } }),
      frame("metadataEvent", { stopReason: "tool_use" }),
      ...METERED
    ]);

    expect(body).toContain("Here is what I found.");
    expect(body).not.toContain("invalid_kiro_tool_call");
  });

  it("still hard-fails when nothing usable was produced at all", async () => {
    const body = await runNoRepair([
      frame("toolUseEvent", { toolUseId: "bad", name: "tool_call", input: { arguments: {} } }),
      frame("metadataEvent", { stopReason: "tool_use" })
    ]);
    expect(body).toContain("invalid_kiro_tool_call");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("B: truncation after output closes as length, not as a failure", () => {
  it("keeps the text and reports finish_reason length", async () => {
    const body = await run([
      frame("assistantResponseEvent", { content: "Partial but usable answer." }),
      frame("metadataEvent", { stopReason: "model_context_window_exceeded" }),
      ...METERED
    ]);

    expect(body).toContain("Partial but usable answer.");
    expect(body).toContain('"finish_reason":"length"');
    expect(body).not.toContain("kiro_terminal_incomplete");
  });

  it("still fails a truncation that produced nothing", async () => {
    const body = await run([
      frame("metadataEvent", { stopReason: "model_context_window_exceeded" })
    ]);
    expect(body).toContain("kiro_terminal_incomplete");
  });
});

describe("D: cache tokens survive the kiro -> claude translation", () => {
  const finishChunk = (usage) => ({
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage
  });

  function finalUsage(usage) {
    const state = {};
    // Usage rides an earlier chunk in the real stream; feed it the same way.
    kiroToClaudeResponse({ choices: [{ index: 0, delta: { content: "hi" } }], usage }, state);
    const events = kiroToClaudeResponse(finishChunk(usage), state) || [];
    return events.find(e => e.type === "message_delta")?.usage;
  }

  it("forwards the flat Chat spelling the executor emits", () => {
    expect(finalUsage({
      prompt_tokens: 103000,
      completion_tokens: 640,
      cache_read_input_tokens: 98000,
      cache_creation_input_tokens: 1912
    })).toEqual({
      input_tokens: 103000,
      output_tokens: 640,
      cache_read_input_tokens: 98000,
      cache_creation_input_tokens: 1912
    });
  });

  it("also accepts the nested details spelling used on passthrough", () => {
    expect(finalUsage({
      prompt_tokens: 500,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 480, cache_creation_tokens: 20 }
    })).toEqual({
      input_tokens: 500,
      output_tokens: 20,
      cache_read_input_tokens: 480,
      cache_creation_input_tokens: 20
    });
  });

  it("omits the cache keys when the upstream reported none", () => {
    expect(finalUsage({ prompt_tokens: 500, completion_tokens: 20 }))
      .toEqual({ input_tokens: 500, output_tokens: 20 });
  });

  it("preserves cache on the non-streaming path too", () => {
    const message = kiroToClaudeNonStreaming({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 90, completion_tokens: 4, cache_read_input_tokens: 80 }
    });
    expect(message.usage).toMatchObject({
      input_tokens: 90,
      output_tokens: 4,
      cache_read_input_tokens: 80
    });
    expect(message.usage).not.toHaveProperty("cache_creation_input_tokens");
  });
});

describe("E: an improperly formed body is request-scoped, not account-scoped", () => {
  // The verbatim upstream body from the 12-connection lockout.
  const KIRO_400 = '{"message":"Improperly formed request.","reason":"REQUEST_BODY_INVALID"}';

  it("does not fall back and writes no cooldown", () => {
    expect(checkFallbackError(400, KIRO_400)).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("covers the reason code and the generic invalid_request_error spelling", () => {
    expect(checkFallbackError(400, "REQUEST_BODY_INVALID").shouldFallback).toBe(false);
    expect(checkFallbackError(400, '{"type":"invalid_request_error"}').shouldFallback).toBe(false);
  });

  it("still falls back on a genuine rate limit", () => {
    const result = checkFallbackError(429, "rate limit exceeded", 0);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});

describe("F: the translator valid-guard is defence-in-depth", () => {
  const SPECS = [{ toolSpecification: { name: "read_file", inputSchema: { json: { type: "object" } } } }];

  it("validateKiroConversation names the offending turn", () => {
    // Hand-built, NOT normalized: assistant first, then a tool call with no
    // matching result and a name no spec declares.
    const result = validateKiroConversation(
      [{ assistantResponseMessage: { content: "hi", toolUses: [{ toolUseId: "t1", name: "ghost" }] } }],
      { userInputMessage: { content: "go" } },
      SPECS
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("role:0");
    expect(result.errors).toContain("pair:0");
    expect(result.errors).toContain("spec:0");
  });

  it("canonicalizeKiroConversation heals that same conversation", () => {
    // This is why the guard cannot fire today: normalizeTurns() forces
    // user-first/user-last alternation and non-empty content, and the
    // second-chance pass flattens every structured tool turn to text.
    const out = canonicalizeKiroConversation({
      history: [{ assistantResponseMessage: { content: "hi", toolUses: [{ toolUseId: "t1", name: "ghost" }] } }],
      currentMessage: { userInputMessage: { content: "" } },
      modelId: "claude-sonnet-4-5",
      toolSpecs: SPECS
    });

    expect(out.valid).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.currentMessage.userInputMessage.content).toBe("continue");
    expect(out.history[0].userInputMessage).toBeDefined();
  });
});
