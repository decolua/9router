/**
 * Custom OpenAI-compatible provider in Responses mode (e.g. AWS Bedrock Mantle,
 * https://bedrock-mantle.us-west-2.api.aws/openai/v1) rejects the Chat-shaped
 * top-level field: 400 `Unknown parameter: 'reasoning_effort'`. The Responses wire
 * must carry reasoning:{effort,...}; Chat Completions keeps reasoning_effort.
 * All HTTP is mocked — no live inference.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock, default: fetchMock }));

import { translateRequest } from "../../open-sse/translator/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getTargetFormat } from "../../open-sse/services/provider.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const RESP = "openai-compatible-responses-11111111-2222-3333-4444-555555555555";
const CHAT = "openai-compatible-chat-11111111-2222-3333-4444-555555555555";
const MODEL = "openai.gpt-6-astra";
const BASE = "https://bedrock-mantle.us-west-2.api.aws/openai/v1";
const creds = (apiType) => ({ apiKey: "test-key", providerSpecificData: { baseUrl: BASE, apiType } });

const TOOLS = [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }];
const MULTI_TURN = [
  { role: "user", content: "weather in Paris?" },
  { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Paris\"}" } }] },
  { role: "tool", tool_call_id: "call_1", content: "18C" },
  { role: "user", content: "and tomorrow?" },
];

function toResponses(body, stream = true, provider = RESP) {
  const c = creds("responses");
  return translateRequest(FORMATS.OPENAI, getTargetFormat(provider, c), MODEL, structuredClone(body), stream, c, provider);
}

afterEach(() => fetchMock.mockReset());

describe("openai-compatible Responses: reasoning_effort → reasoning.effort", () => {
  it("targets the Responses wire for a responses-mode custom provider", () => {
    expect(getTargetFormat(RESP, creds("responses"))).toBe(FORMATS.OPENAI_RESPONSES);
    expect(getTargetFormat(CHAT, creds("chat"))).toBe(FORMATS.OPENAI);
  });

  it.each([true, false])("nests effort and drops the top-level field (stream=%s)", (stream) => {
    const out = toResponses({ model: MODEL, messages: MULTI_TURN, tools: TOOLS, reasoning_effort: "high" }, stream);
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
    // tools + multi-turn tool history survive
    expect(out.tools.map((t) => t.name)).toEqual(["get_weather"]);
    expect(out.input.some((i) => i.type === "function_call" && i.call_id === "call_1")).toBe(true);
    expect(out.input.some((i) => i.type === "function_call_output" && i.call_id === "call_1")).toBe(true);
  });

  it("keeps other reasoning fields when merging", () => {
    const out = toResponses({ model: MODEL, messages: MULTI_TURN, reasoning_effort: "low", reasoning: { summary: "detailed" } });
    expect(out.reasoning).toEqual({ effort: "low", summary: "detailed" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("keeps an explicit nested reasoning.effort when no top-level field is sent", () => {
    const out = toResponses({ model: MODEL, messages: MULTI_TURN, reasoning: { effort: "medium", summary: "concise" } });
    expect(out.reasoning).toEqual({ effort: "medium", summary: "concise" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("documented precedence: top-level reasoning_effort wins over reasoning.effort", () => {
    const out = toResponses({ model: MODEL, messages: MULTI_TURN, reasoning_effort: "high", reasoning: { effort: "low" } });
    expect(out.reasoning.effort).toBe("high");
    expect(out.reasoning_effort).toBeUndefined();
  });

  it.each([undefined, null])("adds nothing when reasoning_effort is %s", (v) => {
    const out = toResponses({ model: MODEL, messages: MULTI_TURN, reasoning_effort: v });
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toBeUndefined();
  });

  it("normalizes a native Responses body (input[]) carrying top-level reasoning_effort", () => {
    const c = creds("responses");
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, MODEL,
      { model: MODEL, input: [{ role: "user", content: "hi" }], reasoning_effort: "high" }, true, c, RESP);
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
  });

  it("'none' omits reasoning entirely", () => {
    const out = toResponses({ model: MODEL, messages: MULTI_TURN, reasoning_effort: "none" });
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toBeUndefined();
  });
});

describe("unchanged behaviour outside custom Responses providers", () => {
  it("Chat Completions custom provider keeps top-level reasoning_effort", () => {
    const c = creds("chat");
    const out = translateRequest(FORMATS.OPENAI, getTargetFormat(CHAT, c), MODEL,
      { model: MODEL, messages: MULTI_TURN, reasoning_effort: "high" }, true, c, CHAT);
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning).toBeUndefined();
  });

  it("codex keeps its existing (executor-reshaped) Responses thinking shape", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-6-astra",
      { model: "gpt-6-astra", messages: MULTI_TURN, reasoning_effort: "high" }, true, null, "codex");
    expect(out.reasoning_effort).toBe("high");
  });
});

describe("wire request (mocked fetch)", () => {
  it.each([true, false])("POSTs nested reasoning to <base>/responses (stream=%s)", async (stream) => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const c = creds("responses");
    const body = toResponses({ model: MODEL, messages: MULTI_TURN, tools: TOOLS, reasoning_effort: "high" }, stream);
    await getExecutor(RESP).execute({ model: MODEL, body, stream, credentials: c });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/responses`);
    const sent = JSON.parse(init.body);
    expect(sent).not.toHaveProperty("reasoning_effort");
    expect(sent.reasoning.effort).toBe("high");
    expect(sent.model).toBe(MODEL);
  });
});
