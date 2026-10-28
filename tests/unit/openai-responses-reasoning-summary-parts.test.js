import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// Responses upstreams (OpenCode Muse Spark, Codex) stream reasoning as several
// summary parts. Each part is its own thought; joined back-to-back the client
// showed "…constraints.Applying…" as one run-on sentence.

// stream.js naming: targetFormat = upstream wire format, sourceFormat = client format.
async function runTransform(clientFormat, lines) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join("\n")));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, clientFormat, "test", null, null, "test-model"),
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function dataPayloads(text) {
  return text
    .split("\n\n")
    .map((block) => block.match(/^data: (.+)$/m)?.[1])
    .filter((data) => data && data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

const sse = (data) => [`data: ${JSON.stringify(data)}`, ""];

const reasoningItem = { id: "rs_1", type: "reasoning", summary: [] };
const twoPartStream = [
  ...sse({ type: "response.created", response: { id: "resp_1", status: "in_progress", output: [] } }),
  ...sse({ type: "response.output_item.added", output_index: 0, item: reasoningItem }),
  ...sse({ type: "response.reasoning_summary_part.added", item_id: "rs_1", output_index: 0, summary_index: 0, part: { type: "summary_text", text: "" } }),
  ...sse({ type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 0, delta: "Checking the input." }),
  ...sse({ type: "response.reasoning_summary_part.done", item_id: "rs_1", output_index: 0, summary_index: 0, part: { type: "summary_text", text: "Checking the input." } }),
  ...sse({ type: "response.reasoning_summary_part.added", item_id: "rs_1", output_index: 0, summary_index: 1, part: { type: "summary_text", text: "" } }),
  ...sse({ type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 1, delta: "Applying " }),
  ...sse({ type: "response.reasoning_summary_text.delta", item_id: "rs_1", output_index: 0, summary_index: 1, delta: "the check." }),
  ...sse({ type: "response.reasoning_summary_part.done", item_id: "rs_1", output_index: 0, summary_index: 1, part: { type: "summary_text", text: "Applying the check." } }),
  ...sse({ type: "response.output_item.done", output_index: 0, item: reasoningItem }),
  ...sse({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "No." }),
  ...sse({ type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } }),
];

describe("Responses reasoning summary parts", () => {
  it("separates parts in chat reasoning_content without touching the first part", async () => {
    const chunks = dataPayloads(await runTransform(FORMATS.OPENAI, twoPartStream));
    const reasoning = chunks.map((c) => c.choices?.[0]?.delta?.reasoning_content).filter(Boolean);

    expect(reasoning[0]).toBe("Checking the input.");
    expect(reasoning.join("")).toBe("Checking the input.\n\nApplying the check.");
    expect(chunks.map((c) => c.choices?.[0]?.delta?.content).filter(Boolean).join("")).toBe("No.");
  });

  it("separates parts in a Claude thinking block", async () => {
    const events = dataPayloads(await runTransform(FORMATS.CLAUDE, twoPartStream));
    const thinking = events
      .filter((e) => e.type === "content_block_delta" && e.delta?.type === "thinking_delta")
      .map((e) => e.delta.thinking)
      .join("");

    expect(thinking).toBe("Checking the input.\n\nApplying the check.");
  });

  it("leaves a single-part summary unchanged", async () => {
    const single = twoPartStream.filter((line) => !line.includes('"summary_index":1'));
    const chunks = dataPayloads(await runTransform(FORMATS.OPENAI, single));
    const reasoning = chunks.map((c) => c.choices?.[0]?.delta?.reasoning_content).filter(Boolean).join("");

    expect(reasoning).toBe("Checking the input.");
  });
});
