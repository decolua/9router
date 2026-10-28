import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { convertResponsesStreamToJson } = await import("../../open-sse/transformer/streamToJsonConverter.js");
const { canonicalizeUsage } = await import("../../open-sse/utils/usageTracking.js");
const usageDb = await import("@/lib/usageDb.js");

// Usage as the Responses API reports it: input_tokens already includes the
// cached part, which is only visible in input_tokens_details.
const USAGE = {
  input_tokens: 5000,
  input_tokens_details: { cached_tokens: 4096 },
  output_tokens: 20,
  output_tokens_details: { reasoning_tokens: 8 },
  total_tokens: 5020
};

function codexStream() {
  const raw = [
    'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","created_at":1700000000}}',
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}}',
    `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", status: "completed", usage: USAGE } })}`,
    ""
  ].join("\n\n");
  const encoder = new TextEncoder();
  return new ReadableStream({ start(c) { c.enqueue(encoder.encode(raw)); c.close(); } });
}

describe("Responses usage details survive a forced-stream upstream (Codex)", () => {
  it("keeps cached and reasoning token details when collapsing the stream", async () => {
    const json = await convertResponsesStreamToJson(codexStream());
    expect(json.usage.input_tokens_details).toEqual({ cached_tokens: 4096 });
    expect(json.usage.output_tokens_details).toEqual({ reasoning_tokens: 8 });
  });

  it("reports cached tokens to a Chat Completions client without double counting", async () => {
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(codexStream(), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI_RESPONSES,
      provider: "codex",
      model: "gpt-x",
      body: { model: "gpt-x", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      trackDone: vi.fn(),
      appendLog: vi.fn()
    });
    const json = await result.response.json();
    expect(json.usage.prompt_tokens).toBe(5000);
    expect(json.usage.completion_tokens).toBe(20);
    expect(json.usage.prompt_tokens_details).toEqual({ cached_tokens: 4096 });
    expect(json.usage.completion_tokens_details).toEqual({ reasoning_tokens: 8 });
    const saved = usageDb.saveRequestUsage.mock.calls.at(-1)[0].tokens;
    expect(saved.prompt_tokens).toBe(5000);
    expect(saved.cached_tokens).toBe(4096);
  });

  it("canonicalizes Responses usage with the cached part inside the prompt", () => {
    const c = canonicalizeUsage(USAGE);
    expect(c.prompt_tokens).toBe(5000);
    expect(c.cached_tokens).toBe(4096);
    expect(c.completion_tokens).toBe(20);
    expect(c.reasoning_tokens).toBe(8);
  });
});
