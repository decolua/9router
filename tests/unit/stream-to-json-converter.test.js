import { describe, expect, it } from "vitest";

const { convertResponsesStreamToJson } = await import("../../open-sse/transformer/streamToJsonConverter.js");

function sseStream(events, { withEventLine = true } = {}) {
  const encoder = new TextEncoder();
  const body = events
    .map((e) => (withEventLine ? `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n` : `data: ${JSON.stringify(e)}\n\n`))
    .join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

const DONE_ITEM = {
  type: "response.output_item.done",
  output_index: 0,
  item: { id: "msg_1", type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] },
};
const COMPLETED = {
  type: "response.completed",
  response: { usage: { input_tokens: 6, output_tokens: 2, total_tokens: 8 } },
};

describe("convertResponsesStreamToJson", () => {
  it("parses standard SSE with explicit event: lines", async () => {
    const out = await convertResponsesStreamToJson(sseStream([DONE_ITEM, COMPLETED]));
    expect(out.status).toBe("completed");
    expect(out.output[0].content[0].text).toBe("OK");
    expect(out.usage.output_tokens).toBe(2);
  });

  it("parses data-only SSE (no event: line, type read from JSON payload) — SLG/singularityapi-style", async () => {
    const out = await convertResponsesStreamToJson(sseStream([DONE_ITEM, COMPLETED], { withEventLine: false }));
    expect(out.status).toBe("completed");
    expect(out.output[0].content[0].text).toBe("OK");
    expect(out.usage.output_tokens).toBe(2);
  });
});
