import { describe, expect, it, vi } from "vitest";
import codex from "../../open-sse/handlers/imageProviders/codex.js";

const imageItem = { type: "image_generation_call", result: "aW1hZ2U=" };
const complete = { type: "response.completed", response: { status: "completed", output: [imageItem] } };
const encoder = new TextEncoder();
function chunks(text, width = 1) {
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width));
      controller.close();
    },
  }));
}

describe("Codex image SSE framing", () => {
  it.each(["\n", "\r\n", "\r"])("reads data-only events and terminal output with %j separators", async (newline) => {
    const response = chunks(`: keepalive${newline}${newline}data: ${JSON.stringify(complete)}${newline}${newline}`);
    expect((await codex.parseResponse(response, {})).data[0].b64_json).toBe(imageItem.result);
    expect(response.body.locked).toBe(false);
  });
  it("flushes a final event without a blank separator", async () => {
    expect((await codex.parseResponse(chunks(`data: ${JSON.stringify(complete)}`), {})).data[0].b64_json).toBe(imageItem.result);
  });
  it("preserves split UTF-8 and multiline data in an upstream error", async () => {
    const response = chunks('event: error\ndata: {"error":\ndata: {"message":"Tạm thời không có ảnh","code":"model_not_found"}}\n\n');
    await expect(codex.parseResponse(response, {})).rejects.toMatchObject({ message: "Tạm thời không có ảnh", statusCode: 404 });
    expect(response.body.locked).toBe(false);
  });
  it("does not signal success if an image item is followed by a terminal failure", async () => {
    const onRequestSuccess = vi.fn();
    const response = chunks(`data: ${JSON.stringify({ type: "response.output_item.done", item: imageItem })}\n\ndata: ${JSON.stringify({ type: "response.failed", response: { error: { message: "quota exhausted", code: "rate_limit_exceeded" } } })}\n\n`);
    const { sseResponse } = await codex.parseResponse(response, { streamToClient: true, onRequestSuccess });
    const text = await sseResponse.text();
    expect(text).toContain('"status":429');
    expect(text).not.toContain("event: done");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
  it("cancels the upstream reader when the client disconnects", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const onRequestSuccess = vi.fn();
    const { sseResponse } = await codex.parseResponse(response, { streamToClient: true, onRequestSuccess });
    await sseResponse.body.cancel();
    await vi.waitFor(() => expect(response.body.locked).toBe(false));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
});
