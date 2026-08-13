import { describe, it, expect } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState } from "../../open-sse/translator/index.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

// Build a minimal streaming chunk in OpenAI chat/completions shape
function chunk(delta, finishReason = null) {
  return {
    choices: [
      {
        delta,
        finish_reason: finishReason,
        index: 0,
      },
    ],
  };
}

describe("openai-responses output_text.done ordering (#3234)", () => {
  it("does NOT emit output_text.done on the first delta when tool_calls appear later", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [];

    // 1) First delta carries text content only
    const r1 = openaiToOpenAIResponsesResponse(chunk({ content: "Hello " }), state);
    r1.forEach((e) => events.push(e));

    // 2) Second delta carries more text
    const r2 = openaiToOpenAIResponsesResponse(chunk({ content: "world" }), state);
    r2.forEach((e) => events.push(e));

    // 3) Third delta carries tool_calls (interleaved, as cbcn reasoning models do)
    const r3 = openaiToOpenAIResponsesResponse(
      chunk({ tool_calls: [{ id: "call_1", function: { name: "foo", arguments: "{}" } }] }),
      state,
    );
    r3.forEach((e) => events.push(e));

    // 4) Final delta with finish_reason closes everything
    const r4 = openaiToOpenAIResponsesResponse(chunk({}, "stop"), state);
    r4.forEach((e) => events.push(e));

    const textDeltas = events.filter((e) => e.event === "response.output_text.delta").length;
    const doneEvents = events.filter((e) => e.event === "response.output_text.done");

    expect(textDeltas).toBe(2); // two content deltas emitted
    // The .done must only appear once, at the very end — not after the first delta
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].data.text).toBe("Hello world");
  });

  it("emits output_text.done only after finish_reason (not on first content delta)", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = [];

    const r1 = openaiToOpenAIResponsesResponse(chunk({ content: "first chunk " }), state);
    r1.forEach((e) => events.push(e));
    // After first chunk there must be NO .done event
    expect(events.filter((e) => e.event === "response.output_text.done").length).toBe(0);

    const r2 = openaiToOpenAIResponsesResponse(chunk({ content: "second chunk" }), state);
    r2.forEach((e) => events.push(e));
    // Still no .done before finish_reason
    expect(events.filter((e) => e.event === "response.output_text.done").length).toBe(0);

    const r3 = openaiToOpenAIResponsesResponse(chunk({}, "stop"), state);
    r3.forEach((e) => events.push(e));
    const done = events.filter((e) => e.event === "response.output_text.done");
    expect(done.length).toBe(1);
    expect(done[0].data.text).toBe("first chunk second chunk");
  });
});
