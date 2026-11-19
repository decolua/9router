import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { extractUsage } from "../../open-sse/utils/usageTracking.js";

async function runTransform(input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "codex",
      null,
      null,
      "gpt-5.5",
    ),
  );

  const reader = output.getReader();
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

describe("OpenAI Responses streaming termination", () => {
  it("emits a response.failed event when a Responses stream closes before a terminal event", async () => {
    const output = await runTransform([
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
      "",
      `event: response.output_text.delta`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.failed");
    expect(output).toContain('"type":"response.failed"');
    expect(output).not.toContain("data: null");
    expect(output).toContain("data: [DONE]");
  });

  it("does not add response.failed when a Responses stream already completed", async () => {
    const output = await runTransform([
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.completed");
    expect(output).not.toContain("event: response.failed");
    expect(output).not.toContain("data: null");
    expect(output).toContain("data: [DONE]");
  });

  it("does not add response.failed when a Responses stream sends response.done", async () => {
    const output = await runTransform([
      `event: response.done`,
      `data: ${JSON.stringify({ type: "response.done", response: { id: "resp_test" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.done");
    expect(output).not.toContain("event: response.failed");
    expect(output).not.toContain("data: null");
    expect(output).toContain("data: [DONE]");
  });

  it("emits response.failed before DONE when a Responses stream sends DONE without a terminal event", async () => {
    const output = await runTransform([
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_test", status: "in_progress" } })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"));

    expect(output.indexOf("event: response.failed")).toBeLessThan(output.indexOf("data: [DONE]"));
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(output).not.toContain("data: null");
  });
});

const OUTPUT_LIMIT = {
  type: "response.incomplete",
  response: {
    id: "resp_test",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    usage: {
      input_tokens: 120,
      output_tokens: 24,
      total_tokens: 144,
      input_tokens_details: { cached_tokens: 80 },
      output_tokens_details: { reasoning_tokens: 8 },
    },
  },
};

const CHAT_USAGE = {
  prompt_tokens: 120,
  completion_tokens: 24,
  total_tokens: 144,
  prompt_tokens_details: { cached_tokens: 80 },
  completion_tokens_details: { reasoning_tokens: 8 },
};

describe("Responses output limits translated to Chat", () => {
  it.each([false, true])("emits one length finish with usage (in-flight tool call: %s)", (withToolCall) => {
    const state = initState(FORMATS.OPENAI);
    const translate = (chunk) => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, chunk, state);

    if (withToolCall) {
      translate({
        type: "response.output_item.added",
        item: { id: "fc_1", call_id: "call_1", type: "function_call", name: "lookup" },
      });
      const [args] = translate({ type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"key":' });
      expect(args.choices[0].delta.tool_calls[0].function.arguments).toBe('{"key":');
    } else {
      translate({ type: "response.output_text.delta", delta: "partial" });
    }

    const terminal = translate(OUTPUT_LIMIT);
    expect(terminal).toHaveLength(1);
    expect(terminal[0].choices).toEqual([{ index: 0, delta: {}, finish_reason: "length" }]);
    expect(terminal[0].usage).toEqual(CHAT_USAGE);
    expect(state.finishReason).toBe("length");
    expect(translate(OUTPUT_LIMIT)).toEqual([]);
    expect(translate({ type: "response.done", response: { usage: OUTPUT_LIMIT.response.usage } })).toEqual([]);
    expect(translate(null)).toEqual([]);
    expect(state.usage).toEqual({ ...CHAT_USAGE, cached_tokens: 80, reasoning_tokens: 8 });
  });

  it.each(["content_filter", "unknown_reason", undefined])("keeps the existing fallback for incomplete reason %s", (reason) => {
    const state = initState(FORMATS.OPENAI);
    const translate = (chunk) => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, chunk, state);
    translate({ type: "response.output_text.delta", delta: "partial" });
    expect(translate({ ...OUTPUT_LIMIT, response: { ...OUTPUT_LIMIT.response, incomplete_details: { reason } } })).toEqual([]);
    expect(translate(null)[0].choices[0].finish_reason).toBe("stop");
  });

  it("extracts incomplete terminal usage for accounting", () => {
    expect(extractUsage(OUTPUT_LIMIT)).toEqual({ ...CHAT_USAGE, cached_tokens: 80, reasoning_tokens: 8 });
  });
});
