import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

async function runTransform(input, sourceFormat = FORMATS.OPENAI_RESPONSES) {
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
      sourceFormat,
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
  it.each([
    ["max_output_tokens", "length"],
    ["content_filter", "content_filter"],
  ])("maps a Responses %s incomplete reason to Chat finish_reason %s", async (reason, finishReason) => {
    const output = await runTransform([
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_incomplete", status: "in_progress" } })}`,
      "",
      `event: response.incomplete`,
      `data: ${JSON.stringify({ type: "response.incomplete", response: { id: "resp_incomplete", status: "incomplete", incomplete_details: { reason }, usage: { input_tokens: 2, output_tokens: 1 } } })}`,
      "",
    ].join("\n"), FORMATS.OPENAI);

    expect(output).toContain(`"finish_reason":"${finishReason}"`);
    expect(output).not.toContain('"finish_reason":"stop"');
  });

  it.each(["response.done", "response.failed"])("surfaces %s with failed status as a Chat stream error after a tool call", async (eventType) => {
    const output = await runTransform([
      `event: response.output_item.added`,
      `data: ${JSON.stringify({ type: "response.output_item.added", item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "shell", arguments: "" } })}`,
      "",
      `event: ${eventType}`,
      `data: ${JSON.stringify({ type: eventType, response: { id: "resp_failed", status: "failed", error: { type: "server_error", message: "upstream overloaded" } } })}`,
      "",
    ].join("\n"), FORMATS.OPENAI);

    const chunks = output.split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6)));
    expect(chunks.find((chunk) => chunk.error)?.error).toEqual({
      type: "server_error",
      message: "upstream overloaded",
    });
    expect(chunks.some((chunk) => chunk.choices?.[0]?.finish_reason === "tool_calls")).toBe(false);
  });

  it("reports a failed response.done even without an upstream error object", async () => {
    const output = await runTransform([
      "event: response.done",
      `data: ${JSON.stringify({ type: "response.done", response: { id: "resp_failed", status: "failed" } })}`,
      "",
    ].join("\n"), FORMATS.OPENAI);

    const chunks = output.split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => JSON.parse(line.slice(6)));
    expect(chunks.find((chunk) => chunk.error)?.error.message).toBe("upstream Responses stream failed");
  });

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
      `event: response.output_item.done`,
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] } })}`,
      "",
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_test", status: "completed" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.completed");
    expect(output).not.toContain("event: response.failed");
    expect(output).not.toContain("data: null");
    expect(output).toContain("data: [DONE]");
  });

  it.each([
    ["function call without an ID", { type: "function_call", call_id: "", name: "search", arguments: "{}" }],
    ["custom call without a name", { type: "custom_tool_call", call_id: "call_exec", name: " ", input: "run" }],
  ])("fails a native completion with assistant text and a %s", async (_case, badCall) => {
    const output = await runTransform([
      "event: response.output_item.done",
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] } })}`,
      "",
      "event: response.output_item.done",
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 1, item: badCall })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_mixed", status: "completed" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.failed");
    expect(output).toContain('"code":"invalid_tool_call"');
    expect(output).not.toContain("event: response.completed");
  });

  it("checks malformed calls carried only in the native terminal output", async () => {
    const output = await runTransform([
      "event: response.completed",
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_terminal_calls",
          status: "completed",
          output: [
            { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
            { type: "function_call", call_id: "call_bad", name: "" },
          ],
        },
      })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.failed");
    expect(output).toContain('"code":"invalid_tool_call"');
    expect(output).not.toContain("event: response.completed");
  });

  it("turns a native reasoning-only completion into an explicit failure", async () => {
    const output = await runTransform([
      `event: response.output_item.done`,
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] } })}`,
      "",
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_empty", status: "completed" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.failed");
    expect(output).toContain('"code":"empty_output"');
    expect(output).not.toContain("event: response.completed");
  });

  it("checks a reasoning-only terminal data line even without a trailing newline", async () => {
    const output = await runTransform([
      `event: response.output_item.done`,
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] } })}`,
      "",
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_tail", status: "completed" } })}`,
    ].join("\n"));

    expect(output).toContain("event: response.failed");
    expect(output).toContain('"code":"empty_output"');
    expect(output).not.toContain("event: response.completed");
  });

  it("preserves a native completion containing assistant text", async () => {
    const output = await runTransform([
      `event: response.output_item.done`,
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] } })}`,
      "",
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_answer", status: "completed" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.completed");
    expect(output).not.toContain("event: response.failed");
  });

  it("preserves a native completion containing a refusal part", async () => {
    const output = await runTransform([
      `event: response.output_item.done`,
      `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "I cannot help with that." }] } })}`,
      "",
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_refusal", status: "completed" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.completed");
    expect(output).not.toContain("event: response.failed");
  });

  it("preserves a native refusal delta when the terminal has no item.done event", async () => {
    const output = await runTransform([
      `event: response.refusal.delta`,
      `data: ${JSON.stringify({ type: "response.refusal.delta", item_id: "msg_refusal", output_index: 0, content_index: 0, delta: "I cannot help." })}`,
      "",
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_refusal_delta", status: "completed" } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.completed");
    expect(output).not.toContain("event: response.failed");
  });

  it("passes a native refusal delta through to a Chat client", async () => {
    const output = await runTransform([
      `event: response.created`,
      `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_chat_refusal", status: "in_progress" } })}`,
      "",
      `event: response.refusal.delta`,
      `data: ${JSON.stringify({ type: "response.refusal.delta", item_id: "msg_refusal", output_index: 0, content_index: 0, delta: "I cannot help." })}`,
      "",
      `event: response.completed`,
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_chat_refusal", status: "completed" } })}`,
      "",
    ].join("\n"), FORMATS.OPENAI);

    expect(output).toContain('"refusal":"I cannot help."');
    expect(output).toContain('"finish_reason":"stop"');
  });

  it("does not add response.failed when a Responses stream ended incomplete", async () => {
    const output = await runTransform([
      `event: response.incomplete`,
      `data: ${JSON.stringify({ type: "response.incomplete", response: { id: "resp_test", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } })}`,
      "",
    ].join("\n"));

    expect(output).toContain("event: response.incomplete");
    expect(output).not.toContain("event: response.failed");
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
