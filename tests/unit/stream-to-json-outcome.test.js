import { describe, expect, it } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

const encoder = new TextEncoder();

function streamFor(events) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(events.join("\n\n") + "\n\n"));
      controller.close();
    },
  });
}

function event(name, payload) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}`;
}

describe("Responses stream-to-JSON semantic outcome", () => {
  it("keeps a response.failed terminal sticky when completed follows", async () => {
    const result = await convertResponsesStreamToJson(streamFor([
      event("response.failed", { response: { status: "failed", error: { message: "quota" } } }),
      event("response.completed", { response: { status: "completed" } }),
    ]));

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ message: "quota" });
  });

  it("keeps malformed JSON sticky when completed follows", async () => {
    const result = await convertResponsesStreamToJson(streamFor([
      "event: response.output_item.done\ndata: {not-json",
      event("response.completed", { response: { status: "completed" } }),
    ]));

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ errorKind: "invalid_upstream_json" });
  });

  it("leaves EOF without a terminal in progress", async () => {
    const result = await convertResponsesStreamToJson(streamFor([
      event("response.created", { response: { id: "resp-1" } }),
    ]));

    expect(result.status).toBe("in_progress");
  });
});
