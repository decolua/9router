import { describe, expect, it } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

function makeStream(events) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= events.length) {
        controller.close();
        return;
      }
      const ev = events[i];
      const data = "event: " + ev.event + "\ndata: " + JSON.stringify(ev.data) + "\n\n";
      controller.enqueue(encoder.encode(data));
      i++;
    }
  });
}

describe("streamToJsonConverter", () => {
  it("preserves multiple output_item.done items by item id", async () => {
    const events = [
      { event: "response.created", data: { response: { id: "resp_123", created_at: 1234567890 } } },
      { event: "response.output_item.done", data: { output_index: 0, item: { id: "rs_1", type: "reasoning", summary: [{ text: "thinking..." }] } } },
      { event: "response.output_item.done", data: { output_index: 0, item: { id: "msg_1", type: "message", content: [{ type: "output_text", text: "hello world" }], role: "assistant" } } },
      { event: "response.completed", data: { response: { usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } } }
    ];

    const result = await convertResponsesStreamToJson(makeStream(events));

    expect(result.output.length).toBe(2);
    expect(result.output[0]).toEqual({ id: "rs_1", type: "reasoning", summary: [{ text: "thinking..." }] });
    expect(result.output[1]).toEqual({ id: "msg_1", type: "message", content: [{ type: "output_text", text: "hello world" }], role: "assistant" });
  });

  it("does not overwrite items with same output_index but different ids", async () => {
    const events = [
      { event: "response.created", data: { response: { id: "resp_123", created_at: 1234567890 } } },
      { event: "response.output_item.done", data: { output_index: 0, item: { id: "first", type: "message", content: [{ text: "first" }], role: "assistant" } } },
      { event: "response.output_item.done", data: { output_index: 0, item: { id: "second", type: "reasoning", summary: [] } } },
      { event: "response.completed", data: { response: { usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } } } }
    ];

    const result = await convertResponsesStreamToJson(makeStream(events));

    expect(result.output.length).toBe(2);
    expect(result.output.map(i => i.id)).toContain("first");
    expect(result.output.map(i => i.id)).toContain("second");
  });

  it("returns empty output for completed response with no items", async () => {
    const events = [
      { event: "response.created", data: { response: { id: "resp_123", created_at: 1234567890 } } },
      { event: "response.completed", data: { response: { usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } } }
    ];

    const result = await convertResponsesStreamToJson(makeStream(events));

    expect(result.output.length).toBe(0);
    expect(result.status).toBe("completed");
  });
});
