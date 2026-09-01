import { describe, expect, it } from "vitest";

import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

// Drive the chat-completions → Responses transformer the way
// responsesHandler.js wires it (createResponsesApiTransformStream(null),
// upstream SSE piped through) and assert the synthesized
// response.completed preserves the billing evidence: usage AND model.

const MODEL = "z-ai/glm-5.3-flash";

const USAGE = {
  prompt_tokens: 9452,
  prompt_tokens_details: { cached_tokens: 1280 },
  completion_tokens: 32,
  completion_tokens_details: { reasoning_tokens: 7 },
  total_tokens: 9484
};

function chatEvent(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

async function runTransform(events) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(events.join("")));
      controller.close();
    }
  });

  const reader = stream.pipeThrough(createResponsesApiTransformStream(null)).getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function completedPayload(output) {
  for (const block of output.split("\n\n")) {
    const m = block.match(/^data: (.+)$/m);
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed.type === "response.completed") return parsed;
    } catch {
      // not JSON — ignore
    }
  }
  return null;
}

function streamWithUsage({ withModel = true, withUsage = true } = {}) {
  const events = [
    chatEvent({
      ...(withModel ? { model: MODEL } : {}),
      id: "chatcmpl-usage",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }]
    }),
    chatEvent({
      ...(withModel ? { model: MODEL } : {}),
      id: "chatcmpl-usage",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
    })
  ];
  if (withUsage) {
    // include_usage final chunk: usage with EMPTY choices, AFTER
    // finish_reason — the ordering the flush fix exists for.
    events.push(chatEvent({
      ...(withModel ? { model: MODEL } : {}),
      id: "chatcmpl-usage",
      choices: [],
      usage: USAGE
    }));
  }
  events.push("data: [DONE]\n\n");
  return events;
}

describe("responsesTransformer usage + model evidence", () => {
  it("response.completed carries the chunk's model and the full mapped usage, emitted at flush", async () => {
    const output = await runTransform(streamWithUsage());
    const completed = completedPayload(output);

    expect(completed).not.toBeNull();
    expect(completed.response.model).toBe(MODEL);
    expect(completed.response.usage).toEqual({
      input_tokens: 9452,
      input_tokens_details: { cached_tokens: 1280 },
      output_tokens: 32,
      output_tokens_details: { reasoning_tokens: 7 },
      total_tokens: 9484
    });

    // Flush ordering: exactly one response.completed, after the last
    // output_item.done (so the late usage chunk was captured first)
    // and before the final [DONE].
    expect(output.match(/event: response\.completed/g)).toHaveLength(1);
    expect(output.indexOf("event: response.completed"))
      .toBeGreaterThan(output.indexOf("event: response.output_item.done"));
    expect(output.indexOf("event: response.completed"))
      .toBeLessThan(output.indexOf("data: [DONE]"));
  });

  it("upstream ignoring include_usage still completes cleanly, usage omitted, model present", async () => {
    const output = await runTransform(streamWithUsage({ withUsage: false }));
    const completed = completedPayload(output);

    expect(completed).not.toBeNull();
    expect(completed.response.model).toBe(MODEL);
    expect(completed.response.usage).toBeUndefined();
    expect(output).toContain("data: [DONE]");
    expect(output).not.toContain("event: response.failed");
  });

  it("upstream never sending model omits the field — no null/empty leak", async () => {
    const output = await runTransform(streamWithUsage({ withModel: false }));
    const completed = completedPayload(output);

    expect(completed).not.toBeNull();
    expect(completed.response.usage).toBeDefined();
    expect(completed.response.model).toBeUndefined();
    expect(JSON.stringify(completed.response)).not.toMatch(/"model"\s*:\s*(null|"")/);
  });
});
