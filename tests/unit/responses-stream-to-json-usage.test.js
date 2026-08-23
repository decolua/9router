import { describe, it, expect } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

// Regression: processSSEMessage used to copy only input/output/total from the
// response.completed usage blob, dropping cached/reasoning breakdowns. Clients
// of /v1/responses (non-streaming) and the forced-SSE→JSON path then saw no
// cache hit info, and cost calc lost its cached-rate discount.
function sseFromEvents(events) {
  const enc = new TextEncoder();
  const sse = events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(sse));
      controller.close();
    },
  });
}

const baseEvents = (usage) => [
  ["response.created", { type: "response.created", response: { id: "resp_1", created_at: 1 } }],
  ["response.completed", { type: "response.completed", response: { id: "resp_1", status: "completed", usage } }],
];

describe("convertResponsesStreamToJson usage passthrough", () => {
  it("preserves OpenAI Responses input/output token details (codex shape)", async () => {
    const out = await convertResponsesStreamToJson(
      sseFromEvents(baseEvents({
        input_tokens: 10000,
        input_tokens_details: { cached_tokens: 9000 },
        output_tokens: 500,
        output_tokens_details: { reasoning_tokens: 300 },
        total_tokens: 10500,
      }))
    );
    expect(out.usage.input_tokens).toBe(10000);
    expect(out.usage.output_tokens).toBe(500);
    expect(out.usage.total_tokens).toBe(10500);
    expect(out.usage.input_tokens_details.cached_tokens).toBe(9000);
    expect(out.usage.output_tokens_details.reasoning_tokens).toBe(300);
  });

  it("folds a flat cached_tokens field into input_tokens_details", async () => {
    // Some openai-compatible providers emit chat-completions-shaped usage.
    const out = await convertResponsesStreamToJson(
      sseFromEvents(baseEvents({ input_tokens: 800, cached_tokens: 600, output_tokens: 100, total_tokens: 900 }))
    );
    expect(out.usage.input_tokens_details.cached_tokens).toBe(600);
  });

  it("maps Anthropic-style cache_read_input_tokens to cached_tokens", async () => {
    const out = await convertResponsesStreamToJson(
      sseFromEvents(baseEvents({
        input_tokens: 500,
        cache_read_input_tokens: 400,
        output_tokens: 50,
        total_tokens: 550,
      }))
    );
    expect(out.usage.input_tokens_details.cached_tokens).toBe(400);
  });

  it("folds a flat reasoning_tokens field into output_tokens_details and recomputes a missing total", async () => {
    const out = await convertResponsesStreamToJson(
      sseFromEvents(baseEvents({ input_tokens: 300, output_tokens: 120, reasoning_tokens: 90 }))
    );
    expect(out.usage.output_tokens_details.reasoning_tokens).toBe(90);
    expect(out.usage.total_tokens).toBe(420); // input + output when upstream omits total
  });
});
