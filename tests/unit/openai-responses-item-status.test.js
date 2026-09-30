/**
 * Translated output items must carry a `status` field. Clients that validate
 * the Responses event stream (for example the OpenAI SDK used by opencode)
 * reject items without it and abort every tool call with "Tool execution
 * aborted" even though the rest of the payload parses. Regression: the
 * openai -> responses translator emitted items with no status field at all.
 */
import { describe, it, expect } from "vitest";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("OpenAI Chat stream to Responses: output item status", () => {
  it("function_call items carry in_progress on added and completed on done", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const chunks = [
      { id: "cmb-status", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: "" } }] }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"filePath":"/etc/hostname"}' } }] }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const events = chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
    const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "function_call");
    const done = events.find((e) => e.event === "response.output_item.done" && e.data.item?.type === "function_call");
    expect(added.data.item.status).toBe("in_progress");
    expect(done.data.item.status).toBe("completed");
    expect(done.data.item.arguments).toBe('{"filePath":"/etc/hostname"}');
  });

  it("message items carry in_progress on added and completed on done", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const chunks = [
      { id: "cmb-status", choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const events = chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
    const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "message");
    const done = events.find((e) => e.event === "response.output_item.done" && e.data.item?.type === "message");
    expect(added.data.item.status).toBe("in_progress");
    expect(done.data.item.status).toBe("completed");
  });

  it("reasoning items carry in_progress on added and completed on done", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const chunks = [
      { id: "cmb-status", choices: [{ index: 0, delta: { reasoning_content: "thinking about it" }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] },
      { id: "cmb-status", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const events = chunks.flatMap((c) => openaiToOpenAIResponsesResponse(c, state));
    const added = events.find((e) => e.event === "response.output_item.added" && e.data.item?.type === "reasoning");
    const done = events.find((e) => e.event === "response.output_item.done" && e.data.item?.type === "reasoning");
    expect(added.data.item.status).toBe("in_progress");
    expect(done.data.item.status).toBe("completed");
  });
});
