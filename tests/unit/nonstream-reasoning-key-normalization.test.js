import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const {
  handleNonStreamingResponse,
  normalizeReasoningKey,
  translateNonStreamingResponse
} = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { parseSSEToOpenAIResponse } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

// ---------------------------------------------------------------------------
// DF-9ROUTER-61: the same thinking model surfaces its reasoning under
// `reasoning_content` through one upstream route and a nonstandard `reasoning`
// key through another. Both shapes below were measured live on central
// 2026-10-16 for ocg/glm-5.3-flash (same key, same model, same prompt):
//   route A (canonical):    id `202610170317108c28f8dcd8d24c65`, reasoning_content
//   route B (nonstandard):  id `chatcmpl_a22288301946b83fd765155a1bbbc056`, reasoning
// The non-stream JSON exit must emit MAXIMALLY one spelling: `reasoning_content`.
// ---------------------------------------------------------------------------

const REASONING_TEXT = "The user is asking me";

/**
 * Build a chat.completion body as one of the two measured upstream routes would
 * return it. Everything except the reasoning key is held identical so the two
 * shapes are comparable.
 */
function upstreamBody({ reasoningKey, content = null, finishReason = "length", model = "glm-5.3-flash" }) {
  const message = { role: "assistant", content };
  if (reasoningKey) message[reasoningKey] = REASONING_TEXT;
  return {
    id: "chatcmpl_a22288301946b83fd765155a1bbbc056",
    object: "chat.completion",
    created: 1792178230,
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 2014, completion_tokens: 7, total_tokens: 2021 }
  };
}

function handlerContext(providerBody, overrides = {}) {
  const contentType = overrides.contentType || "application/json";
  const raw = typeof providerBody === "string" ? providerBody : JSON.stringify(providerBody);
  return {
    providerResponse: new Response(raw, { headers: { "content-type": contentType } }),
    provider: "opencode-go",
    model: "glm-5.3-flash",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { model: "ocg/glm-5.3-flash", messages: [{ role: "user", content: "reply ok" }] },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    apiKey: "test-key",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: null,
    customToolNames: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    pxpipe: null,
    reqTag: "test",
    log: undefined,
    ...overrides
  };
}

async function runHandler(providerBody, overrides = {}) {
  const result = await handleNonStreamingResponse(handlerContext(providerBody, overrides));
  expect(result.success).toBe(true);
  return await result.response.json();
}

const messageKeys = (json) => Object.keys(json.choices[0].message).sort();

