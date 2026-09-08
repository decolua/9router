import { describe, expect, it } from "vitest";
import codex from "../../open-sse/handlers/imageProviders/codex.js";

function response(event, data) {
  return new Response(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("Codex image stream errors", () => {
  const message = "This model requires a newer version of Codex.";

  it.each([
    ["error", { error: { message } }],
    ["response.failed", { response: { error: { message } } }],
    ["response.completed", { response: { status: "failed", error: { message } } }],
  ])("preserves the upstream error in %s for binary/JSON clients", async (event, data) => {
    await expect(codex.parseResponse(response(event, data), {})).rejects.toThrow(message);
  });

  it("preserves upstream errors for streaming clients and never signals success", async () => {
    let successes = 0;
    const { sseResponse } = await codex.parseResponse(
      response("response.failed", { response: { error: { message } } }),
      { streamToClient: true, onRequestSuccess: () => { successes++; } },
    );
    const body = await sseResponse.text();
    expect(body).toContain(message);
    expect(body).not.toContain("event: done");
    expect(successes).toBe(0);
  });

  it("reports a text-only response without claiming an entitlement failure", async () => {
    await expect(codex.parseResponse(response("response.output_item.done", {
      item: { type: "message", content: [{ type: "output_text", text: "Image generation is temporarily unavailable." }] },
    }), {})).rejects.toThrow("Image generation is temporarily unavailable.");
  });
});
