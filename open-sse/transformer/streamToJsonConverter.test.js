/**
 * Tests for Stream-to-JSON Converter
 */

import { describe, it, expect } from "vitest";
import { convertResponsesStreamToJson } from "./streamToJsonConverter.js";

/**
 * Helper: Create a ReadableStream from SSE events
 */
function createSseStream(events) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    }
  });
}

describe("convertResponsesStreamToJson", () => {
  it("converts simple message response to JSON", async () => {
    const events = [
      "event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_123\",\"object\":\"response\",\"created_at\":1234567890,\"status\":\"in_progress\"}}\n\n",
      "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"content\":[],\"role\":\"assistant\"}}\n\n",
      "event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hello world\"}],\"role\":\"assistant\"}}\n\n",
      "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_123\",\"status\":\"completed\",\"usage\":{\"input_tokens\":5,\"output_tokens\":10,\"total_tokens\":15}}}\n\n"
    ];

    const stream = createSseStream(events);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.id).toBe("resp_123");
    expect(result.object).toBe("response");
    expect(result.status).toBe("completed");
    expect(result.output).toHaveLength(1);
    expect(result.output[0].type).toBe("message");
    expect(result.output[0].content[0].text).toBe("Hello world");
    expect(result.usage.input_tokens).toBe(5);
    expect(result.usage.output_tokens).toBe(10);
  });

  it("handles empty stream gracefully", async () => {
    const stream = createSseStream([]);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.id).toMatch(/^resp_/);
    expect(result.object).toBe("response");
    expect(result.status).toBe("completed");
    expect(result.output).toHaveLength(0);
  });

  it("handles malformed events by skipping them", async () => {
    const events = [
      "event: response.created\ndata: {\"response\":{\"id\":\"resp_456\"}}\n\n",
      "event: bad.event\ndata: not valid json\n\n",
      "event: response.output_item.done\ndata: {\"output_index\":0,\"item\":{\"type\":\"message\",\"content\":[{\"text\":\"test\"}],\"role\":\"assistant\"}}\n\n",
      "event: response.completed\ndata: {\"response\":{\"status\":\"completed\"}}\n\n"
    ];

    const stream = createSseStream(events);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.id).toBe("resp_456");
    expect(result.status).toBe("completed");
    expect(result.output).toHaveLength(1);
  });

  it("handles multiple output items in order", async () => {
    const events = [
      "event: response.created\ndata: {\"response\":{\"id\":\"resp_789\"}}\n\n",
      "event: response.output_item.done\ndata: {\"output_index\":1,\"item\":{\"type\":\"message\",\"content\":[{\"text\":\"second\"}],\"role\":\"assistant\"}}\n\n",
      "event: response.output_item.done\ndata: {\"output_index\":0,\"item\":{\"type\":\"message\",\"content\":[{\"text\":\"first\"}],\"role\":\"assistant\"}}\n\n",
      "event: response.completed\ndata: {\"response\":{\"status\":\"completed\"}}\n\n"
    ];

    const stream = createSseStream(events);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.output).toHaveLength(2);
    expect(result.output[0].content[0].text).toBe("first");
    expect(result.output[1].content[0].text).toBe("second");
  });

  it("handles failed response status", async () => {
    const events = [
      "event: response.created\ndata: {\"response\":{\"id\":\"resp_fail\"}}\n\n",
      "event: response.failed\ndata: {\"response\":{\"status\":\"failed\",\"error\":{\"message\":\"Something went wrong\"}}}\n\n"
    ];

    const stream = createSseStream(events);
    const result = await convertResponsesStreamToJson(stream);

    expect(result.status).toBe("failed");
  });
});
