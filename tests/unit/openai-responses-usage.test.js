import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";

describe("Responses usage for Codex auto-compaction", () => {
  it("includes trailing usage-only chunks before emitting exactly one completion", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const send = chunk => translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state);
    const first = send({ id: "qa", choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }] });
    const finished = send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    expect([...first, ...finished].some(event => event.event === "response.completed")).toBe(false);
    send({ choices: [], usage: { prompt_tokens: 300000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 120000 }, completion_tokens_details: { reasoning_tokens: 5 } } });
    const completed = send(null).filter(event => event.event === "response.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].data.response.usage).toEqual({ input_tokens: 300000, output_tokens: 10, total_tokens: 300010, input_tokens_details: { cached_tokens: 120000 }, output_tokens_details: { reasoning_tokens: 5 } });
    expect(send(null)).toEqual([]);
  });

  it("flushes the Responses stage after Claude's intermediate Chat completion", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const send = chunk => translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, chunk, state);
    const events = [
      { type: "message_start", message: { id: "qa", model: "qa", usage: { input_tokens: 100 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } },
      { type: "message_stop" }, null,
    ].flatMap(send);
    const completed = events.filter(event => event.event === "response.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].data.response.usage).toMatchObject({ input_tokens: 100, output_tokens: 10, total_tokens: 110 });
  });
});
