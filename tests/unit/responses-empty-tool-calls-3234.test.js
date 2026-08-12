import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState } from "../../open-sse/translator/index.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

// Some upstreams (cbcn/*) put an empty tool_calls array on every content delta.
const chunk = (delta, finish = null) => ({
  id: "chatcmpl-x",
  model: "kimi-k3",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

function run(chunks) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  const events = [];
  for (const c of chunks) events.push(...openaiToOpenAIResponsesResponse(c, state));
  return events;
}

const typesOf = (events, ...wanted) =>
  events.map(e => e.event).filter(t => wanted.includes(t));

describe("#3234 empty tool_calls array must not close the message", () => {
  it("keeps output_text.done after the last delta when every delta carries tool_calls: []", () => {
    const events = run([
      chunk({ reasoning_content: "thinking" }),
      chunk({ content: "cod", tool_calls: [] }),
      chunk({ content: "ex", tool_calls: [] }),
      chunk({ content: "-ok", tool_calls: [] }),
      chunk({}, "stop"),
    ]);

    expect(typesOf(events, "response.output_text.delta", "response.output_text.done")).toEqual([
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.done",
    ]);

    const done = events.filter(e => e.event === "response.output_text.done");
    expect(done).toHaveLength(1);
    expect(done[0].data.text).toBe("codex-ok");
  });

  it("emits no tool-call events for an empty array", () => {
    const events = run([chunk({ content: "hi", tool_calls: [] }), chunk({}, "stop")]);

    expect(events.some(e => e.event.startsWith("response.function_call"))).toBe(false);
  });

  it("still closes the message when a real tool call arrives mid-stream", () => {
    const events = run([
      chunk({ content: "calling" }),
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Read", arguments: "{}" } }] }),
      chunk({}, "tool_calls"),
    ]);

    const order = typesOf(events, "response.output_text.done", "response.output_item.added");
    expect(order).toContain("response.output_text.done");

    const done = events.find(e => e.event === "response.output_text.done");
    expect(done.data.text).toBe("calling");
    expect(events.some(e => e.event === "response.function_call_arguments.done")).toBe(true);
  });
});