describe("normalizeReasoningKey (single non-stream exit helper)", () => {
  it("moves a nonstandard `reasoning` string onto `reasoning_content` and drops the nonstandard key", () => {
    const body = upstreamBody({ reasoningKey: "reasoning" });
    const out = normalizeReasoningKey(body);
    expect(out.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
    expect(out.choices[0].message).not.toHaveProperty("reasoning");
  });

  it("keeps the canonical value when an upstream sends BOTH keys", () => {
    const body = upstreamBody({ reasoningKey: "reasoning_content" });
    body.choices[0].message.reasoning = "stale duplicate";
    const out = normalizeReasoningKey(body);
    expect(out.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
    expect(out.choices[0].message).not.toHaveProperty("reasoning");
  });

  it("treats an empty `reasoning_content` as absent and fills it from the nonstandard key", () => {
    const body = upstreamBody({ reasoningKey: "reasoning" });
    body.choices[0].message.reasoning_content = "";
    const out = normalizeReasoningKey(body);
    expect(out.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
  });

  it("deletes a nil/empty nonstandard key instead of shipping it", () => {
    for (const empty of ["", null, undefined]) {
      const body = upstreamBody({ reasoningKey: "reasoning" });
      body.choices[0].message.reasoning = empty;
      const out = normalizeReasoningKey(body);
      expect(out.choices[0].message).not.toHaveProperty("reasoning");
      expect(out.choices[0].message).not.toHaveProperty("reasoning_content");
    }
  });

  it("leaves a structured (object) `reasoning` payload untouched rather than coercing it", () => {
    const body = upstreamBody({ reasoningKey: null });
    body.choices[0].message.reasoning = { steps: ["a"] };
    const out = normalizeReasoningKey(body);
    expect(out.choices[0].message.reasoning).toEqual({ steps: ["a"] });
    expect(out.choices[0].message).not.toHaveProperty("reasoning_content");
  });

  it("is a no-op for bodies that are not chat.completion shaped", () => {
    const claude = { id: "msg_1", type: "message", content: [{ type: "text", text: "hi" }] };
    const responses = { id: "resp_1", object: "response", output: [] };
    expect(normalizeReasoningKey(claude)).toBe(claude);
    expect(normalizeReasoningKey(responses)).toBe(responses);
    expect(normalizeReasoningKey(null)).toBe(null);
    expect(normalizeReasoningKey(undefined)).toBe(undefined);
  });

  it("normalizes every choice, not just the first", () => {
    const body = upstreamBody({ reasoningKey: "reasoning" });
    body.choices.push({ index: 1, message: { role: "assistant", content: null, reasoning: "second" }, finish_reason: "length" });
    const out = normalizeReasoningKey(body);
    expect(out.choices[1].message.reasoning_content).toBe("second");
    expect(out.choices[1].message).not.toHaveProperty("reasoning");
  });
});

describe("non-stream /v1/chat/completions reasoning key (DF-9ROUTER-61)", () => {
  it("returns the nonstandard upstream shape as `reasoning_content` only", async () => {
    const json = await runHandler(upstreamBody({ reasoningKey: "reasoning" }));
    expect(json.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
    expect(json.choices[0].message).not.toHaveProperty("reasoning");
    expect(json.choices[0].message).not.toHaveProperty("thoughts");
    expect(messageKeys(json)).toEqual(["content", "reasoning_content", "role"]);
  });

  it("preserves a reasoning-only turn (content null, finish_reason length) instead of looking empty", async () => {
    const json = await runHandler(upstreamBody({ reasoningKey: "reasoning" }));
    expect(json.choices[0].finish_reason).toBe("length");
    expect(json.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
  });

  it("preserves a reasoning-only turn with empty-string content", async () => {
    const json = await runHandler(upstreamBody({ reasoningKey: "reasoning", content: "" }));
    expect(json.choices[0].message.content).toBe("");
    expect(json.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
    expect(json.choices[0].message).not.toHaveProperty("reasoning");
  });

  it("produces the SAME response for both measured upstream routes (direct vs relayer account)", async () => {
    const canonical = await runHandler(upstreamBody({ reasoningKey: "reasoning_content" }));
    const nonstandard = await runHandler(upstreamBody({ reasoningKey: "reasoning" }));
    expect(nonstandard).toEqual(canonical);
    expect(messageKeys(nonstandard)).toEqual(messageKeys(canonical));
  });

  it("still strips reasoning when the turn also carries content (existing policy, unchanged)", async () => {
    const json = await runHandler(upstreamBody({ reasoningKey: "reasoning", content: "Hello!", finishReason: "stop" }));
    expect(json.choices[0].message.content).toBe("Hello!");
    expect(json.choices[0].message).not.toHaveProperty("reasoning_content");
    expect(json.choices[0].message).not.toHaveProperty("reasoning");
  });

  it("leaves a non-thinking model body untouched", async () => {
    const body = {
      id: "chatcmpl_plain",
      object: "chat.completion",
      created: 1792178230,
      model: "glm-5.3-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
    };
    const json = await runHandler(body);
    // Usage is deliberately buffered by the handler (addBufferToUsage); the
    // message/choice content must be passed through untouched.
    expect(json.choices).toEqual(body.choices);
    expect(json.choices[0].message).toEqual({ role: "assistant", content: "Hello!" });
    expect(json.choices[0].message).not.toHaveProperty("reasoning_content");
    expect(json.choices[0].message).not.toHaveProperty("reasoning");
  });

  it("keeps a tool_calls message's nonstandard reasoning out of the response", async () => {
    const body = upstreamBody({ reasoningKey: "reasoning", content: null, finishReason: "tool_calls" });
    body.choices[0].message.tool_calls = [{ id: "call_1", type: "function", function: { name: "shell", arguments: "{}" } }];
    const json = await runHandler(body);
    expect(json.choices[0].message).not.toHaveProperty("reasoning");
    expect(json.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
  });
});

describe("non-stream exit for other client formats", () => {
  it("normalizes to a Claude thinking block for a Claude client", async () => {
    const json = await runHandler(upstreamBody({ reasoningKey: "reasoning" }), {
      sourceFormat: FORMATS.CLAUDE,
      clientRawRequest: { endpoint: "/v1/messages" }
    });
    expect(json.type).toBe("message");
    const thinking = json.content.find((block) => block.type === "thinking");
    expect(thinking).toBeTruthy();
    expect(thinking.thinking).toBe(REASONING_TEXT);
  });

  it("normalizes to a Responses reasoning item for a Responses client", async () => {
    const json = await runHandler(upstreamBody({ reasoningKey: "reasoning" }), {
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      clientRawRequest: { endpoint: "/v1/responses" }
    });
    expect(json.object).toBe("response");
    const reasoning = json.output.find((item) => item.type === "reasoning");
    expect(reasoning).toBeTruthy();
    expect(reasoning.summary[0].text).toBe(REASONING_TEXT);
  });

  it("translateNonStreamingResponse accepts the nonstandard key directly (defensive, mirrors openAICompletionToResponses)", () => {
    const out = translateNonStreamingResponse(upstreamBody({ reasoningKey: "reasoning" }), FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(out.content.find((b) => b.type === "thinking").thinking).toBe(REASONING_TEXT);
  });
});

describe("forced-SSE-to-JSON aggregation accepts the nonstandard delta key", () => {
  const sseChunks = (deltas) => deltas
    .map((d) => `data: ${JSON.stringify({ id: "chatcmpl_sse", object: "chat.completion.chunk", created: 1792178230, model: "glm-5.3-flash", choices: [{ index: 0, delta: d, finish_reason: null }] })}`)
    .concat(['data: {"choices":[{"delta":{},"finish_reason":"length"}]}', "data: [DONE]", ""])
    .join("\n\n");

  it("normalizes `delta.reasoning` (nonstandard) into message.reasoning_content", () => {
    const parsed = parseSSEToOpenAIResponse(sseChunks([{ reasoning: "The user " }, { reasoning: "is asking me" }]), "glm-5.3-flash");
    expect(parsed.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
    expect(parsed.choices[0].message).not.toHaveProperty("reasoning");
  });

  it("does not double up when a stream carries both keys", () => {
    const parsed = parseSSEToOpenAIResponse(
      sseChunks([{ reasoning: "nonstandard tail" }, { reasoning_content: REASONING_TEXT }]),
      "glm-5.3-flash"
    );
    expect(parsed.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
  });

  it("surfaces a reasoning-only SSE turn through the non-stream exit as reasoning_content", async () => {
    const json = await runHandler(sseChunks([{ reasoning: REASONING_TEXT }]), { contentType: "text/event-stream" });
    expect(json.choices[0].message.reasoning_content).toBe(REASONING_TEXT);
    expect(json.choices[0].message).not.toHaveProperty("reasoning");
  });
});
